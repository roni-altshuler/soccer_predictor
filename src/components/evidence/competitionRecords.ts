/**
 * Per-competition evidence, derived from the artifacts that carry it.
 *
 * `/evaluation` is organised by competition because that is the unit the
 * evidence exists in, and the pooled headline actively hides the spread: the
 * .59303 walk-forward Brier is an average over the top five leagues whose
 * members run from .56873 to .62101. A reader looking at MLS is not helped by
 * the Portuguese number folded into it.
 *
 * The league side needs no derivation — `season_projections.json` carries a
 * `measured` block per league. The tournament side does: `bracket_backtest.json`
 * records one row per reconstructed tournament, so a competition's record is a
 * fold over its own rows. That fold is here, as pure functions, because it is
 * the part that can be wrong in a way the eye cannot catch.
 */

export interface BracketEventRow {
  competition: string
  season: number
  field: number
  model_p: number
  elo_p: number
  uniform_p: number
  model_top1_hit: number
  elo_leader_hit: number
  model_top3_hit: number
}

export interface TrophyRecord {
  competitionId: string
  editions: number
  seasons: number[]
  /** Mean −ln(p) on the team that actually lifted it. Lower is better. */
  logLoss: number
  eloLogLoss: number
  uniformLogLoss: number
  /** Share of editions where the model's favourite won it. */
  top1: number
  eloTop1: number
  top3: number
  meanP: number
}

/**
 * Log loss on a single outcome.
 *
 * Clamped at 1e-6 rather than allowed to reach infinity. A recorded champion
 * the simulation gave exactly zero would be a data fault — every team in a
 * bracket has some path — and one infinite term would swallow a competition's
 * whole mean, turning a bug in one edition into a blank panel with no clue
 * why. Clamped, the same fault shows up as an implausibly bad number that can
 * be traced to its season.
 */
const FLOOR = 1e-6
const surprisal = (p: number) => -Math.log(Math.max(p, FLOOR))

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * One competition's trophy record, or null when it has no backtested editions.
 *
 * Returning null rather than a zeroed record is deliberate: a competition with
 * no evidence must render nothing, and a record of zeros renders as a
 * catastrophically bad model.
 */
export function trophyRecord(
  events: BracketEventRow[],
  competitionId: string,
): TrophyRecord | null {
  const rows = events.filter(
    (e) => e.competition === competitionId && Number.isFinite(e.model_p),
  )
  if (!rows.length) return null

  return {
    competitionId,
    editions: rows.length,
    seasons: rows.map((r) => r.season).sort((a, b) => a - b),
    logLoss: mean(rows.map((r) => surprisal(r.model_p))),
    eloLogLoss: mean(rows.map((r) => surprisal(r.elo_p))),
    uniformLogLoss: mean(rows.map((r) => surprisal(r.uniform_p))),
    top1: mean(rows.map((r) => (r.model_top1_hit ? 1 : 0))),
    eloTop1: mean(rows.map((r) => (r.elo_leader_hit ? 1 : 0))),
    top3: mean(rows.map((r) => (r.model_top3_hit ? 1 : 0))),
    meanP: mean(rows.map((r) => r.model_p)),
  }
}

/** Every competition with at least one backtested edition, most-measured first. */
export function competitionsWithTrophyRecord(events: BracketEventRow[]): string[] {
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.competition, (counts.get(e.competition) ?? 0) + 1)
  return [...counts.keys()]
}

export interface LeagueMeasured {
  n_scored?: number
  brier?: number
  log_loss?: number
  accuracy?: number
  uniform?: number
  base_rate?: number
  always_home?: number
}

export interface BaselineRow {
  label: string
  value: number
  /** The model's own row, for the bar that should read as the short one. */
  isModel?: boolean
}

/**
 * The model against the three baselines that admitted its league to the site.
 *
 * Brier only — `always_home` is scored on the same summed convention, which is
 * why it can exceed 1 and why it is not silently rendered as a percentage.
 * Rows with no number are dropped rather than shown as zero: zero Brier is
 * perfection, and an absent baseline drawn as a full-length bar would read as
 * the model being beaten by nothing at all.
 */
export function baselineRows(m: LeagueMeasured): BaselineRow[] {
  const rows: BaselineRow[] = [
    { label: 'This model', value: m.brier ?? NaN, isModel: true },
    { label: 'A one-in-three guess', value: m.uniform ?? NaN },
    { label: "The league's own base rate", value: m.base_rate ?? NaN },
    { label: 'Backing the home side every time', value: m.always_home ?? NaN },
  ]
  return rows.filter((r) => Number.isFinite(r.value) && r.value > 0)
}
