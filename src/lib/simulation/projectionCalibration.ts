/**
 * Apply the measured correction to season-projection probabilities.
 *
 * The Monte Carlo is overconfident in the middle-to-high band, and the
 * matchday-by-matchday backtest measures by how much over 20,324 scored
 * team-seasons: it says 85% relegated and it happens 76% of the time.
 *
 * That measurement used to be printed beside the table as a caveat — correct,
 * but it left the reader doing arithmetic the page could do. The mapping fitted
 * by `backend/scripts/fit_projection_calibrator.py` (isotonic regression of
 * observed frequency on stated probability) is applied here instead.
 *
 * TWO PROPERTIES THIS MUST PRESERVE, and both are easy to lose:
 *
 * 1. **Mass.** Exactly one club wins the league, so title probabilities across
 *    a league sum to 1. A per-value map does not respect that — pull the
 *    leader from .86 to .78 and the column no longer sums to a champion. Every
 *    metric is therefore rescaled to its known total after mapping.
 *
 * 2. **Order.** The isotonic map is monotone, and rescaling is a positive
 *    scalar, so a team ahead of another before the correction is still ahead
 *    after it. The table's ordering never changes; only the numbers on it do.
 *
 * The raw simulator output is what the backtest keeps scoring. This correction
 * lives at the display edge on purpose: fold it into the simulator and the next
 * backtest measures a calibration that has already been applied, which is the
 * loop that makes a model look better every time you check it.
 */

export interface CalibratorMetric {
  /** Ascending (stated, calibrated) pairs, anchored at (0,0) and (1,1). */
  knots: [number, number][]
  /** Total probability mass this metric carries across one league. */
  renormalise_to: number | null
  n: number
  ece_before: number
}

export interface ProjectionCalibrator {
  metrics: Record<string, CalibratorMetric>
  generated_at?: string
}

/** Piecewise-linear interpolation between the fitted knots. */
export function applyKnots(knots: [number, number][], p: number): number {
  if (!Number.isFinite(p)) return 0
  if (knots.length === 0) return p
  const x = Math.min(1, Math.max(0, p))

  if (x <= knots[0][0]) return knots[0][1]
  const last = knots[knots.length - 1]
  if (x >= last[0]) return last[1]

  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1]
    const [x1, y1] = knots[i]
    if (x <= x1) {
      const span = x1 - x0
      // Guard a degenerate knot pair rather than dividing by zero.
      if (span <= 0) return y1
      return y0 + ((x - x0) / span) * (y1 - y0)
    }
  }
  return last[1]
}

/**
 * Calibrate one league's values for one metric, preserving total mass.
 *
 * Returns the input unchanged when there is nothing to work with — no
 * calibrator, no values, or a mapped column that sums to zero (which would
 * make the rescale undefined). Silently returning raw numbers is the right
 * failure mode here: the projection is still the simulator's honest output,
 * and the caveat note stays on the page for exactly this case.
 */
export function calibrateColumn(
  values: number[],
  metric: CalibratorMetric | undefined,
): number[] {
  if (!metric || values.length === 0) return values

  const mapped = values.map((v) => applyKnots(metric.knots, v))
  const target = metric.renormalise_to
  if (target == null) return mapped

  const total = mapped.reduce((a, b) => a + b, 0)
  if (total <= 0) return values
  if (target > values.length) return mapped // more mass than teams: unsatisfiable

  // Rescale to the target mass, but a plain scalar multiply can push a value
  // past 1 — and clamping it there silently destroys the mass we just went to
  // the trouble of preserving. (Caught by test: five teams, top-4 mass 4,
  // column summed to 3.55 instead of 4.)
  //
  // So: scale, clamp the ones that hit the ceiling, then redistribute their
  // surplus across the teams that still have headroom, and repeat. This is
  // water-filling; it terminates because each round either converges or
  // permanently pins at least one more value at 1.
  let out = mapped.slice()
  const pinned = new Array<boolean>(values.length).fill(false)

  for (let iter = 0; iter < 32; iter++) {
    const pinnedMass = out.reduce((a, v, i) => a + (pinned[i] ? v : 0), 0)
    const freeMass = out.reduce((a, v, i) => a + (pinned[i] ? 0 : v), 0)
    const remaining = target - pinnedMass

    if (freeMass <= 0 || remaining <= 0) break
    const scale = remaining / freeMass
    if (Math.abs(scale - 1) < 1e-12) break

    let newlyPinned = false
    out = out.map((v, i) => {
      if (pinned[i]) return v
      const scaled = v * scale
      if (scaled >= 1) {
        pinned[i] = true
        newlyPinned = true
        return 1
      }
      return scaled
    })
    if (!newlyPinned) break
  }

  return out.map((v) => Math.min(1, Math.max(0, v)))
}

/**
 * The three displayed columns. Kept as an explicit list rather than an index
 * signature so this composes with `Standing` (and anything else) without
 * forcing those types to accept arbitrary keys.
 */
export interface ProjectedTeam {
  title_probability?: number
  top_4_probability?: number
  relegation_probability?: number
}

const COLUMNS = [
  ['title_probability', 'title'],
  ['top_4_probability', 'top_4'],
  ['relegation_probability', 'relegation'],
] as const

/**
 * Calibrate a whole projected table (returns new rows; the input is untouched).
 *
 * Row order is preserved — callers sort on `avg_final_position`, which this
 * does not modify, and the monotone map cannot reorder the columns anyway.
 */
export function calibrateProjection<T extends ProjectedTeam>(
  rows: T[],
  calibrator: ProjectionCalibrator | null | undefined,
): T[] {
  if (!calibrator?.metrics || rows.length === 0) return rows

  const out = rows.map((r) => ({ ...r }))
  for (const [field, metricName] of COLUMNS) {
    const metric = calibrator.metrics[metricName]
    if (!metric) continue
    const values = out.map((r) => Number(r[field]) || 0)
    // Nothing to calibrate if the column was never populated.
    if (values.every((v) => v === 0)) continue
    const calibrated = calibrateColumn(values, metric)
    out.forEach((r, i) => {
      r[field] = parseFloat(calibrated[i].toFixed(4))
    })
  }
  return out
}
