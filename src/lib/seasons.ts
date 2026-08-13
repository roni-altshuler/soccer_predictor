/**
 * Which seasons a league page offers, derived rather than listed.
 *
 * The league page carried a hard-coded array topping out at 2025-26 with the
 * default pinned to `'2025'`. On 2026-08-13 — with the 2026-27 season about to
 * kick off — every league page therefore opened on LAST season's table and
 * last season's top scorers, and the newest season was not even in the
 * dropdown. Nothing said so; the page looked entirely correct.
 *
 * That is the same failure mode as a hard-coded playoff cut line: a literal
 * year stops being true and no code notices. The list is computed from the
 * clock now, so the season a reader lands on is always the one being played.
 */

/** Seasons offered, newest first. The first entry is what a page opens on. */
export interface SeasonOption {
  /** The value the providers key on — the starting year. */
  value: string
  /** What a reader calls it: "2026-27", or "2026" for a calendar-year league. */
  label: string
}

/**
 * The season currently being played, as its starting year.
 *
 * A split-year league rolls over in the summer: from July onwards the new
 * season is the current one, and ESPN keys it on the year it STARTS, so
 * 2026-27 is `2026`. A calendar-year league (MLS) is simply the year.
 *
 * July rather than August deliberately — the Champions League qualifying
 * rounds and the Community Shield are played before any league kicks off, and
 * a reader looking at them in July is looking at the new season.
 */
export function currentSeasonYear(isCalendarYear: boolean, now: Date = new Date()): number {
  const year = now.getFullYear()
  if (isCalendarYear) return year
  return now.getMonth() >= 6 ? year : year - 1
}

/** Label a season the way the competition's own calendar reads. */
export function seasonLabel(year: number, isCalendarYear: boolean): string {
  if (isCalendarYear) return String(year)
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`
}

/**
 * `count` seasons ending at the current one, newest first.
 *
 * Never forward: a season after the current one has no fixtures, and offering
 * it would put an empty table in front of a reader as though it were a real
 * one.
 */
export function seasonOptions(
  isCalendarYear: boolean,
  count = 6,
  now: Date = new Date(),
): SeasonOption[] {
  const current = currentSeasonYear(isCalendarYear, now)
  return Array.from({ length: Math.max(1, count) }, (_, i) => {
    const year = current - i
    return { value: String(year), label: seasonLabel(year, isCalendarYear) }
  })
}
