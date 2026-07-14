import {
  runKnockoutSimulation,
  type KnockoutRoundKey,
  type KnockoutTeamInput,
} from '@/lib/simulation/knockoutMonteCarlo'

/**
 * Tests for the pure knockout Monte Carlo (TypeScript port of the Python
 * knockout simulator). Mirrors the leagueMonteCarlo test suite:
 *
 *   1. Determinism — closure-scoped xorshift32 seeded with 42, reset per
 *      call → identical inputs MUST produce identical outputs
 *   2. Probability invariants — winner probs sum to ≈1; per-team reach
 *      probabilities are monotonically non-increasing round by round;
 *      per-round reach sums match the number of slots in that round
 *   3. Strength ordering — the strongest side wins most often
 *   4. Bracket sizing — 4/8/16 fields expose the right rounds; fields
 *      between sizes pad with byes and stay well-formed
 */

function team(name: string, elo: number, extra: Partial<KnockoutTeamInput> = {}): KnockoutTeamInput {
  return { name, elo, ...extra }
}

function sixteenClubs(): KnockoutTeamInput[] {
  return [
    team('A', 2050, { group: 'A', group_position: 1, country: 'ES' }),
    team('B', 2030, { group: 'B', group_position: 1, country: 'EN' }),
    team('C', 2010, { group: 'C', group_position: 1, country: 'DE' }),
    team('D', 1990, { group: 'D', group_position: 1, country: 'FR' }),
    team('E', 1970, { group: 'E', group_position: 1, country: 'IT' }),
    team('F', 1950, { group: 'F', group_position: 1, country: 'PT' }),
    team('G', 1930, { group: 'G', group_position: 1, country: 'NL' }),
    team('H', 1910, { group: 'H', group_position: 1, country: 'ES' }),
    team('I', 1890, { group: 'A', group_position: 2, country: 'EN' }),
    team('J', 1870, { group: 'B', group_position: 2, country: 'DE' }),
    team('K', 1850, { group: 'C', group_position: 2, country: 'FR' }),
    team('L', 1830, { group: 'D', group_position: 2, country: 'IT' }),
    team('M', 1810, { group: 'E', group_position: 2, country: 'PT' }),
    team('N', 1790, { group: 'F', group_position: 2, country: 'NL' }),
    team('O', 1770, { group: 'G', group_position: 2, country: 'ES' }),
    team('P', 1750, { group: 'H', group_position: 2, country: 'EN' }),
  ]
}

const ROUND_ORDER: KnockoutRoundKey[] = ['quarter_finals', 'semi_finals', 'final', 'winner']

