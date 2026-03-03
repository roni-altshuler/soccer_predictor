import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

interface Prediction {
  match_date: string
  home_team: string
  away_team: string
  winner_correct: boolean | null
  actual_winner: string | null
}

function loadCompleted(): Prediction[] {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) return []

  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('predictions_') && f.endsWith('.json'))
  const all: Prediction[] = []

  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'))
      if (data.predictions) {
        all.push(...data.predictions.filter((p: any) => p.actual_winner !== null))
      }
    } catch { /* skip */ }
  }

  return all.sort((a, b) => a.match_date.localeCompare(b.match_date))
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const window = Math.max(5, Math.min(100, parseInt(searchParams.get('window') || '10', 10)))

  const completed = loadCompleted()

  if (completed.length < window) {
    return NextResponse.json({
      window,
      data_points: 0,
      trend: [],
      latest_accuracy: null,
    })
  }

  const trend: any[] = []
  for (let i = window; i <= completed.length; i++) {
    const batch = completed.slice(i - window, i)
    const correct = batch.filter(p => p.winner_correct).length
    const accuracy = correct / batch.length
    trend.push({
      index: i,
      date: batch[batch.length - 1].match_date,
      accuracy: Math.round(accuracy * 10000) / 10000,
      correct,
      total: batch.length,
      sample_match: `${batch[batch.length - 1].home_team} vs ${batch[batch.length - 1].away_team}`,
    })
  }

  return NextResponse.json({
    window,
    data_points: trend.length,
    trend,
    latest_accuracy: trend.length > 0 ? trend[trend.length - 1].accuracy : null,
  })
}
