import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

/**
 * How well the season projections' stated confidence has actually held up —
 * read from the committed backtest artifact written by
 * `backend/scripts/backtest_season_projections.py`.
 *
 * This exists so the Title & Relegation page can print its own measured
 * overconfidence next to the numbers it is asking readers to believe. The
 * standing rule is that displayed confidence never exceeds measured
 * confidence; the projections are overconfident above ~40%, so the page has
 * to say so, and it has to say so with the current number rather than one
 * copied into JSX and left to rot.
 */
export const dynamic = 'force-dynamic'

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'diagnostics',
  'season_projection_summary.json',
)

interface Bin {
  range: [number, number]
  n: number
  mean_predicted: number
  observed_frequency: number
  gap: number
}

export async function GET() {
  let parsed: {
    generated_at?: string
    calibration?: { overall?: { n?: number; ece?: number; bins?: Bin[] } }
    coverage?: Record<string, unknown>
  }
  try {
    parsed = JSON.parse(await fs.readFile(ARTIFACT, 'utf8'))
  } catch {
    return NextResponse.json(
      { available: false, reason: 'season_projection_summary.json has not been generated' },
      { status: 200 },
    )
  }

  const overall = parsed.calibration?.overall
  const bins = overall?.bins ?? []

  // Only bins with enough observations to mean anything, and only the
  // confident end — that is where the miss is and where readers anchor.
  const MIN_BIN_N = 200
  const confident = bins.filter((b) => b.range[0] >= 0.4 && b.n >= MIN_BIN_N)

  // The single worst overstatement, which is the number worth printing.
  const worst = confident.reduce<Bin | null>(
    (acc, b) => (acc === null || b.gap < acc.gap ? b : acc),
    null,
  )

  return NextResponse.json({
    available: bins.length > 0,
    generated_at: parsed.generated_at ?? null,
    n: overall?.n ?? null,
    ece: overall?.ece ?? null,
    // Negative gap = stated more often than it happened.
    overstates: worst !== null && worst.gap < 0,
    worst_bin: worst
      ? {
          range: worst.range,
          n: worst.n,
          stated: worst.mean_predicted,
          happened: worst.observed_frequency,
          gap: worst.gap,
        }
      : null,
    bins: confident,
  })
}
