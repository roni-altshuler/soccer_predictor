import path from 'path'

import { NextResponse } from 'next/server'
import { readOptionalArtifact } from '@/lib/server/readOptionalArtifact'

/**
 * The tournament layer's measured record.
 *
 * Two artifacts, one payload:
 *   knockout_model.json   — per-TIE advancement: the ladder, calibration,
 *                           per-round accuracy, permutation importance.
 *   bracket_backtest.json — whole brackets simulated to a champion.
 *
 * Written by `backend/scripts/benchmark_knockout.py` and
 * `backend/scripts/backtest_brackets.py`. Like the rest of `/api/v1/*`, this
 * reads committed artifacts off disk — FastAPI is not deployed on Vercel.
 *
 * Either file may be absent (they are regenerable, not required), and the
 * page renders an honest empty state rather than a 500. Both being absent is
 * `available: false`; one present is served on its own, because the tie model
 * and the bracket simulation are separate claims and neither needs the other
 * to be readable.
 * Read/parse failures return 503, distinct from genuinely absent files.
 */
export const dynamic = 'force-dynamic'

const DIAGNOSTICS = path.join(process.cwd(), 'backend', 'data', 'diagnostics')

export async function GET() {
  try {
    const [ties, brackets] = await Promise.all([
      readOptionalArtifact(path.join(DIAGNOSTICS, 'knockout_model.json')),
      readOptionalArtifact(path.join(DIAGNOSTICS, 'bracket_backtest.json')),
    ])

    if (!ties && !brackets) {
      return NextResponse.json({ available: false, reason: 'the tournament benchmarks have not been run here' })
    }

    return NextResponse.json({ available: true, ties, brackets })
  } catch {
    return NextResponse.json(
      { available: false, reason: 'The tournament record could not be read' },
      { status: 503 },
    )
  }
}
