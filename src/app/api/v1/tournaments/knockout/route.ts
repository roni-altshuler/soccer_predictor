import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

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
 */
export const dynamic = 'force-dynamic'

const DIAGNOSTICS = path.join(process.cwd(), 'backend', 'data', 'diagnostics')

async function readArtifact(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DIAGNOSTICS, file), 'utf8'))
  } catch {
    return null
  }
}

export async function GET() {
  const [ties, brackets] = await Promise.all([
    readArtifact('knockout_model.json'),
    readArtifact('bracket_backtest.json'),
  ])

  if (!ties && !brackets) {
    return NextResponse.json(
      { available: false, reason: 'the tournament benchmarks have not been run here' },
      { status: 200 },
    )
  }

  return NextResponse.json({ available: true, ties, brackets })
}
