import { currentSeasonYear, isCalendarYearLeague, seasonLabel, seasonOptions } from '@/lib/seasons'

/**
 * The season a league page opens on.
 *
 * This existed as a hard-coded array topping out at 2025-26 with the default
 * pinned to '2025'. Once the 2026-27 season came round, every league page
 * opened on last season's table and last season's top scorers — and the
 * current season was not in the dropdown at all. The page looked entirely
 * correct while doing it, which is why the rule is pinned here rather than
 * left to whoever next remembers to edit the array.
 *
 * Dates are injected, so these assertions do not start failing in July.
 */

const at = (iso: string) => new Date(`${iso}T12:00:00Z`)

describe('currentSeasonYear', () => {
  it('rolls a split-year league over in the summer', () => {
    // 2026-27 is "2026" to every provider: they key on the year it starts.
    expect(currentSeasonYear(false, at('2026-08-13'))).toBe(2026)
    expect(currentSeasonYear(false, at('2026-07-01'))).toBe(2026)
  })

  it('keeps a split-year league on the season still being played', () => {
    // May 2026 is the back end of 2025-26, not the front of 2026-27.
    expect(currentSeasonYear(false, at('2026-05-20'))).toBe(2025)
    expect(currentSeasonYear(false, at('2026-01-02'))).toBe(2025)
  })

  it('rolls in July, before any league kicks off', () => {
    // Champions League qualifying and the Community Shield are played before
    // the first league match, and a reader looking at them is looking at the
    // new season.
    expect(currentSeasonYear(false, at('2026-06-30'))).toBe(2025)
    expect(currentSeasonYear(false, at('2026-07-01'))).toBe(2026)
  })

  it('treats a calendar-year league as its own year', () => {
    // MLS runs February to November; there is no rollover to get wrong.
    expect(currentSeasonYear(true, at('2026-08-13'))).toBe(2026)
    expect(currentSeasonYear(true, at('2026-02-01'))).toBe(2026)
  })
})

describe('seasonLabel', () => {
  it('writes a split-year season the way the calendar reads', () => {
    expect(seasonLabel(2026, false)).toBe('2026-27')
    expect(seasonLabel(2025, false)).toBe('2025-26')
  })

  it('pads the century rollover rather than printing 2099-100', () => {
    expect(seasonLabel(2099, false)).toBe('2099-00')
    expect(seasonLabel(2009, false)).toBe('2009-10')
  })

  it('leaves a calendar-year season as the bare year', () => {
    expect(seasonLabel(2026, true)).toBe('2026')
  })
})

describe('seasonOptions', () => {
  it('opens on the season being played, not the one just finished', () => {
    const [first] = seasonOptions(false, 5, at('2026-08-13'))
    expect(first).toEqual({ value: '2026', label: '2026-27' })
  })

  it('offers earlier seasons to walk back through, newest first', () => {
    const opts = seasonOptions(false, 4, at('2026-08-13'))
    expect(opts.map((o) => o.label)).toEqual(['2026-27', '2025-26', '2024-25', '2023-24'])
  })

  it('never offers a season after the current one', () => {
    // A season that has not started has no fixtures, and an empty table in
    // front of a reader reads as a real one.
    const opts = seasonOptions(false, 6, at('2026-08-13'))
    expect(Math.max(...opts.map((o) => Number(o.value)))).toBe(2026)
  })

  it('tracks the clock instead of a list someone has to remember to edit', () => {
    // The whole point: a year later, without a code change, the page opens on
    // the right season.
    expect(seasonOptions(false, 1, at('2027-09-01'))[0].label).toBe('2027-28')
    expect(seasonOptions(false, 1, at('2030-09-01'))[0].label).toBe('2030-31')
  })

  it('follows the calendar-year convention for MLS', () => {
    const opts = seasonOptions(true, 3, at('2026-08-13'))
    expect(opts.map((o) => o.label)).toEqual(['2026', '2025', '2024'])
  })
})

describe('isCalendarYearLeague', () => {
  // Two pages ask this now — the league page's season dropdown and the
  // directory's card label — and the wrong answer is invisible: "2026-27" on
  // an MLS card looks exactly like every other row and is simply false.
  it('knows MLS runs on a calendar year', () => {
    expect(isCalendarYearLeague('usa.1')).toBe(true)
    expect(isCalendarYearLeague('mls')).toBe(true)
  })

  it('treats a European top flight as a split season', () => {
    for (const id of ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'ned.1', 'por.1', 'tur.1']) {
      expect([id, isCalendarYearLeague(id)]).toEqual([id, false])
    }
  })

  it('labels each kind the way its own calendar reads', () => {
    expect(seasonLabel(2026, isCalendarYearLeague('usa.1'))).toBe('2026')
    expect(seasonLabel(2026, isCalendarYearLeague('eng.1'))).toBe('2026-27')
  })
})
