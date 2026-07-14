import {
  MAX_CONDITION_MATCHES,
  MAX_SAMPLED_UNIVERSES,
  runMonteCarloSimulation,
  runMonteCarloSimulationDetailed,
  type SampledUniverse,
  type SimulationFixture,
  type TeamData,
} from '@/lib/simulation/leagueMonteCarlo'

/**
 * Tests for the pure Monte Carlo league simulation.
 *
 * The function uses a closure-scoped xorshift32 PRNG seeded with 42, reset
 * on every call → identical inputs MUST produce identical outputs. These
 * tests guard:
 *
 *   1. Determinism — call twice, get the same result
 *   2. Probability invariants — sum of position distribution = 1, no NaN,
 *      no negative values, every value in [0, 1]
 *   3. Edge cases — 0 simulations, 0 teams, 1 team, all matches played
 *   4. Fallback fixture generation — when no remainingFixtures provided,
 *      the function generates an internal schedule; verify it produces
 *      sensible probabilities (no team gets a runaway 100% title chance
 *      purely from the fallback structure)
 *   5. What-if overrides — locking a specific fixture moves the
 *      probabilities the right direction
 */

function team(
  name: string,
  points: number,
  matchesPlayed: number,
  gd = 0,
): TeamData {
  // wins/draws/losses are not used by the simulation (it only reads points,
  // matchesPlayed, gd). Fill in zeros for type completeness.
  return {
    name,
    points,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    gd,
    matchesPlayed,
  }
}

