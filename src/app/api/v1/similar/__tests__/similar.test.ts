/**
 * Neighbour math + query resolution for the similar-matches retrieval layer
 * (`src/lib/match2vec.ts`, served by `/api/v1/similar/[matchId]`).
 *
 * All tests run against SYNTHETIC index rows — the committed artifact is
 * never read here.
 */

import {
  buildIndexFromRows,
  decodeVector,
  espnEventIdFromMatchId,
  matchHref,
  resolveEntryIn,
  selectNeighborsIn,
  toEspnLeague,
  toWarehouseCompetition,
  type Match2VecEntry,
  type RawRow,
} from '@/lib/match2vec'

const DIM = 4

function b64(ints: number[]): string {
  return Buffer.from(Int8Array.from(ints).buffer).toString('base64')
}

function row(
  id: string,
  vector: number[],
  overrides: Partial<{
    competitionId: string
    season: number | null
    date: string
    home: string
    away: string
    score: string
    gender: 'M' | 'F'
    facts: number[]
  }> = {}
): RawRow {
  return [
    id,
    overrides.competitionId ?? 'eng.1',
    overrides.season ?? 2024,
    overrides.date ?? '2024-05-01',
    overrides.home ?? 'Alpha FC',
    overrides.away ?? 'Beta United',
    overrides.score ?? '1-0',
    overrides.gender ?? 'M',
    b64(vector),
    overrides.facts ?? [0, 0, 0, 40, 40, 40, 0, 0],
  ]
}

function index(rows: RawRow[]) {
  return buildIndexFromRows(
    { schema: 1, feature_version: 1, dim: DIM, count: rows.length, generated_at: '' },
    rows
  )
}

describe('decodeVector', () => {
  it('produces a unit-normalised vector', () => {
    const vec = decodeVector(b64([127, 0, 0, 0]), DIM)!
    expect(Math.hypot(...vec)).toBeCloseTo(1, 6)
  })

  it('rejects wrong lengths and all-zero vectors', () => {
    expect(decodeVector(b64([127, 0]), DIM)).toBeNull()
    expect(decodeVector(b64([0, 0, 0, 0]), DIM)).toBeNull()
  })
})

describe('id helpers', () => {
  it('parses ESPN event ids out of warehouse match ids', () => {
    expect(espnEventIdFromMatchId('espn_eng.1_740957')).toBe('740957')
    expect(espnEventIdFromMatchId('espn_uefa.champions.w_401842608')).toBe('401842608')
    expect(espnEventIdFromMatchId('fd_premier_league_20260518_Arsenal_Burnley')).toBeNull()
  })

  it('maps women warehouse competition ids to ESPN league ids and back', () => {
    expect(toEspnLeague('eng.1.w')).toBe('eng.w.1')
    expect(toEspnLeague('eng.1')).toBe('eng.1')
    expect(toWarehouseCompetition('eng.w.1')).toBe('eng.1.w')
    expect(toWarehouseCompetition('usa.nwsl')).toBe('usa.1.w')
    expect(toWarehouseCompetition('ger.1')).toBe('ger.1')
  })

  it('links ESPN-sourced entries and leaves other sources unlinked', () => {
    const idx = index([
      row('espn_eng.1.w_754422', [127, 0, 0, 0], { competitionId: 'eng.1.w', gender: 'F' }),
      row('fd_x_y', [0, 127, 0, 0]),
    ])
    expect(matchHref(idx.entries[0])).toBe('/matches/754422?league=eng.w.1')
    expect(matchHref(idx.entries[1])).toBeNull()
  })
})

