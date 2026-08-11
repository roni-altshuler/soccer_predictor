import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

/**
 * Season projections — title, top four and relegation, per league.
 *
 * Written by `backend/scripts/forecast_season.py`. The probabilities come from
 * 20,000 Monte Carlo runs of the remaining fixtures, and each run draws one
 * strength offset per club and holds it for the whole season. That correlation
 * is not a detail: without it the same simulator made Bayern 93.3% for the
 * Bundesliga, against a bookmaker price nearer 70%.
 */
export const dynamic = 'force-dynamic'

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'predictions',
  'season_projections.json',
)

export async function GET() {
  try {
    const parsed = JSON.parse(await fs.readFile(ARTIFACT, 'utf8'))
    return NextResponse.json({ available: true, ...parsed })
  } catch {
    return NextResponse.json(
      { available: false, reason: 'season_projections.json has not been generated' },
      { status: 200 },
    )
  }
}
