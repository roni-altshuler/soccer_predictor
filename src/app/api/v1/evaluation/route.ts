import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

/**
 * Model evaluation — historical and live, never merged.
 *
 * Written by `backend/scripts/evaluate_live.py`. The two blocks measure
 * different things on different samples:
 *
 *   historical  walk-forward over 43,433 matches. Retrospective: honest, but
 *               nobody saw those numbers before those kickoffs.
 *   live        the final pre-kickoff snapshot for each fixture that now has a
 *               result. Starts at zero and grows with the season.
 *
 * Both carry `basis`. A consumer that adds them together is reporting a number
 * that describes nothing, so the shape deliberately makes that awkward.
 */
export const dynamic = 'force-dynamic'

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'evaluation',
  'live.json',
)

export async function GET() {
  try {
    const parsed = JSON.parse(await fs.readFile(ARTIFACT, 'utf8'))
    return NextResponse.json({ available: true, ...parsed })
  } catch {
    return NextResponse.json(
      {
        available: false,
        reason: 'live.json has not been generated',
        live: { n: 0 },
      },
      { status: 200 },
    )
  }
}
