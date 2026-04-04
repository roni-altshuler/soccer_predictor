import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  const retrainThreshold = 50

  // Read prediction data to determine status
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) {
    return NextResponse.json({
      status: 'idle',
      last_run: null,
      total_pending: 0,
      total_completed: 0,
      outcomes_since_retrain: 0,
      retrain_threshold: retrainThreshold,
      message: 'No prediction data found',
    })
  }

  let totalPending = 0
  let totalCompleted = 0
  let latestDate = ''

  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('predictions_') && f.endsWith('.json'))
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'))
      for (const p of data.predictions || []) {
        if (p.actual_winner !== null) totalCompleted++
        else totalPending++
        if (p.match_date > latestDate) latestDate = p.match_date
      }
    } catch { /* skip */ }
  }

  return NextResponse.json({
    status: 'active',
    last_run: new Date().toISOString(),
    total_pending: totalPending,
    total_completed: totalCompleted,
    outcomes_since_retrain: totalCompleted % retrainThreshold,
    retrain_threshold: retrainThreshold,
    latest_match_date: latestDate,
    message: `Tracking ${totalCompleted} completed + ${totalPending} pending predictions`,
  })
}