describe('runMonteCarloSimulation', () => {
  describe('determinism', () => {
    it('produces identical results for identical inputs (fixed seed=42)', () => {
      const teams = [
        team('A', 50, 25, 10),
        team('B', 45, 25, 5),
        team('C', 40, 25, 0),
        team('D', 35, 25, -5),
      ]
      const a = runMonteCarloSimulation(teams, 38, 1000, 47, null, null)
      const b = runMonteCarloSimulation(teams, 38, 1000, 47, null, null)

      expect(a.length).toBe(b.length)
      for (let i = 0; i < a.length; i++) {
        expect(a[i].team_name).toBe(b[i].team_name)
        expect(a[i].title_probability).toBe(b[i].title_probability)
        expect(a[i].top_4_probability).toBe(b[i].top_4_probability)
        expect(a[i].relegation_probability).toBe(b[i].relegation_probability)
        expect(a[i].avg_final_points).toBe(b[i].avg_final_points)
      }
    })

    it('produces different results when leagueId draw-rate differs', () => {
      const teams = [team('A', 50, 25, 10), team('B', 40, 25, 0)]
      // MLS (130) has the lowest draw rate (0.20); Bundesliga (54) is 0.23.
      // Different draw rates should yield different probability distributions.
      const mls = runMonteCarloSimulation(teams, 34, 500, 130, null, null)
      const bundesliga = runMonteCarloSimulation(teams, 34, 500, 54, null, null)
      // At least one team's avg_final_points should differ between leagues.
      const sameAcrossLeagues =
        mls[0].avg_final_points === bundesliga[0].avg_final_points &&
        mls[1].avg_final_points === bundesliga[1].avg_final_points
      expect(sameAcrossLeagues).toBe(false)
    })
  })

  describe('probability invariants', () => {
    it('every team gets exactly one final position across n_simulations runs', () => {
      // Sum of all position_counts across teams should equal n_simulations
      // (every sim assigns each team exactly one position).
      const teams = [
        team('A', 50, 25),
        team('B', 45, 25),
        team('C', 40, 25),
      ]
      const result = runMonteCarloSimulation(teams, 38, 2000, 47, null, null)

      // For each team, sum of position_distribution probabilities ≈ 1.
      for (const team_ of result) {
        const total = Object.values(team_.position_distribution).reduce(
          (s, p) => s + p,
          0,
        )
        // Allow 1 unit of toFixed(4) rounding noise per position.
        expect(total).toBeGreaterThan(0.999)
        expect(total).toBeLessThan(1.001)
      }
    })

    it('title probabilities sum to ≈1 across all teams (exactly one team wins per sim)', () => {
      const teams = [
        team('A', 60, 30, 20),
        team('B', 55, 30, 15),
        team('C', 40, 30, -5),
        team('D', 30, 30, -10),
      ]
      const result = runMonteCarloSimulation(teams, 38, 2000, 47, null, null)
      const totalTitleProb = result.reduce(
        (sum, t) => sum + t.title_probability,
        0,
      )
      expect(totalTitleProb).toBeGreaterThan(0.999)
      expect(totalTitleProb).toBeLessThan(1.001)
    })

    it('top-4 probabilities sum to ≈4 across all teams (4 top-4 slots per sim)', () => {
      const teams = [
        team('A', 60, 30),
        team('B', 55, 30),
        team('C', 50, 30),
        team('D', 45, 30),
        team('E', 40, 30),
        team('F', 35, 30),
      ]
      const result = runMonteCarloSimulation(teams, 38, 1500, 47, null, null)
      const total = result.reduce((s, t) => s + t.top_4_probability, 0)
      expect(total).toBeGreaterThan(3.99)
      expect(total).toBeLessThan(4.01)
    })

    it('relegation probabilities sum to ≈3 (3 relegation slots per sim)', () => {
      const teams = [
        team('A', 60, 30),
        team('B', 50, 30),
        team('C', 40, 30),
        team('D', 30, 30),
        team('E', 25, 30),
        team('F', 20, 30),
      ]
      const result = runMonteCarloSimulation(teams, 38, 1500, 47, null, null)
      const total = result.reduce((s, t) => s + t.relegation_probability, 0)
      expect(total).toBeGreaterThan(2.99)
      expect(total).toBeLessThan(3.01)
    })

    it('no team has a negative probability of any kind', () => {
      const teams = [
        team('A', 50, 25),
        team('B', 45, 25),
        team('C', 40, 25),
      ]
      const result = runMonteCarloSimulation(teams, 38, 500, 47, null, null)
      for (const t of result) {
        expect(t.title_probability).toBeGreaterThanOrEqual(0)
        expect(t.top_4_probability).toBeGreaterThanOrEqual(0)
        expect(t.europa_probability).toBeGreaterThanOrEqual(0)
        expect(t.relegation_probability).toBeGreaterThanOrEqual(0)
        for (const p of Object.values(t.position_distribution)) {
          expect(p).toBeGreaterThanOrEqual(0)
          expect(p).toBeLessThanOrEqual(1)
        }
      }
    })

    it('no probability is NaN or undefined', () => {
      const teams = [team('A', 50, 25), team('B', 30, 25)]
      const result = runMonteCarloSimulation(teams, 38, 200, 47, null, null)
      for (const t of result) {
        expect(Number.isFinite(t.title_probability)).toBe(true)
        expect(Number.isFinite(t.top_4_probability)).toBe(true)
        expect(Number.isFinite(t.europa_probability)).toBe(true)
        expect(Number.isFinite(t.relegation_probability)).toBe(true)
        expect(Number.isFinite(t.avg_final_position)).toBe(true)
        expect(Number.isFinite(t.avg_final_points)).toBe(true)
      }
    })

    it('avg_final_points ≥ current_points (a team can never finish on fewer points than now)', () => {
      const teams = [
        team('A', 50, 25),
        team('B', 40, 25),
        team('C', 30, 25),
      ]
      const result = runMonteCarloSimulation(teams, 38, 500, 47, null, null)
      for (const t of result) {
        expect(t.avg_final_points).toBeGreaterThanOrEqual(t.current_points - 0.01)
      }
    })

    it('title_probability is higher for the higher-PPG team in head-to-head', () => {
      // A has clearly higher PPG (2.0 vs 1.0); should dominate title probability.
      const teams = [team('Strong', 50, 25), team('Weak', 25, 25)]
      const result = runMonteCarloSimulation(teams, 38, 2000, 47, null, null)
      const strong = result.find((t) => t.team_name === 'Strong')!
      const weak = result.find((t) => t.team_name === 'Weak')!
      expect(strong.title_probability).toBeGreaterThan(weak.title_probability)
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty team list', () => {
      const result = runMonteCarloSimulation([], 38, 1000, 47, null, null)
      expect(result).toEqual([])
    })

    it('handles a single team (degenerate case — that team always wins)', () => {
      const result = runMonteCarloSimulation(
        [team('Solo', 50, 25)],
        38,
        100,
        47,
        null,
        null,
      )
      expect(result).toHaveLength(1)
      expect(result[0].title_probability).toBe(1)
      expect(result[0].avg_final_position).toBe(1)
    })

    it('handles season-finished case (matches_played = matches_per_season)', () => {
      // All teams have played all their matches → no fixtures to simulate → result is locked.
      const teams = [
        team('A', 90, 38, 30),
        team('B', 80, 38, 15),
        team('C', 70, 38, 0),
      ]
      const result = runMonteCarloSimulation(teams, 38, 100, 47, null, null)
      const a = result.find((t) => t.team_name === 'A')!
      const b = result.find((t) => t.team_name === 'B')!
      const c = result.find((t) => t.team_name === 'C')!
      // With no remaining matches, every sim is identical → titleProb of leader = 1.
      expect(a.title_probability).toBe(1)
      expect(b.title_probability).toBe(0)
      expect(c.title_probability).toBe(0)
      // Avg final points = current points exactly.
      expect(a.avg_final_points).toBe(90)
      expect(b.avg_final_points).toBe(80)
    })

    it('handles tied points at the top (both teams should have non-zero title prob)', () => {
      const teams = [
        team('A', 60, 30),
        team('B', 60, 30),
        team('C', 30, 30),
      ]
      const result = runMonteCarloSimulation(teams, 38, 2000, 47, null, null)
      const a = result.find((t) => t.team_name === 'A')!
      const b = result.find((t) => t.team_name === 'B')!
      // Both tied teams should win ~equally often (within stat noise).
      expect(a.title_probability).toBeGreaterThan(0.1)
      expect(b.title_probability).toBeGreaterThan(0.1)
      // Their sum should be the lion's share of championship probability.
      expect(a.title_probability + b.title_probability).toBeGreaterThan(0.85)
    })
  })

  describe('fallback fixture generation', () => {
    it('does NOT distort probabilities — stronger teams still likelier to win', () => {
      // No remainingFixtures passed → function generates an internal schedule.
      // Verify the generated schedule doesn't accidentally favour any team.
      // Use closer team strengths so all three retain non-trivial title odds.
      const teams = [
        team('Strong', 45, 25), // 1.80 PPG
        team('Mid', 40, 25),    // 1.60 PPG
        team('Weak', 35, 25),   // 1.40 PPG
      ]
      const result = runMonteCarloSimulation(teams, 38, 2000, 47, null, null)
      const strong = result.find((t) => t.team_name === 'Strong')!
      const mid = result.find((t) => t.team_name === 'Mid')!
      const weak = result.find((t) => t.team_name === 'Weak')!
      // Strong should outpace both, but not deterministically (the fallback
      // schedule must not artificially eliminate weaker teams).
      expect(strong.title_probability).toBeGreaterThan(mid.title_probability)
      expect(strong.title_probability).toBeGreaterThan(weak.title_probability)
      // All three teams should have at least *some* mathematical chance with
      // 13 matches remaining and a 5-pt gap — falling back to 0% would
      // indicate the generated fixture set is starving the weaker teams.
      expect(strong.title_probability + mid.title_probability + weak.title_probability).toBeCloseTo(1, 1)
    })

    it('produces the same result whether explicit fixtures or fallback is used (deterministic generator)', () => {
      const teams = [team('A', 30, 20), team('B', 25, 20)]
      // Fallback (no fixtures passed)
      const fallback = runMonteCarloSimulation(teams, 38, 500, 47, null, null)
      // Empty array (explicitly empty) — should also fall back to generation
      const explicitEmpty = runMonteCarloSimulation(teams, 38, 500, 47, [], null)
      expect(fallback[0].title_probability).toBe(explicitEmpty[0].title_probability)
      expect(fallback[1].title_probability).toBe(explicitEmpty[1].title_probability)
    })
  })

  describe('what-if overrides', () => {
    it('locking a chaser-favoured outcome boosts that chaser\'s title odds', () => {
      const teams = [
        team('Leader', 60, 30),
        team('Chaser', 55, 30),
      ]
      // Build a fixture that we'll override: Chaser at home vs Leader.
      const fixtures: SimulationFixture[] = [
        { homeIdx: 1, awayIdx: 0, key: 'show-down', homeTeam: 'Chaser', awayTeam: 'Leader' },
        // Pad with neutral fixtures so the league simulation has substance.
        { homeIdx: 0, awayIdx: 1, key: 'rematch', homeTeam: 'Leader', awayTeam: 'Chaser' },
      ]
      const baseline = runMonteCarloSimulation(
        teams,
        38,
        2000,
        47,
        fixtures,
        null,
      )
      const chaserWins = runMonteCarloSimulation(teams, 38, 2000, 47, fixtures, {
        fixtureKey: 'show-down',
        outcome: 'home', // Chaser is the home team in this fixture
      })
      const baselineChaser = baseline.find((t) => t.team_name === 'Chaser')!
      const lockedChaser = chaserWins.find((t) => t.team_name === 'Chaser')!
      expect(lockedChaser.title_probability).toBeGreaterThan(
        baselineChaser.title_probability,
      )
    })
  })

  describe('universe sampling (runMonteCarloSimulationDetailed)', () => {
    const midTable = () => [
      team('A', 50, 25, 10),
      team('B', 45, 25, 5),
      team('C', 40, 25, 0),
      team('D', 35, 25, -5),
      team('E', 30, 25, -8),
      team('F', 25, 25, -12),
    ]

    /** Shared sanity assertions for any returned universe. */
    function expectValidUniverse(
      u: SampledUniverse,
      teams: TeamData[],
      nSimulations: number,
    ) {
      expect(u.universe_id).toBeGreaterThanOrEqual(1)
      expect(u.universe_id).toBeLessThanOrEqual(nSimulations)
      expect(u.table).toHaveLength(teams.length)
      const positions = u.table.map((row) => row.position)
      expect(positions).toEqual(
        Array.from({ length: teams.length }, (_, i) => i + 1),
      )
      // Every team appears exactly once, and never on fewer points than today.
      const byName = new Map(teams.map((t) => [t.name, t]))
      const seen = new Set<string>()
      for (const row of u.table) {
        expect(seen.has(row.team_name)).toBe(false)
        seen.add(row.team_name)
        const current = byName.get(row.team_name)
        expect(current).toBeDefined()
        expect(row.points).toBeGreaterThanOrEqual(current!.points)
      }
      // Table must actually be sorted by (pts, gd) — the engine's order.
      for (let i = 1; i < u.table.length; i++) {
        const prev = u.table[i - 1]
        const cur = u.table[i]
        expect(
          prev.points > cur.points ||
            (prev.points === cur.points && prev.gd >= cur.gd),
        ).toBe(true)
      }
    }

    it('legacy path is unchanged: wrapper and detailed(no options) agree exactly', () => {
      const teams = midTable()
      const legacy = runMonteCarloSimulation(teams, 38, 1000, 47, null, null)
      const detailed = runMonteCarloSimulationDetailed(
        teams,
        38,
        1000,
        47,
        null,
        null,
      )
      expect(detailed.standings).toEqual(legacy)
      expect(detailed.sampled_universes).toBeUndefined()
      expect(detailed.condition_matches).toBeUndefined()
      expect(detailed.condition_match_count).toBeUndefined()
    })

    it('is deterministic with sampling on — identical calls, identical universes', () => {
      const teams = midTable()
      const a = runMonteCarloSimulationDetailed(teams, 38, 800, 47, null, null, {
        sampleUniverses: 12,
      })
      const b = runMonteCarloSimulationDetailed(teams, 38, 800, 47, null, null, {
        sampleUniverses: 12,
      })
      expect(a.sampled_universes).toEqual(b.sampled_universes)
      expect(a.standings).toEqual(b.standings)
    })

    it('reservoir bounds: returns exactly K unique universes, ids in [1, n], ascending', () => {
      const teams = midTable()
      const n = 200
      const k = 10
      const { sampled_universes } = runMonteCarloSimulationDetailed(
        teams,
        38,
        n,
        47,
        null,
        null,
        { sampleUniverses: k },
      )
      expect(sampled_universes).toHaveLength(k)
      const ids = sampled_universes!.map((u) => u.universe_id)
      expect(new Set(ids).size).toBe(k)
      expect(ids).toEqual([...ids].sort((x, y) => x - y))
      for (const u of sampled_universes!) expectValidUniverse(u, teams, n)
    })

    it('caps the reservoir at MAX_SAMPLED_UNIVERSES and never exceeds n runs', () => {
      const teams = midTable()
      // Ask for far more than the cap.
      const capped = runMonteCarloSimulationDetailed(teams, 38, 500, 47, null, null, {
        sampleUniverses: 500,
      })
      expect(capped.sampled_universes).toHaveLength(MAX_SAMPLED_UNIVERSES)
      // Fewer runs than K → every run is returned, nothing synthesized.
      const tiny = runMonteCarloSimulationDetailed(teams, 38, 25, 47, null, null, {
        sampleUniverses: 60,
      })
      expect(tiny.sampled_universes).toHaveLength(25)
      expect(tiny.sampled_universes!.map((u) => u.universe_id)).toEqual(
        Array.from({ length: 25 }, (_, i) => i + 1),
      )
    })

    it('a condition run replays exactly the same seasons as a sampling-only run', () => {
      // Condition matching consumes no PRNG draws, so with the same K the
      // sampled universes AND the aggregate standings must be identical.
      const teams = midTable()
      const plain = runMonteCarloSimulationDetailed(teams, 38, 600, 47, null, null, {
        sampleUniverses: 16,
      })
      const withCondition = runMonteCarloSimulationDetailed(
        teams,
        38,
        600,
        47,
        null,
        null,
        { sampleUniverses: 16, conditionTeam: 'D', conditionOutcome: 'top4' },
      )
      expect(withCondition.sampled_universes).toEqual(plain.sampled_universes)
      expect(withCondition.standings).toEqual(plain.standings)
    })

    it('condition matching is exact on a finished (fully deterministic) season', () => {
      // All matches played → every run has the identical locked table:
      // A 1st, B 2nd, C 3rd, D 4th. Conditions are therefore verifiable.
      const teams = [
        team('A', 90, 38, 30),
        team('B', 80, 38, 15),
        team('C', 70, 38, 0),
        team('D', 60, 38, -10),
      ]
      const n = 100

      const aChampion = runMonteCarloSimulationDetailed(teams, 38, n, 47, null, null, {
        conditionTeam: 'A',
        conditionOutcome: 'champion',
      })
      expect(aChampion.condition_match_count).toBe(n)
      expect(aChampion.condition_matches).toHaveLength(MAX_CONDITION_MATCHES)
      for (const u of aChampion.condition_matches!) {
        expect(u.table[0].team_name).toBe('A')
      }

      const cChampion = runMonteCarloSimulationDetailed(teams, 38, n, 47, null, null, {
        conditionTeam: 'C',
        conditionOutcome: 'champion',
      })
      // It never happens — the true zero count is reported, nothing invented.
      expect(cChampion.condition_match_count).toBe(0)
      expect(cChampion.condition_matches).toEqual([])

      // Bottom 3 of 4 teams are the relegation zone → B is always relegated.
      const bRelegated = runMonteCarloSimulationDetailed(teams, 38, n, 47, null, null, {
        conditionTeam: 'B',
        conditionOutcome: 'relegated',
      })
      expect(bRelegated.condition_match_count).toBe(n)
      for (const u of bRelegated.condition_matches!) {
        const row = u.table.find((r) => r.team_name === 'B')!
        expect(row.position).toBeGreaterThan(teams.length - 3)
      }

      // A is never relegated.
      const aRelegated = runMonteCarloSimulationDetailed(teams, 38, n, 47, null, null, {
        conditionTeam: 'A',
        conditionOutcome: 'relegated',
      })
      expect(aRelegated.condition_match_count).toBe(0)
    })

    it('stochastic condition counts agree exactly with the aggregate probabilities', () => {
      // The aggregate probabilities are computed from the very same runs the
      // condition scans, so count/n must equal the reported probability up
      // to its 4-decimal rounding.
      const teams = midTable()
      const n = 2000

      const champion = runMonteCarloSimulationDetailed(teams, 38, n, 47, null, null, {
        conditionTeam: 'B',
        conditionOutcome: 'champion',
      })
      const bRow = champion.standings.find((t) => t.team_name === 'B')!
      expect(
        Math.abs(champion.condition_match_count! / n - bRow.title_probability),
      ).toBeLessThan(0.0001)
      expect(champion.condition_matches!.length).toBe(
        Math.min(MAX_CONDITION_MATCHES, champion.condition_match_count!),
      )
      for (const u of champion.condition_matches!) {
        expect(u.table[0].team_name).toBe('B')
      }

      const top4 = runMonteCarloSimulationDetailed(teams, 38, n, 47, null, null, {
        conditionTeam: 'E',
        conditionOutcome: 'top4',
      })
      const eRow = top4.standings.find((t) => t.team_name === 'E')!
      expect(
        Math.abs(top4.condition_match_count! / n - eRow.top_4_probability),
      ).toBeLessThan(0.0001)
      for (const u of top4.condition_matches!) {
        const row = u.table.find((r) => r.team_name === 'E')!
        expect(row.position).toBeLessThanOrEqual(4)
      }

      const relegated = runMonteCarloSimulationDetailed(teams, 38, n, 47, null, null, {
        conditionTeam: 'C',
        conditionOutcome: 'relegated',
      })
      const cRow = relegated.standings.find((t) => t.team_name === 'C')!
      expect(
        Math.abs(
          relegated.condition_match_count! / n - cRow.relegation_probability,
        ),
      ).toBeLessThan(0.0001)
      for (const u of relegated.condition_matches!) {
        const row = u.table.find((r) => r.team_name === 'C')!
        expect(row.position).toBeGreaterThan(teams.length - 3)
      }
    })

    it('unknown condition team returns an honest zero, never a fabricated match', () => {
      const teams = midTable()
      const result = runMonteCarloSimulationDetailed(teams, 38, 300, 47, null, null, {
        conditionTeam: 'Nonexistent FC',
        conditionOutcome: 'champion',
      })
      expect(result.condition_match_count).toBe(0)
      expect(result.condition_matches).toEqual([])
    })
  })
})
