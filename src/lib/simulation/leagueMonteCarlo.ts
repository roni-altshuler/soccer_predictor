/**
 * League Monte Carlo simulation — pure function extracted from
 * src/app/api/simulation/[leagueId]/route.ts for testability.
 *
 * No side effects, no global state, no I/O. Given the same inputs the
 * function MUST return identical outputs (seeded xorshift32 PRNG).
 *
 * Math summary:
 *   1. Team strength = 10^(PPG / 2)  (Bradley-Terry scale). When a team
 *      carries a historical prior (TeamData.priorPpg, from the committed
 *      multi-season strength artifact via src/lib/simulation/teamPriors.ts),
 *      PPG is the shrinkage blend
 *        (K × priorPpg + played × observedPpg) / (K + played)
 *      with K = PRIOR_EVIDENCE_MATCHES — the prior is worth K matches of
 *      evidence, so pre-season (played = 0) it fully differentiates strong
 *      from weak teams and it decays automatically as real results arrive.
 *      Teams without a prior behave exactly as before (observed PPG, or the
 *      1.3 neutral default before their first match).
 *   2. P(home win)   = (str_h × homeFactor) / (str_h × homeFactor + str_a)
 *      P(away win)   = str_a / (str_h × homeFactor + str_a)
 *      P(draw)       = baseDrawRate × (0.7 + 0.6 × strengthRatio),
 *                      clamped to [0.10, 0.40]; H/A scaled by (1 − P(draw))
 *   3. Per simulation: replay every remaining fixture, tally points + GD,
 *      sort by (pts, GD) → record final position.
 *   4. Aggregate position frequencies into probabilities.
 *
 */

export interface TeamData {
  name: string
  points: number
  wins: number
  draws: number
  losses: number
  gf: number
  ga: number
  gd: number
  matchesPlayed: number
  /**
   * Expected points per game under the committed multi-season strength
   * artifact (see src/lib/simulation/teamPriors.ts). Optional: absent means
   * "no prior" and the simulation behaves exactly as it always has.
   */
  priorPpg?: number
}

export interface SimulationFixture {
  homeIdx: number
  awayIdx: number
  key?: string
  homeTeam?: string
  awayTeam?: string
  date?: string
}

export type WhatIfOutcome = 'home' | 'draw' | 'away'

export interface FixtureOverride {
  fixtureKey: string
  outcome: WhatIfOutcome
}

export interface Standing {
  team_name: string
  team_id: number | null
  current_position: number
  current_points: number
  matches_played: number
  avg_final_position: number
  avg_final_points: number
  title_probability: number
  top_4_probability: number
  europa_probability: number
  relegation_probability: number
  position_distribution: Record<number, number>
}

export interface DetailedLeagueSimulation {
  standings: Standing[]
}

/**
 * How many matches of evidence a team's historical prior is worth.
 *
 * K = 12 ≈ a third of a 38-match season. The prior comes from a time-decayed
 * multi-season fit (half-life ≈ 390 days), so it is a strong read on a squad —
 * but a season boundary brings transfers and managerial churn, so it must not
 * outweigh a meaningful block of real results. With K = 12: pre-season the
 * table is 100% prior; after 6 rounds it is 67% prior; by mid-season (19
 * played) 39%; over a full 38-match season just 24%. That matches the usual
 * football-analytics rule of thumb that team quality estimates need roughly
 * 10-15 matches of shrinkage before raw PPG becomes reliable.
 */
export const PRIOR_EVIDENCE_MATCHES = 12

/** PPG assumed for a team with no played matches and no prior (legacy default). */
const DEFAULT_PPG = 1.3

/**
 * Blend observed points-per-game with an optional historical prior using
 * effective-sample-size shrinkage. Pure and deterministic.
 *
 *   - no prior            → observed PPG (or the 1.3 default before round 1);
 *                           bit-for-bit the pre-existing behaviour.
 *   - prior, 0 played     → exactly the prior (differentiated pre-season).
 *   - prior, n played     → (K·prior + n·observed) / (K + n): real results
 *                           progressively drown the prior out.
 */
