import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/**
 * Returns recent predictions from the committed JSON files under
 * `backend/data/predictions/`. The /accuracy page uses this to render
 * its "Recent picks" feed — green ✓ / red ✗ / grey ‒ per pick.
 *
 * The previous FastAPI endpoint at /api/v1/tracking/recent is not
 * deployed on Vercel, so the frontend was getting nothing. This Node
 * route makes the page work in production.
 *
 * Query params:
 *   ?limit  — max items to return (default 50, capped at 200)
 *   ?gender — 'M' or 'F' to filter to one universe
 *   ?league — filter to a specific league name
 *   ?completed_only — 'true' to only return settled predictions
 */

interface Prediction {
  match_id: string
  home_team: string
  away_team: string
  league: string
  match_date: string
  gender?: 'M' | 'F' | null
  predicted_winner?: 'home' | 'draw' | 'away' | null
  predicted_scoreline?: string
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  predicted_home_goals?: number
  predicted_away_goals?: number
  confidence: number
  actual_winner: string | null
  actual_home_goals: number | null
  actual_away_goals: number | null
  winner_correct: boolean | null
  scoreline_correct: boolean | null
}

function loadAll(): Prediction[] {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) return []

  const files = fs.readdirSync(dataDir).filter((f) => f.startsWith('predictions_') && f.endsWith('.json'))
  const all: Prediction[] = []
  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'))
      if (Array.isArray(data.predictions)) {
        all.push(...data.predictions)
      }
    } catch {
      /* skip malformed files */
    }
  }
  return all
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limitRaw = Number(searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50
  const league = searchParams.get('league')
  const genderParam = searchParams.get('gender')
  const wantedGender: 'M' | 'F' | null = genderParam === 'F' || genderParam === 'M' ? genderParam : null
  const completedOnly = searchParams.get('completed_only') === 'true'

  let predictions = loadAll()

  if (wantedGender) {
    predictions = predictions.filter((p) => (p.gender ?? 'M').toString().toUpperCase() === wantedGender)
  }
  if (league) {
    predictions = predictions.filter((p) => p.league?.toLowerCase() === league.toLowerCase())
  }
  if (completedOnly) {
    predictions = predictions.filter((p) => p.actual_winner !== null)
  }

  // Newest first (settled predictions surface to the top)
  predictions.sort((a, b) => {
    const aDate = a.match_date || ''
    const bDate = b.match_date || ''
    return bDate.localeCompare(aDate)
  })

  const trimmed = predictions.slice(0, limit)

  return NextResponse.json(
    {
      count: trimmed.length,
      predictions: trimmed,
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}
