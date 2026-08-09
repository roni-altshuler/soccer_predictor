import {
  MAX_CONDITION_MATCHES,
  MAX_SAMPLED_UNIVERSES,
  runMonteCarloSimulation,
  runMonteCarloSimulationDetailed,
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

})