export function blendedPpg(
  points: number,
  matchesPlayed: number,
  priorPpg?: number,
): number {
  const played = Math.max(0, matchesPlayed)
  if (priorPpg === undefined || !Number.isFinite(priorPpg)) {
    return played > 0 ? points / played : DEFAULT_PPG
  }
  const observedTerm = played > 0 ? points : 0
  return (
    (PRIOR_EVIDENCE_MATCHES * priorPpg + observedTerm) /
    (PRIOR_EVIDENCE_MATCHES + played)
  )
}

/**
 * Monte Carlo Season Simulation. Pure — same inputs → same outputs.
 * Legacy entry point: standings only, byte-for-byte unchanged behaviour.
 */
export function runMonteCarloSimulation(
  teams: TeamData[],
  totalMatchesPerSeason: number,
  nSimulations: number,
  leagueId: number,
  remainingFixtures: SimulationFixture[] | null = null,
  fixtureOverride: FixtureOverride | null = null,
): Standing[] {
  return runMonteCarloSimulationDetailed(
    teams,
    totalMatchesPerSeason,
    nSimulations,
    leagueId,
    remainingFixtures,
    fixtureOverride,
  ).standings
}

/**
 * Monte Carlo season simulation. Pure and deterministic — same inputs →
 * same outputs, from a fixed-seed xorshift32.
 */
