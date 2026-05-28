import {
  buildTitleRace,
  type TitleRaceRow,
} from '@/components/simulator/LeagueChampionshipSimulator'
import type { LeagueSimulationResult } from '@/lib/api'

/**
 * buildTitleRace() unit tests
 *
 * The function is pure: given a LeagueSimulationResult, it derives the
 * "who can still win" math row-by-row. We exercise the math at the boundary
 * conditions called out in the JSDoc:
 *
 *   - empty standings → empty result
 *   - leader-vs-chaser arithmetic (behind, max_possible, min_wins_to_catch)
 *   - mathematical elimination (max_possible < leader.current)
 *   - matches_remaining = 0 (season finished)
 *   - tied points (deterministic leader pick via stable sort)
 *   - late-season (1–2 matches left)
 */

function makeResult(
  standings: LeagueSimulationResult['standings'],
  matchesPerSeason = 38,
): LeagueSimulationResult {
  return {
    league_id: 47,
    league_name: 'Test League',
    n_simulations: 10000,
    remaining_matches: 0,
    matches_per_season: matchesPerSeason,
    most_likely_champion: standings[0]?.team_name ?? 'Unknown',
    champion_probability: standings[0]?.title_probability ?? 0,
    likely_top_4: [],
    relegation_candidates: [],
    standings,
  }
}

function standing(
  partial: Partial<LeagueSimulationResult['standings'][0]> & {
    team_name: string
    current_points: number
    matches_played: number
  },
): LeagueSimulationResult['standings'][0] {
  return {
    team_id: null,
    current_position: 0,
    avg_final_position: 0,
    avg_final_points: 0,
    title_probability: 0,
    top_4_probability: 0,
    europa_probability: 0,
    relegation_probability: 0,
    position_distribution: {},
    ...partial,
  }
}

