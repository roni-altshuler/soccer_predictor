/**
 * Shared number formatting + sample-size honesty rules for /accuracy.
 *
 * Two jobs:
 *
 * 1. **One formatter per quantity.** Before this module the page mixed
 *    43.6% / 62% / 0.210 / ±3.9pts / +18.3 with no shared rule, so columns
 *    never lined up and the same quantity was rendered two ways in two
 *    cards. Every numeric on the page now goes through here.
 *
 * 2. **Sample-size gating.** The tracker happily reports a 100% hit rate
 *    off a single settled pick. Rates like that are noise, and rendering
 *    them with the same visual authority as a 1,400-pick rate is the main
 *    thing that made this surface read as untrustworthy. The MIN_*
 *    thresholds below decide when a rate is worth ranking, worth a
 *    verdict chip, or worth showing at all.
 *
 * Reference points are *derived*, never guessed:
 *   - A three-way match outcome picked with no information lands 1 in 3.
 *   - The probability score below is the mean squared error across the
 *     three outcomes, so an even-odds (1/3, 1/3, 1/3) forecast always
 *     scores exactly 2/9 — ((1/3)² + (1/3)² + (2/3)²) / 3.
 */

/** Hit rate of an uninformed three-way pick. Exact, not an estimate. */
export const RANDOM_WINNER_RATE = 1 / 3

/**
 * The yardstick this page reports against: always pick the home team.
 *
 * Measured on 5,237 Wave A matches since 2023-08 (`benchmark_baselines.py`).
 * Nobody picks at random, so 1/3 is not a comparison anyone would make — it
 * flatters the model by nineteen points. The home side wins 43% of the time
 * and picking it needs no model at all, which makes it the honest floor for a
 * home/draw/away call.
 *
 * The fuller ladder — home floor, higher-rated side, this model, the closing
 * line — is served from `/api/v1/accuracy/baselines` and rendered by
 * `BaselineLadder`. This constant exists so the headline agrees with it.
 */
export const ALWAYS_HOME_RATE = 0.43

/**
 * Probability score of an even-odds forecast: the standard multiclass Brier,
 * summed over the three outcomes. Exactly 2/3.
 *
 * CONVENTION — read before changing. Brier has two forms in circulation:
 * summed over classes (uniform = .667) and mean over classes (uniform = .222,
 * i.e. summed / 3). Both are correct; mixing them on one page is not.
 *
 * The whole project uses the SUMMED form — the market benchmark, the .5666
 * closing-line target, penaltyblog's `multiclass_brier_score`, the pivot doc,
 * README and CLAUDE.md. This page previously used the mean form, which put
 * "0.212" next to a panel saying "0.637" for the same underlying quantity.
 *
 * The tracking route still emits the MEAN form, so callers must scale by
 * BRIER_SUMMED_FROM_MEAN before displaying. Change the value and the scale
 * together or you reintroduce the bug where a score looks ~3x better than the
 * yardstick it is printed beside.
 */
export const EVEN_ODDS_PROBABILITY_SCORE = 2 / 3

/**
 * The tracking API divides its Brier by 3 (`tracker.py`: `brier_sum += … / 3`).
 * Multiply by this at the display boundary to reach the summed convention.
 */
export const BRIER_SUMMED_FROM_MEAN = 3

/** A calibration bucket below this many picks is noise — no verdict, muted. */
export const MIN_BIN_SAMPLE = 20

/** A confidence tier below this many picks gets no stated-vs-delivered verdict. */
export const MIN_TIER_SAMPLE = 30

/** A league below this many settled picks is not worth ranking. */
export const MIN_LEAGUE_SAMPLE = 20

/** Below this many settled picks the whole surface carries a caveat. */
export const MIN_ROBUST_SAMPLE = 100

/** Rates need at least this many picks before they are shown at all. */
export const MIN_RATE_SAMPLE = 10

/** Percentage with one decimal — headline rates. */
export function pct1(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/** Percentage with no decimals — table cells and dense rows. */
export function pct0(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Probability score / any 0..1 quality score — always three decimals. */
export function score3(value: number): string {
  return value.toFixed(3)
}

/** A signed difference expressed in percentage points. */
export function signedPts(pointsDelta: number, digits = 1): string {
  const sign = pointsDelta > 0 ? '+' : pointsDelta < 0 ? '−' : ''
  return `${sign}${Math.abs(pointsDelta).toFixed(digits)} pts`
}

/** Counts always get thousands separators. */
export function count(value: number): string {
  return Math.round(value).toLocaleString()
}

/** "1,429 settled picks" / "1 settled pick". */
export function samplePhrase(n: number, noun = 'settled pick'): string {
  return `${count(n)} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * Plain-language read on a calibration gap, in the page's voice. Kept in
 * one place so the headline, the chart and the tooltip never disagree.
 * `null` when the sample is too small to characterise honestly.
 */
export function calibrationVerdict(
  gap: number | null,
  settled: number
): { label: string; tone: 'good' | 'fair' | 'weak' } | null {
  if (gap === null || !Number.isFinite(gap)) return null
  if (settled < MIN_RATE_SAMPLE) return null
  if (gap <= 0.05) return { label: 'Percentages track reality closely', tone: 'good' }
  if (gap <= 0.1) return { label: 'Percentages run a little off', tone: 'fair' }
  return { label: 'Percentages drift from reality', tone: 'weak' }
}