describe('runKnockoutSimulation', () => {
  describe('determinism', () => {
    it('produces identical results for identical inputs (fixed seed=42)', () => {
      const a = runKnockoutSimulation(sixteenClubs(), { kind: 'club', nSimulations: 500 })
      const b = runKnockoutSimulation(sixteenClubs(), { kind: 'club', nSimulations: 500 })
      expect(a).toEqual(b)
    })

    it('club and national formats yield different distributions for the same field', () => {
      const teams = sixteenClubs()
      const club = runKnockoutSimulation(teams, { kind: 'club', nSimulations: 500 })
      const national = runKnockoutSimulation(teams, { kind: 'national', nSimulations: 500 })
      const same = club.teams.every(
        (t) =>
          t.reach.winner === national.teams.find((n) => n.name === t.name)?.reach.winner,
      )
      expect(same).toBe(false)
    })
  })

  describe('probability invariants', () => {
    it('winner probabilities sum to ≈1 (exactly one champion per run)', () => {
      const result = runKnockoutSimulation(sixteenClubs(), { kind: 'national', nSimulations: 2000 })
      const total = result.teams.reduce((s, t) => s + (t.reach.winner ?? 0), 0)
      expect(total).toBeGreaterThan(0.999)
      expect(total).toBeLessThan(1.001)
    })

    it('per-team reach probabilities are monotonically non-increasing', () => {
      const result = runKnockoutSimulation(sixteenClubs(), { kind: 'club', nSimulations: 1500 })
      for (const t of result.teams) {
        const chain = ROUND_ORDER.filter((r) => result.rounds.includes(r)).map(
          (r) => t.reach[r] ?? 0,
        )
        for (let i = 1; i < chain.length; i++) {
          expect(chain[i]).toBeLessThanOrEqual(chain[i - 1])
        }
      }
    })

    it('per-round reach sums equal the round slot counts (8 QF, 4 SF, 2 finalists)', () => {
      const result = runKnockoutSimulation(sixteenClubs(), { kind: 'national', nSimulations: 1000 })
      const sum = (round: KnockoutRoundKey) =>
        result.teams.reduce((s, t) => s + (t.reach[round] ?? 0), 0)
      expect(sum('quarter_finals')).toBeCloseTo(8, 1)
      expect(sum('semi_finals')).toBeCloseTo(4, 1)
      expect(sum('final')).toBeCloseTo(2, 1)
    })

    it('every probability is finite and within [0, 1]', () => {
      const result = runKnockoutSimulation(sixteenClubs(), { kind: 'club', nSimulations: 400 })
      for (const t of result.teams) {
        for (const round of result.rounds) {
          const p = t.reach[round]
          expect(Number.isFinite(p)).toBe(true)
          expect(p).toBeGreaterThanOrEqual(0)
          expect(p).toBeLessThanOrEqual(1)
        }
      }
    })
  })

  describe('strength ordering', () => {
    it('the strongest team wins more often than the weakest', () => {
      const result = runKnockoutSimulation(sixteenClubs(), { kind: 'national', nSimulations: 3000 })
      const strongest = result.teams.find((t) => t.name === 'A')!
      const weakest = result.teams.find((t) => t.name === 'P')!
      expect(strongest.reach.winner ?? 0).toBeGreaterThan(weakest.reach.winner ?? 0)
    })

    it('a dominant rating produces a dominant winner probability', () => {
      const field = [
        team('Giant', 2400),
        team('Minnow 1', 1500),
        team('Minnow 2', 1500),
        team('Minnow 3', 1500),
      ]
      const result = runKnockoutSimulation(field, { kind: 'national', nSimulations: 2000 })
      expect(result.most_likely_winner).toBe('Giant')
      expect(result.winner_probability).toBeGreaterThan(0.5)
    })
  })

  describe('bracket sizing', () => {
    it('a 4-team field exposes final + winner rounds only', () => {
      const result = runKnockoutSimulation(
        [team('A', 2000), team('B', 1950), team('C', 1900), team('D', 1850)],
        { kind: 'club', nSimulations: 500 },
      )
      expect(result.bracket_size).toBe(4)
      expect(result.rounds).toEqual(['final', 'winner'])
      const finalSum = result.teams.reduce((s, t) => s + (t.reach.final ?? 0), 0)
      expect(finalSum).toBeCloseTo(2, 1)
    })

    it('an 8-team field exposes semi-finals', () => {
      const field = Array.from({ length: 8 }, (_, i) => team(`T${i}`, 1900 - i * 20))
      const result = runKnockoutSimulation(field, { kind: 'club', nSimulations: 500 })
      expect(result.bracket_size).toBe(8)
      expect(result.rounds).toEqual(['semi_finals', 'final', 'winner'])
    })

    it('a 16-team field exposes quarter-finals', () => {
      const result = runKnockoutSimulation(sixteenClubs(), { kind: 'national', nSimulations: 200 })
      expect(result.bracket_size).toBe(16)
      expect(result.rounds).toEqual(['quarter_finals', 'semi_finals', 'final', 'winner'])
    })

    it('pads in-between field sizes with byes and stays well-formed', () => {
      const field = Array.from({ length: 6 }, (_, i) => team(`T${i}`, 1900 - i * 30))
      const result = runKnockoutSimulation(field, { kind: 'national', nSimulations: 1000 })
      expect(result.bracket_size).toBe(8)
      const winnerSum = result.teams.reduce((s, t) => s + (t.reach.winner ?? 0), 0)
      expect(winnerSum).toBeGreaterThan(0.999)
      expect(winnerSum).toBeLessThan(1.001)
      for (const t of result.teams) {
        expect(t.reach.semi_finals).toBeGreaterThanOrEqual(t.reach.final ?? 0)
      }
    })

    it('throws for fewer than 2 teams', () => {
      expect(() =>
        runKnockoutSimulation([team('Solo', 1800)], { kind: 'club', nSimulations: 100 }),
      ).toThrow()
    })
  })
})