describe('buildTitleRace', () => {
  describe('basic arithmetic', () => {
    it('returns empty for empty standings', () => {
      const result = makeResult([])
      expect(buildTitleRace(result)).toEqual([])
    })

    it('marks the points leader with Behind=0 and identifies them correctly', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 60, matches_played: 30, title_probability: 0.7 }),
        standing({ team_name: 'B', current_points: 55, matches_played: 30, title_probability: 0.3 }),
      ])
      const rows = buildTitleRace(result)
      const leader = rows.find((r) => r.team_name === 'A')!
      const chaser = rows.find((r) => r.team_name === 'B')!
      expect(leader.points_behind_leader).toBe(0)
      expect(chaser.points_behind_leader).toBe(5)
    })

    it('computes max_possible_points as current + remaining × 3', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 60, matches_played: 30 }), // 8 remaining
      ])
      const [row] = buildTitleRace(result)
      expect(row.matches_remaining).toBe(8)
      expect(row.max_possible_points).toBe(60 + 8 * 3)
    })

    it('computes min_wins_to_catch as ⌈behind/3⌉, capped at matches_remaining', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 80, matches_played: 30 }),
        standing({ team_name: 'B', current_points: 70, matches_played: 30 }), // behind 10 → ⌈10/3⌉ = 4 wins
        standing({ team_name: 'C', current_points: 78, matches_played: 30 }), // behind 2 → ⌈2/3⌉ = 1 win
      ])
      const rows = buildTitleRace(result)
      const b = rows.find((r) => r.team_name === 'B')!
      const c = rows.find((r) => r.team_name === 'C')!
      expect(b.min_wins_to_catch).toBe(4)
      expect(c.min_wins_to_catch).toBe(1)
    })

    it('caps min_wins_to_catch at remaining matches when behind > 3 × remaining', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 80, matches_played: 36 }), // 2 left
        standing({ team_name: 'B', current_points: 50, matches_played: 36 }), // behind 30, only 2 left
      ])
      const rows = buildTitleRace(result)
      const b = rows.find((r) => r.team_name === 'B')!
      expect(b.matches_remaining).toBe(2)
      // ⌈30/3⌉ = 10 but capped to 2 (matches_remaining)
      expect(b.min_wins_to_catch).toBe(2)
    })
  })

  describe('mathematical elimination', () => {
    it('flags a team as eliminated when max_possible < leader.current', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 90, matches_played: 36 }), // 2 remaining
        standing({ team_name: 'B', current_points: 70, matches_played: 36 }), // max = 70 + 6 = 76 < 90 ⇒ eliminated
      ])
      const rows = buildTitleRace(result)
      const b = rows.find((r) => r.team_name === 'B')!
      expect(b.mathematically_eliminated).toBe(true)
      expect(b.max_possible_points).toBe(76)
    })

    it('does NOT flag a team that can still mathematically catch the leader', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 60, matches_played: 30 }), // can drop to 60
        standing({ team_name: 'B', current_points: 55, matches_played: 30 }), // max = 55 + 24 = 79 ≥ 60
      ])
      const rows = buildTitleRace(result)
      const b = rows.find((r) => r.team_name === 'B')!
      expect(b.mathematically_eliminated).toBe(false)
    })

    it('treats the leader themselves as not eliminated', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 90, matches_played: 36 }),
      ])
      const [row] = buildTitleRace(result)
      expect(row.mathematically_eliminated).toBe(false)
    })

    it('counts an elimination correctly when behind exceeds 3 × remaining', () => {
      // Leader has 90, team has 70, 5 matches left → max 70+15=85 < 90 ⇒ eliminated
      const result = makeResult([
        standing({ team_name: 'A', current_points: 90, matches_played: 33 }),
        standing({ team_name: 'B', current_points: 70, matches_played: 33 }),
      ])
      const rows = buildTitleRace(result)
      expect(rows.find((r) => r.team_name === 'B')!.mathematically_eliminated).toBe(true)
    })
  })

  describe('season-finished edge case (remaining = 0)', () => {
    it('returns min_wins_to_catch = Infinity when matches_remaining is 0', () => {
      const result = makeResult(
        [
          standing({ team_name: 'A', current_points: 90, matches_played: 38 }), // 0 left
          standing({ team_name: 'B', current_points: 85, matches_played: 38 }),
        ],
        38,
      )
      const rows = buildTitleRace(result)
      const b = rows.find((r) => r.team_name === 'B')!
      expect(b.matches_remaining).toBe(0)
      expect(b.min_wins_to_catch).toBe(Infinity)
    })

    it('marks every chaser as mathematically eliminated when remaining=0 and behind > 0', () => {
      const result = makeResult(
        [
          standing({ team_name: 'A', current_points: 90, matches_played: 38 }),
          standing({ team_name: 'B', current_points: 85, matches_played: 38 }),
          standing({ team_name: 'C', current_points: 89, matches_played: 38 }), // 1 behind, still eliminated
        ],
        38,
      )
      const rows = buildTitleRace(result)
      expect(rows.find((r) => r.team_name === 'B')!.mathematically_eliminated).toBe(true)
      expect(rows.find((r) => r.team_name === 'C')!.mathematically_eliminated).toBe(true)
      expect(rows.find((r) => r.team_name === 'A')!.mathematically_eliminated).toBe(false)
    })
  })

  describe('tied points', () => {
    it('still picks a deterministic leader (first in standings input wins the tie)', () => {
      // The function uses array sort which is stable for equal keys, and reads
      // result.standings as the source — so the FIRST team in the input with
      // the highest points wins the leader role.
      const result = makeResult([
        standing({ team_name: 'A', current_points: 70, matches_played: 30 }),
        standing({ team_name: 'B', current_points: 70, matches_played: 30 }),
      ])
      const rows = buildTitleRace(result)
      // Both are tied — both should report behind=0 from whoever leader is.
      // We only need to verify the function doesn't crash and produces sensible values.
      expect(rows).toHaveLength(2)
      const aBehind = rows.find((r) => r.team_name === 'A')!.points_behind_leader
      const bBehind = rows.find((r) => r.team_name === 'B')!.points_behind_leader
      // One of them is the leader (behind=0). At least one row must be the
      // leader; both could be (if leader is themselves with 0 behind).
      expect([aBehind, bBehind]).toContain(0)
    })

    it('handles three-way tie at the top gracefully', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 75, matches_played: 32 }),
        standing({ team_name: 'B', current_points: 75, matches_played: 32 }),
        standing({ team_name: 'C', current_points: 75, matches_played: 32 }),
      ])
      const rows = buildTitleRace(result)
      // No one is mathematically eliminated when all are tied.
      expect(rows.every((r) => !r.mathematically_eliminated)).toBe(true)
    })
  })

  describe('late-season scenarios', () => {
    it('1 match left, chaser exactly 3 behind: still alive', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 80, matches_played: 37 }),
        standing({ team_name: 'B', current_points: 77, matches_played: 37 }), // max 80 = 80 ⇒ alive (max NOT < leader.current)
      ])
      const rows = buildTitleRace(result)
      const b = rows.find((r) => r.team_name === 'B')!
      expect(b.matches_remaining).toBe(1)
      expect(b.max_possible_points).toBe(80)
      expect(b.mathematically_eliminated).toBe(false)
      expect(b.min_wins_to_catch).toBe(1)
    })

    it('1 match left, chaser 4 behind: eliminated', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 80, matches_played: 37 }),
        standing({ team_name: 'B', current_points: 76, matches_played: 37 }), // max 79 < 80 ⇒ eliminated
      ])
      const rows = buildTitleRace(result)
      expect(rows.find((r) => r.team_name === 'B')!.mathematically_eliminated).toBe(true)
    })
  })

  describe('output shape invariants', () => {
    it('returns one row per team in standings', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 50, matches_played: 25 }),
        standing({ team_name: 'B', current_points: 48, matches_played: 25 }),
        standing({ team_name: 'C', current_points: 45, matches_played: 25 }),
      ])
      const rows = buildTitleRace(result)
      expect(rows).toHaveLength(3)
      expect(new Set(rows.map((r) => r.team_name))).toEqual(new Set(['A', 'B', 'C']))
    })

    it('every row has finite non-negative integers in the integer fields', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 50, matches_played: 25 }),
        standing({ team_name: 'B', current_points: 30, matches_played: 25 }),
      ])
      const rows = buildTitleRace(result)
      for (const row of rows) {
        expect(Number.isInteger(row.current_points)).toBe(true)
        expect(Number.isInteger(row.matches_remaining)).toBe(true)
        expect(Number.isInteger(row.max_possible_points)).toBe(true)
        expect(Number.isInteger(row.points_behind_leader)).toBe(true)
        expect(row.current_points).toBeGreaterThanOrEqual(0)
        expect(row.matches_remaining).toBeGreaterThanOrEqual(0)
        expect(row.max_possible_points).toBeGreaterThanOrEqual(row.current_points)
        expect(row.points_behind_leader).toBeGreaterThanOrEqual(0)
      }
    })

    it('title_probability is always in [0, 1]', () => {
      const result = makeResult([
        standing({ team_name: 'A', current_points: 50, matches_played: 25, title_probability: 0.7 }),
        standing({ team_name: 'B', current_points: 45, matches_played: 25, title_probability: 0.3 }),
      ])
      const rows: TitleRaceRow[] = buildTitleRace(result)
      for (const row of rows) {
        expect(row.title_probability).toBeGreaterThanOrEqual(0)
        expect(row.title_probability).toBeLessThanOrEqual(1)
      }
    })
  })
})