export function runMonteCarloSimulationDetailed(
  teams: TeamData[],
  totalMatchesPerSeason: number,
  nSimulations: number,
  leagueId: number,
  remainingFixtures: SimulationFixture[] | null = null,
  fixtureOverride: FixtureOverride | null = null,
): DetailedLeagueSimulation {
  const numTeams = teams.length
  if (numTeams === 0) return { standings: [] }

  const positionCounts: number[][] = teams.map(() => new Array(numTeams).fill(0))
  const totalPointsSum: number[] = new Array(numTeams).fill(0)

  // Bradley-Terry strength from PPG — observed table pace blended with the
  // historical prior when one is attached (see blendedPpg). No PRNG draws
  // are involved, so determinism is untouched.
  const strengths = teams.map((t) =>
    Math.pow(10, blendedPpg(t.points, t.matchesPlayed, t.priorPpg) / 2.0),
  )

  const remainingPerTeam = teams.map((t) =>
    Math.max(0, totalMatchesPerSeason - t.matchesPlayed),
  )

  function generateRemainingFixtures(): SimulationFixture[] {
    const fixtures: SimulationFixture[] = []
    const remaining = [...remainingPerTeam]

    for (let i = 0; i < numTeams; i++) {
      for (let j = 0; j < numTeams; j++) {
        if (i !== j && remaining[i] > 0 && remaining[j] > 0) {
          fixtures.push({
            homeIdx: i,
            awayIdx: j,
            key: `generated-${i}-${j}-${fixtures.length}`,
            homeTeam: teams[i]?.name,
            awayTeam: teams[j]?.name,
          })
          remaining[i]--
          remaining[j]--
          if (remaining[i] <= 0) break
        }
      }
    }
    return fixtures
  }

  const fixtures =
    remainingFixtures && remainingFixtures.length > 0
      ? remainingFixtures
      : generateRemainingFixtures()

  const homeFactor = 1.35

  // League-specific empirical draw rate; falls back to 24% for unknown leagues.
  const leagueDrawRates: Record<number, number> = {
    47: 0.25,
    87: 0.24,
    55: 0.27,
    54: 0.23,
    53: 0.24,
    130: 0.2,
    57: 0.22,
    61: 0.25,
  }
  const baseDrawRate = leagueDrawRates[leagueId] || 0.24

  // Seeded xorshift32 — reset per call so identical inputs → identical outputs.
  let seed = 42
  function rand(): number {
    seed ^= seed << 13
    seed ^= seed >> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }

  for (let sim = 0; sim < nSimulations; sim++) {
    const simPoints = teams.map((t) => t.points)
    const simGD = teams.map((t) => t.gd)

    for (const fixture of fixtures) {
      const { homeIdx, awayIdx } = fixture

      if (fixtureOverride && fixture.key === fixtureOverride.fixtureKey) {
        if (fixtureOverride.outcome === 'home') {
          simPoints[homeIdx] += 3
          simGD[homeIdx] += 1
          simGD[awayIdx] -= 1
        } else if (fixtureOverride.outcome === 'draw') {
          simPoints[homeIdx] += 1
          simPoints[awayIdx] += 1
        } else {
          simPoints[awayIdx] += 3
          simGD[awayIdx] += 1
          simGD[homeIdx] -= 1
        }
        continue
      }

      const homeStr = strengths[homeIdx] * homeFactor
      const awayStr = strengths[awayIdx]
      const total = homeStr + awayStr

      let pHome = homeStr / total
      let pAway = awayStr / total

      const strengthRatio =
        Math.min(homeStr, awayStr) / Math.max(homeStr, awayStr)
      const drawProb = baseDrawRate * (0.7 + 0.6 * strengthRatio)
      const clampedDraw = Math.min(0.4, Math.max(0.1, drawProb))

      pHome = pHome * (1 - clampedDraw)
      pAway = pAway * (1 - clampedDraw)

      const r = rand()
      if (r < pHome) {
        simPoints[homeIdx] += 3
        simGD[homeIdx] += 1
        simGD[awayIdx] -= 1
      } else if (r < pHome + clampedDraw) {
        simPoints[homeIdx] += 1
        simPoints[awayIdx] += 1
      } else {
        simPoints[awayIdx] += 3
        simGD[awayIdx] += 1
        simGD[homeIdx] -= 1
      }
    }

    const indices = teams.map((_, i) => i)
    indices.sort((a, b) => {
      if (simPoints[b] !== simPoints[a]) return simPoints[b] - simPoints[a]
      return simGD[b] - simGD[a]
    })

    for (let pos = 0; pos < indices.length; pos++) {
      const teamIdx = indices[pos]
      positionCounts[teamIdx][pos]++
      totalPointsSum[teamIdx] += simPoints[teamIdx]
    }
  }

  const standings: Standing[] = teams.map((team, idx) => {
    const counts = positionCounts[idx]
    const avgPoints = totalPointsSum[idx] / nSimulations

    const positionDist: Record<number, number> = {}
    for (let p = 0; p < numTeams; p++) {
      if (counts[p] > 0) {
        positionDist[p + 1] = parseFloat((counts[p] / nSimulations).toFixed(4))
      }
    }

    let avgPosition = 0
    for (let p = 0; p < numTeams; p++) {
      avgPosition += (p + 1) * counts[p]
    }
    avgPosition /= nSimulations

    const titleProb = (counts[0] || 0) / nSimulations

    const top4Prob =
      ((counts[0] || 0) +
        (counts[1] || 0) +
        (counts[2] || 0) +
        (counts[3] || 0)) /
      nSimulations

    const europaProb =
      ((counts[4] || 0) + (counts[5] || 0) + (counts[6] || 0)) / nSimulations

    const relegationZone = numTeams <= 18 ? 3 : 3
    let relegationProb = 0
    for (let p = numTeams - relegationZone; p < numTeams; p++) {
      relegationProb += counts[p] || 0
    }
    relegationProb /= nSimulations

    return {
      team_name: team.name,
      team_id: null,
      current_position: idx + 1,
      current_points: team.points,
      matches_played: team.matchesPlayed,
      avg_final_position: parseFloat(avgPosition.toFixed(2)),
      avg_final_points: parseFloat(avgPoints.toFixed(1)),
      title_probability: parseFloat(titleProb.toFixed(4)),
      top_4_probability: parseFloat(top4Prob.toFixed(4)),
      europa_probability: parseFloat(europaProb.toFixed(4)),
      relegation_probability: parseFloat(relegationProb.toFixed(4)),
      position_distribution: positionDist,
    }
  })

  standings.sort((a, b) => a.avg_final_position - b.avg_final_position)

  return { standings }
}
