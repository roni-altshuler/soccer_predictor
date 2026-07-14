/**
 * League Monte Carlo simulation — pure function extracted from
 * src/app/api/simulation/[leagueId]/route.ts for testability.
 *
 * No side effects, no global state, no I/O. Given the same inputs the
 * function MUST return identical outputs (seeded xorshift32 PRNG).
 *
 * Math summary:
 *   1. Team strength = 10^(PPG / 2)  (Bradley-Terry scale)
 *   2. P(home win)   = (str_h × homeFactor) / (str_h × homeFactor + str_a)
 *      P(away win)   = str_a / (str_h × homeFactor + str_a)
 *      P(draw)       = baseDrawRate × (0.7 + 0.6 × strengthRatio),
 *                      clamped to [0.10, 0.40]; H/A scaled by (1 − P(draw))
 *   3. Per simulation: replay every remaining fixture, tally points + GD,
 *      sort by (pts, GD) → record final position.
 *   4. Aggregate position frequencies into probabilities.
 *
 * Universe sampling (the Tournament Multiverse):
 *   `runMonteCarloSimulationDetailed` can additionally keep K complete
 *   simulated seasons ("universes") via classic reservoir sampling
 *   (Algorithm R) over the run index, and/or collect up to 12 seasons
 *   matching a condition on one team's finish. Reservoir replacement draws
 *   come from the SAME seeded PRNG, so runs stay fully deterministic; when
 *   the options are absent no extra draws are consumed and the outputs are
 *   byte-for-byte identical to the legacy behaviour. Condition matching
 *   consumes NO randomness, so a condition run replays exactly the same
 *   seasons as a sampling-only run with the same K.
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

// ---------------------------------------------------------------------------
// Universe sampling types
// ---------------------------------------------------------------------------

/** One row of a single simulated season's final table. */
export interface UniverseTableRow {
  team_name: string
  points: number
  gd: number
  position: number
}

/** One complete simulated season, compact — no per-match logs. */
export interface SampledUniverse {
  /** 1-based run index within the n_simulations runs (Universe #237 = run 237). */
  universe_id: number
  /** Full final table, sorted by final position (1 first). */
  table: UniverseTableRow[]
}

export type UniverseOutcome = 'champion' | 'top4' | 'relegated'

export interface UniverseSamplingOptions {
  /**
   * Keep this many complete seasons, reservoir-sampled uniformly from the
   * n_simulations runs. Capped at 60.
   */
  sampleUniverses?: number
  /** Team name (must match TeamData.name exactly) for condition matching. */
  conditionTeam?: string
  /** Outcome the condition team must achieve for a run to match. */
  conditionOutcome?: UniverseOutcome
}

export interface DetailedLeagueSimulation {
  standings: Standing[]
  /** Present iff sampleUniverses > 0 was requested. Sorted by universe_id. */
  sampled_universes?: SampledUniverse[]
  /**
   * Present iff conditionTeam + conditionOutcome were given: the first-found
   * matching seasons, at most 12. Never synthesized — if fewer matches exist
   * in n runs, fewer are returned.
   */
  condition_matches?: SampledUniverse[]
  /** True total number of matching runs out of n_simulations. */
  condition_match_count?: number
}

/** Hard cap on reservoir size — keeps the payload bounded. */
export const MAX_SAMPLED_UNIVERSES = 60
/** At most this many condition-matching universes are returned. */
export const MAX_CONDITION_MATCHES = 12

/** Relegation slots mirrored from the aggregate probability computation. */
const RELEGATION_SLOTS = 3

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
 * Monte Carlo Season Simulation with optional universe sampling and
 * condition matching. Pure and deterministic — same inputs (including
 * options) → same outputs. With no options this is exactly the legacy
 * simulation: the sampling code consumes zero PRNG draws when disabled.
 */
export function runMonteCarloSimulationDetailed(
  teams: TeamData[],
  totalMatchesPerSeason: number,
  nSimulations: number,
  leagueId: number,
  remainingFixtures: SimulationFixture[] | null = null,
  fixtureOverride: FixtureOverride | null = null,
  options: UniverseSamplingOptions | null = null,
): DetailedLeagueSimulation {
  const numTeams = teams.length
  if (numTeams === 0) return { standings: [] }

  const positionCounts: number[][] = teams.map(() => new Array(numTeams).fill(0))
  const totalPointsSum: number[] = new Array(numTeams).fill(0)

  // Bradley-Terry strength from current PPG.
  const strengths = teams.map((t) => {
    const ppg = t.matchesPlayed > 0 ? t.points / t.matchesPlayed : 1.3
    return Math.pow(10, ppg / 2.0)
  })

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

  // Universe sampling setup. Everything below is inert (zero PRNG draws,
  // zero allocations per run) unless the options are actually provided.
  const sampleCap = Math.max(
    0,
    Math.min(MAX_SAMPLED_UNIVERSES, Math.floor(options?.sampleUniverses ?? 0)),
  )
  const reservoir: SampledUniverse[] = []
  const conditionRequested = Boolean(
    options?.conditionTeam && options?.conditionOutcome,
  )
  const conditionOutcome = options?.conditionOutcome ?? null
  const conditionIdx = conditionRequested
    ? teams.findIndex((t) => t.name === options?.conditionTeam)
    : -1
  const conditionMatches: SampledUniverse[] = []
  let conditionMatchCount = 0

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

    // Compact snapshot of this run's final table — built only when kept.
    const captureUniverse = (): SampledUniverse => ({
      universe_id: sim + 1,
      table: indices.map((teamIdx, pos) => ({
        team_name: teams[teamIdx].name,
        points: simPoints[teamIdx],
        gd: simGD[teamIdx],
        position: pos + 1,
      })),
    })

    // Reservoir sampling (Algorithm R): run i < K fills the reservoir; run
    // i ≥ K draws j uniform on [0, i] and replaces slot j if j < K. Every
    // run therefore survives with probability K/n. The replacement draw
    // comes from the same seeded PRNG — deterministic, and consumed only
    // when sampling is enabled.
    if (sampleCap > 0) {
      if (sim < sampleCap) {
        reservoir.push(captureUniverse())
      } else {
        const j = Math.floor(rand() * (sim + 1))
        if (j < sampleCap) reservoir[j] = captureUniverse()
      }
    }

    // Condition matching — pure inspection of the finished table, no PRNG
    // draws, so it never perturbs the simulated seasons.
    if (conditionRequested && conditionIdx >= 0 && conditionOutcome) {
      const conditionPos = indices.indexOf(conditionIdx) + 1
      const matched =
        conditionOutcome === 'champion'
          ? conditionPos === 1
          : conditionOutcome === 'top4'
            ? conditionPos <= 4
            : conditionPos > numTeams - RELEGATION_SLOTS
      if (matched) {
        conditionMatchCount++
        if (conditionMatches.length < MAX_CONDITION_MATCHES) {
          conditionMatches.push(captureUniverse())
        }
      }
    }

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

  const detailed: DetailedLeagueSimulation = { standings }
  if (sampleCap > 0) {
    // Reservoir order is arbitrary after replacements — sort by run index
    // so the browser reads chronologically.
    reservoir.sort((a, b) => a.universe_id - b.universe_id)
    detailed.sampled_universes = reservoir
  }
  if (conditionRequested) {
    detailed.condition_matches = conditionMatches
    detailed.condition_match_count = conditionMatchCount
  }
  return detailed
}
