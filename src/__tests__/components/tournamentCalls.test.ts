import {
  callRecord,
  callsFor,
  competitionsWithCalls,
} from '@/components/evidence/tournamentCalls'

/**
 * The knockout layer's call record, per competition.
 *
 * `/accuracy` is organised per competition now, and for tournaments the only
 * record that exists is what each edition's forecast gave the team that
 * actually lifted it. Folding that per competition is the code between the
 * artifact and a page that names a competition — so a bug here attributes one
 * competition's record to another and looks entirely normal.
 */

const edition = (over: Record<string, unknown>) => ({
  competition_id: 'uefa.champions',
  season: 2025,
  actual_champion: 'Real Madrid',
  probability_on_actual: 0.2,
  called_it: false,
  ...over,
})

describe('callsFor', () => {
  it('keeps only editions that have both a champion and a forecast', () => {
    const calls = callsFor([
      edition({ season: 2025 }),
      // Under way: no champion yet, so no call to score.
      edition({ season: 2026, actual_champion: undefined, probability_on_actual: undefined }),
      // Finished, but nothing was forecast for it — a result, not a call.
      edition({ season: 2019, probability_on_actual: undefined }),
    ])
    expect(calls.map((c) => c.season)).toEqual([2025])
  })

  it('filters to one competition when asked', () => {
    const calls = callsFor(
      [edition({}), edition({ competition_id: 'fifa.world', season: 2022 })],
      'fifa.world',
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].competitionId).toBe('fifa.world')
  })

  it('returns editions newest first', () => {
    const calls = callsFor([
      edition({ season: 2021 }),
      edition({ season: 2026 }),
      edition({ season: 2023 }),
    ])
    expect(calls.map((c) => c.season)).toEqual([2026, 2023, 2021])
  })
})

describe('callRecord', () => {
  it('returns null rather than a zeroed record when nothing is measured', () => {
    // Zeros render as a model that got everything wrong; "not measured here"
    // is a different statement and the page must be able to tell them apart.
    expect(callRecord([])).toBeNull()
  })

  it('counts outright calls over the editions it holds', () => {
    const record = callRecord(
      callsFor([
        edition({ season: 2026, called_it: true }),
        edition({ season: 2025, called_it: false }),
        edition({ season: 2024, called_it: false }),
        edition({ season: 2023, called_it: true }),
      ]),
    )!
    expect(record.editions).toBe(4)
    expect(record.calledRate).toBeCloseTo(0.5, 10)
  })

  it('averages surprisal, not probability', () => {
    // mean(-ln p) punishes the confident miss; -ln(mean p) does not.
    // 50% and 10%: (0.6931 + 2.3026) / 2 = 1.4979, against 1.2040.
    const record = callRecord(
      callsFor([
        edition({ season: 2026, probability_on_actual: 0.5 }),
        edition({ season: 2025, probability_on_actual: 0.1 }),
      ]),
    )!
    expect(record.logLoss).toBeCloseTo(1.4979, 4)
    expect(record.meanP).toBeCloseTo(0.3, 10)
  })

  it('survives a zero probability instead of returning infinity', () => {
    const record = callRecord(callsFor([edition({ probability_on_actual: 0 })]))!
    expect(Number.isFinite(record.logLoss)).toBe(true)
    expect(record.logLoss).toBeGreaterThan(10)
  })

  it('names its most confident call and its biggest surprise', () => {
    const record = callRecord(
      callsFor([
        edition({ season: 2026, probability_on_actual: 0.31, actual_champion: 'Man City' }),
        edition({ season: 2025, probability_on_actual: 0.04, actual_champion: 'Villa' }),
        edition({ season: 2024, probability_on_actual: 0.19, actual_champion: 'Inter' }),
      ]),
    )!
    expect(record.best?.champion).toBe('Man City')
    expect(record.worst?.champion).toBe('Villa')
  })
})

describe('competitionsWithCalls', () => {
  it('lists each competition that has at least one settled call, once', () => {
    const ids = competitionsWithCalls([
      edition({ season: 2026 }),
      edition({ season: 2025 }),
      edition({ competition_id: 'fifa.world', season: 2022 }),
      // No champion — this competition has nothing to show.
      edition({ competition_id: 'uefa.euro', actual_champion: undefined }),
    ])
    expect(ids.sort()).toEqual(['fifa.world', 'uefa.champions'])
  })
})
