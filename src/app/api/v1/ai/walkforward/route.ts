import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/**
 * Walk-forward backtest summary for the /ai transparency dashboard.
 *
 * Reads the committed `backend/data/diagnostics/walkforward_summary.json`
 * (per-league season-by-season backtest aggregates). League entries that
 * errored (e.g. `{"error": "no_eligible_seasons"}` for tournaments) are
 * skipped rather than rendered with fabricated zeros.
 */

export const dynamic = 'force-dynamic'

interface WalkforwardLeagueEntry {
  league: string
  accuracy_mean?: number
  accuracy_std?: number
  log_loss_mean?: number
  brier_mean?: number
  ece_mean?: number
  n_test_seasons?: number
  error?: string
}

export async function GET() {
  const file = path.join(process.cwd(), 'backend', 'data', 'diagnostics', 'walkforward_summary.json')

  if (!fs.existsSync(file)) {
    return NextResponse.json({ available: false })
  }

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      generated_at?: string
      leagues?: WalkforwardLeagueEntry[]
    }
    const leagues = (Array.isArray(data.leagues) ? data.leagues : []).filter(
      (l): l is Required<Omit<WalkforwardLeagueEntry, 'error'>> =>
        !l.error &&
        typeof l.league === 'string' &&
        typeof l.accuracy_mean === 'number' &&
        typeof l.log_loss_mean === 'number'
    )
    if (leagues.length === 0) {
      return NextResponse.json({ available: false })
    }
    return NextResponse.json({
      available: true,
      generated_at: data.generated_at ?? null,
      leagues,
    })
  } catch {
    return NextResponse.json({ available: false })
  }
}