describe('resolveEntryIn', () => {
  const rows = [
    row('espn_eng.1_100', [127, 0, 0, 0], { date: '2024-05-01', home: 'Arsenal', away: 'Burnley' }),
    row('fd_league_x', [0, 127, 0, 0], {
      date: '2024-05-02',
      home: 'AFC Bournemouth',
      away: 'Manchester City',
    }),
    row('fd_wsl_y', [0, 0, 127, 0], {
      competitionId: 'eng.1.w',
      gender: 'F',
      date: '2024-05-03',
      home: 'Chelsea',
      away: 'Arsenal',
    }),
  ]

  it('resolves directly by ESPN event id', () => {
    const hit = resolveEntryIn(index(rows), { matchId: '100' })
    expect(hit?.id).toBe('espn_eng.1_100')
  })

  it('rejects a direct id hit that fixture context contradicts', () => {
    // A foreign id namespace colliding with an ESPN event id: date and both
    // team names disagree, so the direct hit must not be trusted.
    const hit = resolveEntryIn(index(rows), {
      matchId: '100',
      date: '2019-01-01',
      home: 'Real Madrid',
      away: 'Barcelona',
    })
    expect(hit).toBeNull()
  })

  it('resolves non-ESPN entries by fixture with normalized names and ±1 day', () => {
    const hit = resolveEntryIn(index(rows), {
      matchId: '999999',
      league: 'eng.1',
      date: '2024-05-01', // kickoff day off by one vs the warehouse date
      home: 'Bournemouth', // "AFC" prefix dropped by the normalizer
      away: 'Manchester City',
    })
    expect(hit?.id).toBe('fd_league_x')
  })

  it('maps the ESPN women league id onto the warehouse competition', () => {
    const hit = resolveEntryIn(index(rows), {
      matchId: '888888',
      league: 'eng.w.1',
      date: '2024-05-03',
      home: 'Chelsea',
      away: 'Arsenal',
    })
    expect(hit?.id).toBe('fd_wsl_y')
  })

  it('refuses ambiguous fixture matches', () => {
    const dup = [
      ...rows,
      row('fd_league_x2', [0, 0, 0, 127], {
        date: '2024-05-02',
        home: 'AFC Bournemouth',
        away: 'Manchester City',
      }),
    ]
    const hit = resolveEntryIn(index(dup), {
      matchId: '999999',
      league: 'eng.1',
      date: '2024-05-02',
      home: 'AFC Bournemouth',
      away: 'Manchester City',
    })
    expect(hit).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(
      resolveEntryIn(index(rows), {
        matchId: 'nope',
        league: 'eng.1',
        date: '2024-05-01',
        home: 'X',
        away: 'Y',
      })
    ).toBeNull()
  })
})

describe('selectNeighborsIn', () => {
  function entriesOf(rows: RawRow[]): Match2VecEntry[] {
    return index(rows).entries
  }

  it('ranks by cosine similarity and excludes the query itself', () => {
    const entries = entriesOf([
      row('q', [100, 10, 0, 25], { date: '2024-01-01' }),
      row('near', [98, 12, 0, 25], { date: '2023-02-02', home: 'C', away: 'D' }),
      row('mid', [60, 60, 0, 25], { date: '2022-03-03', home: 'E', away: 'F' }),
      row('far', [-100, 0, 0, 25], { date: '2021-04-04', home: 'G', away: 'H' }),
    ])
    const query = entries.find((e) => e.id === 'q')!
    const picked = selectNeighborsIn(entries, query, 3).map((e) => e.id)
    expect(picked).toEqual(['near', 'mid', 'far'])
    expect(selectNeighborsIn(entries, query, 2).map((e) => e.id)).toEqual(['near', 'mid'])
  })

  it('excludes duplicates of the query fixture and dedupes neighbour fixtures', () => {
    const entries = entriesOf([
      row('q', [100, 0, 0, 25], { date: '2024-01-01', home: 'Alpha FC', away: 'Beta United' }),
      // Same fixture under another source id — must never be listed.
      row('dup_of_q', [100, 0, 0, 25], {
        date: '2024-01-02',
        home: 'Alpha FC',
        away: 'Beta United',
      }),
      row('n1', [99, 5, 0, 25], { date: '2020-01-01', home: 'C', away: 'D' }),
      // Same fixture as n1 from a second source — only one may appear.
      row('n1_dup', [99, 6, 0, 25], { date: '2020-01-01', home: 'C', away: 'D' }),
      row('n2', [90, 20, 0, 25], { date: '2019-01-01', home: 'E', away: 'F' }),
    ])
    const query = entries.find((e) => e.id === 'q')!
    const picked = selectNeighborsIn(entries, query, 4).map((e) => e.id)
    expect(picked).not.toContain('dup_of_q')
    expect(picked.filter((id) => id === 'n1' || id === 'n1_dup')).toHaveLength(1)
    expect(picked).toContain('n2')
  })

  it('ranks the query gender naturally without filtering the other out', () => {
    // Identical unfolding; only the gender dimension differs.
    const entries = entriesOf([
      row('q_f', [100, 10, 0, -25], { gender: 'F', date: '2024-01-01' }),
      row('same_f', [100, 10, 0, -25], { gender: 'F', date: '2023-01-01', home: 'C', away: 'D' }),
      row('same_m', [100, 10, 0, 25], { gender: 'M', date: '2022-01-01', home: 'E', away: 'F' }),
    ])
    const query = entries.find((e) => e.id === 'q_f')!
    const picked = selectNeighborsIn(entries, query, 2).map((e) => e.id)
    expect(picked).toEqual(['same_f', 'same_m'])
  })
})
