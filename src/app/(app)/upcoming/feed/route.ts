import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

import { getLeagueAccent } from '@/lib/leagueAccents'

/**
 * Month feed for the /upcoming calendar.
 *
 * Reads the committed prediction log (`backend/data/predictions/*.json`) —
 * the same source of truth the tracking API uses — and returns every fixture
 * whose match_date falls inside the requested month, filtered to the active
 * gender universe. Works on Vercel because the JSON files are committed.
 */

interface RawPrediction {
  match_id?: string | number
  home_team?: string
  away_team?: string
  league?: string
  match_date?: string
  predicted_home_win?: number | null
  predicted_draw?: number | null
  predicted_away_win?: number | null
  predicted_scoreline?: string | null
  venue?: string | null
  actual_home_goals?: number | null
  actual_away_goals?: number | null
  actual_winner?: string | null
  winner_correct?: boolean | null
}

function toNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function loadAllPredictions(): RawPrediction[] {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) return []

  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f.startsWith('predictions_') && f.endsWith('.json'))

  const all: RawPrediction[] = []
  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'))
      if (Array.isArray(data.predictions)) all.push(...data.predictions)
    } catch {
      // skip corrupt file
    }
  }
  return all
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const now = new Date()
  const year = parseInt(searchParams.get('year') ?? '', 10) || now.getFullYear()
  const month = parseInt(searchParams.get('month') ?? '', 10) || now.getMonth() + 1
  const gender = searchParams.get('gender') === 'F' ? 'F' : 'M'

  const prefix = `${year}-${String(month).padStart(2, '0')}`

  // Dedupe by match_id, keeping the most recent record (files are sorted).
  const byId = new Map<string, RawPrediction>()
  for (const p of loadAllPredictions()) {
    if (typeof p.match_date !== 'string' || !p.match_date.startsWith(prefix)) continue
    if (!p.home_team || !p.away_team || !p.league) continue
    if (getLeagueAccent(p.league).gender !== gender) continue
    const key = p.match_id != null
      ? String(p.match_id)
      : `${p.home_team}|${p.away_team}|${p.match_date}`
    byId.set(key, p)
  }

  const fixtures = [...byId.values()]
    .map((p) => ({
      match_id: p.match_id != null ? String(p.match_id) : `${p.home_team}-${p.away_team}-${p.match_date}`,
      league: p.league as string,
      home_team: p.home_team as string,
      away_team: p.away_team as string,
      venue: typeof p.venue === 'string' && p.venue.trim() ? p.venue.trim() : null,
      date: (p.match_date as string).slice(0, 10),
      home_win: toNum(p.predicted_home_win),
      draw: toNum(p.predicted_draw),
      away_win: toNum(p.predicted_away_win),
      predicted_scoreline:
        typeof p.predicted_scoreline === 'string' && p.predicted_scoreline.trim()
          ? p.predicted_scoreline.trim()
          : null,
      actual_home_goals: toNum(p.actual_home_goals),
      actual_away_goals: toNum(p.actual_away_goals),
      winner_correct: typeof p.winner_correct === 'boolean' ? p.winner_correct : null,
      status: p.actual_winner != null ? ('completed' as const) : ('pending' as const),
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.league.localeCompare(b.league) ||
        a.home_team.localeCompare(b.home_team)
    )

  return NextResponse.json({ year, month, fixtures })
}
