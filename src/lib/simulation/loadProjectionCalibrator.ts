import fs from 'fs'
import path from 'path'

import type { ProjectionCalibrator } from '@/lib/simulation/projectionCalibration'

/**
 * Reads the committed projection calibrator off disk, once per process.
 *
 * Server-only: FastAPI is not deployed on Vercel, so like the rest of the
 * diagnostics surfaces this reads the artifact directly. Written by
 * `backend/scripts/fit_projection_calibrator.py` from the season-projection
 * backtest.
 *
 * A missing or malformed artifact is not an error. `calibrateProjection`
 * passes rows through untouched when handed null, so the projections still
 * render — as the simulator's raw output, which is what they were before this
 * existed. The measured-overconfidence note stays on the page for that case.
 */

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'diagnostics',
  'projection_calibrator.json',
)

let cached: ProjectionCalibrator | null | undefined

export function loadProjectionCalibrator(): ProjectionCalibrator | null {
  if (cached !== undefined) return cached
  try {
    const parsed = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8')) as ProjectionCalibrator
    cached = parsed?.metrics ? parsed : null
  } catch {
    cached = null
  }
  return cached
}

/** Test seam — drops the memoised artifact. */
export function resetProjectionCalibratorCache(): void {
  cached = undefined
}
