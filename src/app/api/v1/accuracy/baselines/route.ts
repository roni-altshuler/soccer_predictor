import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

/**
 * Serves the baseline ladder — where the model sits against yardsticks a
 * reader would actually use.
 *
 * Written by `backend/scripts/benchmark_baselines.py`. This page used to
 * compare its hit rate to 1/3, a home/draw/away pick made at random, which
 * nobody makes. Against that floor the model reads as 19 points ahead;
 * against "pick whoever is rated higher" it is ahead by 0.4. Serving the
 * whole ladder is what lets the page state a position rather than a number
 * chosen to flatter it.
 *
 * Like the rest of `/api/v1/accuracy/*`, this reads the committed artifact
 * off disk — FastAPI is not deployed on Vercel.
 */
export const dynamic = 'force-dynamic'

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'diagnostics',
  'baseline_ladder.json',
)

export async function GET() {
  let raw: string
  try {
    raw = await fs.readFile(ARTIFACT, 'utf8')
  } catch {
    // Regenerable, not required. Absent means it has never been run here —
    // say so rather than 500, so the page renders an honest empty state.
    return NextResponse.json(
      { available: false, reason: 'baseline_ladder.json has not been generated' },
      { status: 200 },
    )
  }

  try {
    const parsed = JSON.parse(raw)
    return NextResponse.json({ available: true, ...parsed })
  } catch {
    return NextResponse.json(
      { available: false, reason: 'baseline_ladder.json is not valid JSON' },
      { status: 200 },
    )
  }
}
