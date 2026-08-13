import {
  baselineRows,
  competitionsWithTrophyRecord,
  trophyRecord,
} from '@/components/evidence/competitionRecords'
import type { BracketEventRow } from '@/components/evidence/competitionRecords'

/**
 * The per-competition fold.
 *
 * `/evaluation` is organised per competition, and for the knockout layer that
 * means deriving a record from `bracket_backtest.json` rather than reading one
 * off. A fold is exactly the kind of code that can be wrong in a way nobody
 * sees: the page still draws a tidy panel, the numbers are simply somebody
 * else's.
 */

const event = (over: Partial<BracketEventRow>): BracketEventRow => ({
  competition: 'uefa.champions',
  season: 2020,
  field: 16,
  model_p: 0.2,
  elo_p: 0.15,
  uniform_p: 0.0625,
  model_top1_hit: 0,
  elo_leader_hit: 0,
  model_top3_hit: 0,
  ...over,
})

describe('trophyRecord', () => {
  it('returns null for a competition with no backtested edition', () => {
    // Not a zeroed record: zeros render as a catastrophically bad model, and
    // "we have not measured this" is a different statement from "it failed".
    expect(trophyRecord([event({})], 'fifa.world')).toBeNull()
    expect(trophyRecord([], 'uefa.champions')).toBeNull()
  })

  it('scores only the competition asked for', () => {
    const record = trophyRecord(
      [
        event({ competition: 'uefa.champions', season: 2020, model_p: 0.5 }),
        event({ competition: 'fifa.world', season: 2022, model_p: 0.01 }),
      ],
      'uefa.champions',
    )!
    expect(record.editions).toBe(1)
    expect(record.logLoss).toBeCloseTo(-Math.log(0.5), 10)
  })

  it('averages surprisal, not probability', () => {
    // The distinction matters: mean(-ln p) punishes the confident miss, and
    // -ln(mean p) does not. Two editions at 50% and 10%:
    //   mean surprisal = (0.6931 + 2.3026) / 2 = 1.4979
    //   surprisal of the mean (0.30) = 1.2040
    const record = trophyRecord(
      [event({ season: 2020, model_p: 0.5 }), event({ season: 2021, model_p: 0.1 })],
      'uefa.champions',
    )!
    expect(record.logLoss).toBeCloseTo(1.4979, 4)
    expect(record.logLoss).not.toBeCloseTo(1.204, 3)
    expect(record.meanP).toBeCloseTo(0.3, 10)
  })

  it('counts hit rates over the editions it holds', () => {
    const record = trophyRecord(
      [
        event({ season: 2020, model_top1_hit: 1, model_top3_hit: 1, elo_leader_hit: 0 }),
        event({ season: 2021, model_top1_hit: 0, model_top3_hit: 1, elo_leader_hit: 1 }),
        event({ season: 2022, model_top1_hit: 0, model_top3_hit: 0, elo_leader_hit: 0 }),
        event({ season: 2023, model_top1_hit: 0, model_top3_hit: 0, elo_leader_hit: 0 }),
      ],
      'uefa.champions',
    )!
    expect(record.top1).toBeCloseTo(0.25, 10)
    expect(record.top3).toBeCloseTo(0.5, 10)
    expect(record.eloTop1).toBeCloseTo(0.25, 10)
    expect(record.seasons).toEqual([2020, 2021, 2022, 2023])
  })

  it('survives a zero probability instead of returning infinity', () => {
    // A recorded champion the simulation gave exactly zero would be a data
    // fault. Unclamped, one such row makes the whole competition's mean
    // Infinity and the panel renders blank with no clue why.
    const record = trophyRecord([event({ model_p: 0 })], 'uefa.champions')!
    expect(Number.isFinite(record.logLoss)).toBe(true)
    expect(record.logLoss).toBeGreaterThan(10)
  })

  it('ignores a row with no probability rather than scoring it as zero', () => {
    const record = trophyRecord(
      [
        event({ season: 2020, model_p: 0.5 }),
        event({ season: 2021, model_p: undefined as unknown as number }),
      ],
      'uefa.champions',
    )!
    expect(record.editions).toBe(1)
  })
})

describe('competitionsWithTrophyRecord', () => {
  it('lists each competition once', () => {
    const ids = competitionsWithTrophyRecord([
      event({ competition: 'uefa.champions', season: 2020 }),
      event({ competition: 'uefa.champions', season: 2021 }),
      event({ competition: 'fifa.world', season: 2022 }),
    ])
    expect(ids.sort()).toEqual(['fifa.world', 'uefa.champions'])
  })
})

describe('baselineRows', () => {
  it('puts the model first and keeps every baseline it has', () => {
    const rows = baselineRows({
      brier: 0.58266,
      uniform: 0.66667,
      base_rate: 0.64322,
      always_home: 1.08758,
    })
    expect(rows.map((r) => r.value)).toEqual([0.58266, 0.66667, 0.64322, 1.08758])
    expect(rows[0].isModel).toBe(true)
  })

  it('drops a baseline it does not have rather than drawing it as zero', () => {
    // A zero Brier is perfection. Rendered as a bar of length zero next to the
    // model it would read as the model being beaten by nothing at all.
    const rows = baselineRows({ brier: 0.58, uniform: 0.66667 })
    expect(rows.map((r) => r.label)).toEqual(['This model', 'A one-in-three guess'])
  })

  it('returns nothing when there is no measured block at all', () => {
    expect(baselineRows({})).toEqual([])
  })
})
