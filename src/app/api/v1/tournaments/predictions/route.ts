import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

/**
 * Forward tournament forecasts — the trophy odds, per competition.
 *
 * Written by `backend/scripts/predict_tournaments.py`. Each competition
 * carries a `status` that the UI must respect rather than flatten:
 *
 *   live            knockout matches remain; the odds are a real forecast
 *   completed       nothing left to predict, so the odds shown are the ones
 *                   made BEFORE the knockout stage, next to who actually won
 *   awaiting_draw   no bracket yet, so no odds at all — only a power ranking
 *
 * Collapsing those three into one "predictions" list is how a power ranking
 * ends up being read as a forecast, so the field is served through untouched.
 */
export const dynamic = 'force-dynamic'

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'predictions',
  'tournaments.json',
)

export async function GET() {
  try {
    const parsed = JSON.parse(await fs.readFile(ARTIFACT, 'utf8'))
    return NextResponse.json({ available: true, ...parsed })
  } catch {
    return NextResponse.json(
      { available: false, reason: 'tournaments.json has not been generated' },
      { status: 200 },
    )
  }
}
