import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

interface Prediction {
  match_id: string
  home_team: string
  away_team: string
  league: string
  match_date: string
  predicted_winner: string
  predicted_scoreline: string
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  confidence: number
  actual_winner: string | null
  actual_home_goals: number | null
  actual_away_goals: number | null
  winner_correct: boolean | null
  scoreline_correct: boolean | null
}

function loadAllPredictions(): Prediction[] {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) return []

  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('predictions_') && f.endsWith('.json'))
  const all: Prediction[] = []

  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'))
      if (data.predictions) all.push(...data.predictions)
    } catch { /* skip */ }
  }

  return all
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const timeRange = searchParams.get('time_range') || 'all'
  const league = searchParams.get('league') || null
  const status = searchParams.get('status') || null // 'completed' | 'pending' | null (all)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))

  let allPreds = loadAllPredictions()

  // Apply time filter
  const now = new Date()
  if (timeRange !== 'all') {
    let cutoff: Date
    switch (timeRange) {
      case 'week':
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'season':
        cutoff = new Date(now.getFullYear() - 1, 7, 1) // Aug 1 of previous year
        break
      default: // month
        cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }
    allPreds = allPreds.filter(p => new Date(p.match_date) >= cutoff)
  }

  // Apply league filter
  if (league) {
    allPreds = allPreds.filter(p => p.league === league)
  }

  // Apply status filter
  if (status === 'completed') {
    allPreds = allPreds.filter(p => p.actual_winner !== null)
  } else if (status === 'pending') {
    allPreds = allPreds.filter(p => p.actual_winner === null)
  }

  // Sort newest first
  allPreds.sort((a, b) => b.match_date.localeCompare(a.match_date))

  // Collect unique leagues for filter dropdown
  const allLeagues = Array.from(new Set(allPreds.map(p => p.league))).sort()

  // Paginate
  const totalCount = allPreds.length
  const totalPages = Math.ceil(totalCount / limit)
  const offset = (page - 1) * limit
  const paginated = allPreds.slice(offset, offset + limit)

  return NextResponse.json({
    count: totalCount,
    page,
    limit,
    total_pages: totalPages,
    time_range: timeRange,
    available_leagues: allLeagues,
    predictions: paginated.map(p => ({
      match_id: p.match_id,
      home_team: p.home_team,
      away_team: p.away_team,
      league: p.league,
      match_date: p.match_date,
      predicted_winner: p.predicted_winner,
      predicted_scoreline: p.predicted_scoreline,
      home_win_prob: p.predicted_home_win,
      draw_prob: p.predicted_draw,
      away_win_prob: p.predicted_away_win,
      confidence: p.confidence,
      actual_winner: p.actual_winner,
      actual_scoreline: p.actual_home_goals !== null ? `${p.actual_home_goals}-${p.actual_away_goals}` : null,
      winner_correct: p.winner_correct,
      scoreline_correct: p.scoreline_correct,
      status: p.actual_winner !== null ? 'completed' : 'pending',
    })),
  })
}
