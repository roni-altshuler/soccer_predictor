import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

/**
 * Serves the committed market benchmark — the only honest yardstick this
 * product has.
 *
 * Reads `backend/data/diagnostics/market_benchmark.json`, written by
 * `backend/scripts/benchmark_market.py`. FastAPI is not deployed on Vercel, so
 * like the rest of `/api/v1/tracking/*` this route reads the committed artifact
 * directly off disk.
 *
 * Two blocks matter to the UI:
 *   - `market_corpus`  — what the closing line scores over ~25.7k fixtures.
 *                        This is the TARGET, and it is what makes the model's
 *                        number readable.
 *   - `paired_benchmark` — model vs market on the identical fixtures where both
 *                        priced the match. Small n by design; the coverage
 *                        block says exactly how small and why.
 */
export const dynamic = 'force-dynamic'

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'diagnostics',
  'market_benchmark.json',
)

export async function GET() {
  let raw: string
  try {
    raw = await fs.readFile(ARTIFACT, 'utf8')
  } catch {
    // The artifact is regenerable, not required. A missing file means the
    // benchmark has never been run here — say so plainly rather than 500,
    // so the page can render an honest "not measured yet" state.
    return NextResponse.json(
      { available: false, reason: 'market_benchmark.json has not been generated' },
      { status: 200 },
    )
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    return NextResponse.json(
      { available: false, reason: 'market_benchmark.json is not valid JSON' },
      { status: 200 },
    )
  }

  return NextResponse.json({ available: true, ...parsed })
}
