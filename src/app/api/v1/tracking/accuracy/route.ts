import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

function loadCompleted() {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) return []

  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('predictions_') && f.endsWith('.json'))
  const all: any[] = []

  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'))
      if (data.predictions) {
        all.push(...data.predictions.filter((p: any) => p.actual_winner !== null))
      }
    } catch { /* skip */ }
  }

  return all
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const league = searchParams.get('league') || null
  const days = searchParams.get('days') ? parseInt(searchParams.get('days')!, 10) : null

  let completed = loadCompleted()

  // Apply filters
  if (league) {
    completed = completed.filter((p: any) => p.league === league)
  }
  if (days) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    completed = completed.filter((p: any) => new Date(p.match_date) >= cutoff)
  }

  const total = completed.length
  if (total === 0) {
    return NextResponse.json({
      total_predictions: 0,
      correct_predictions: 0,
      accuracy: 0,
      result_accuracy: 0,
      score_accuracy: 0,
      by_confidence: {
        high: { total: 0, correct: 0, accuracy: 0 },
        medium: { total: 0, correct: 0, accuracy: 0 },
        low: { total: 0, correct: 0, accuracy: 0 },
      },
      recent_form: [],
    })
  }

  const correct = completed.filter((p: any) => p.winner_correct).length
  const scoreCorrect = completed.filter((p: any) => p.scoreline_correct).length

  // By confidence breakdown
  const high = completed.filter((p: any) => p.confidence >= 0.7)
  const med = completed.filter((p: any) => p.confidence >= 0.4 && p.confidence < 0.7)
  const low = completed.filter((p: any) => p.confidence < 0.4)
  const acc = (arr: any[]) => arr.length > 0 ? arr.filter((p: any) => p.winner_correct).length / arr.length : 0

  // Recent form (last 20)
  const sorted = [...completed].sort((a: any, b: any) => b.match_date.localeCompare(a.match_date))
  const form = sorted.slice(0, 20).map((p: any) => p.winner_correct ? 'W' : 'L')

  return NextResponse.json({
    total_predictions: total,
    correct_predictions: correct,
    accuracy: Math.round((correct / total) * 1000) / 1000,
    result_accuracy: Math.round((correct / total) * 1000) / 1000,
    score_accuracy: Math.round((scoreCorrect / total) * 1000) / 1000,
    by_confidence: {
      high: { total: high.length, correct: high.filter((p: any) => p.winner_correct).length, accuracy: Math.round(acc(high) * 1000) / 1000 },
      medium: { total: med.length, correct: med.filter((p: any) => p.winner_correct).length, accuracy: Math.round(acc(med) * 1000) / 1000 },
      low: { total: low.length, correct: low.filter((p: any) => p.winner_correct).length, accuracy: Math.round(acc(low) * 1000) / 1000 },
    },
    recent_form: form,
  })
}
