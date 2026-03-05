import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

interface Prediction {
  match_id: string
  home_team: string
  away_team: string
  league: string
  match_date: string
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  predicted_home_goals: number
  predicted_away_goals: number
  predicted_scoreline: string
  predicted_winner: string
  confidence: number
  home_elo: number
  away_elo: number
  actual_home_goals: number | null
  actual_away_goals: number | null
  actual_winner: string | null
  winner_correct: boolean | null
  scoreline_correct: boolean | null
  goals_diff: number | null
  prediction_timestamp: string
  outcome_timestamp: string | null
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
    } catch { /* skip corrupt files */ }
  }

  return all
}

export async function GET() {
  const predictions = loadAllPredictions()
  const completed = predictions.filter(p => p.actual_winner !== null)
  const total = predictions.length
  const completedCount = completed.length

  if (completedCount === 0) {
    return NextResponse.json({
      overall: {
        total_predictions: total,
        completed_predictions: 0,
        winner_accuracy: 0,
        winner_correct_count: 0,
        exact_scoreline_rate: 0,
        exact_scoreline_count: 0,
        avg_goals_difference: 0,
        within_1_goal_rate: 0,
        brier_score: 0,
        high_confidence_accuracy: 0,
        medium_confidence_accuracy: 0,
        low_confidence_accuracy: 0,
        recent_accuracy: 0,
      },
      last_30_days: { total_predictions: 0, completed_predictions: 0, winner_accuracy: 0, recent_accuracy: 0 },
      by_league: {},
      recent_form: [],
      current_streak: { type: 'N/A', count: 0 },
      recent_predictions: [],
    })
  }

  // Overall metrics
  const winnerCorrect = completed.filter(p => p.winner_correct).length
  const scoreCorrect = completed.filter(p => p.scoreline_correct).length
  const winnerAccuracy = winnerCorrect / completedCount

  // Goals difference
  const goalsDiffs = completed.filter(p => p.goals_diff !== null).map(p => Math.abs(p.goals_diff!))
  const avgGoalsDiff = goalsDiffs.length > 0 ? goalsDiffs.reduce((a, b) => a + b, 0) / goalsDiffs.length : 0
  const within1Goal = goalsDiffs.filter(d => d <= 1).length / (goalsDiffs.length || 1)

  // Brier score
  let brierSum = 0
  for (const p of completed) {
    const actual = p.actual_winner === 'home' ? [1, 0, 0] : p.actual_winner === 'draw' ? [0, 1, 0] : [0, 0, 1]
    const pred = [p.predicted_home_win, p.predicted_draw, p.predicted_away_win]
    brierSum += pred.reduce((sum, pr, i) => sum + Math.pow(pr - actual[i], 2), 0)
  }
  const brierScore = brierSum / completedCount

  // By confidence (confidence values stored as percentages, e.g. 37.8 = 37.8%)
  const highConf = completed.filter(p => p.confidence >= 55)
  const medConf = completed.filter(p => p.confidence >= 42 && p.confidence < 55)
  const lowConf = completed.filter(p => p.confidence < 42)
  const confAcc = (arr: Prediction[]) => arr.length > 0 ? arr.filter(p => p.winner_correct).length / arr.length : 0

  // Recent accuracy (last 50)
  const recentCompleted = completed.sort((a, b) => b.match_date.localeCompare(a.match_date)).slice(0, 50)
  const recentAccuracy = recentCompleted.length > 0
    ? recentCompleted.filter(p => p.winner_correct).length / recentCompleted.length
    : 0

  // By league
  const leagues = Array.from(new Set(completed.map(p => p.league)))
  const byLeague: Record<string, any> = {}
  for (const league of leagues) {
    const lp = completed.filter(p => p.league === league)
    const lCorrect = lp.filter(p => p.winner_correct).length
    byLeague[league] = {
      league,
      total: lp.length,
      predictions: lp.length,
      accuracy: lp.length > 0 ? Math.round((lCorrect / lp.length) * 1000) / 1000 : 0,
      correct: lCorrect,
      scoreline_accuracy: lp.length > 0
        ? Math.round((lp.filter(p => p.scoreline_correct).length / lp.length) * 1000) / 1000
        : 0,
    }
  }

  // Recent form (last 20)
  const recentPreds = completed.sort((a, b) => b.match_date.localeCompare(a.match_date)).slice(0, 20)
  const recentForm = recentPreds.map(p => p.winner_correct ? 'W' : 'L')

  // Current streak
  let streakType: string | null = null
  let streakCount = 0
  for (const f of recentForm) {
    if (!streakType) { streakType = f; streakCount = 1 }
    else if (f === streakType) { streakCount++ }
    else break
  }

  // Last 30 days
  const cutoff30 = new Date()
  cutoff30.setDate(cutoff30.getDate() - 30)
  const last30 = completed.filter(p => new Date(p.match_date) >= cutoff30)
  const last30Correct = last30.filter(p => p.winner_correct).length
  const last30ScoreCorrect = last30.filter(p => p.scoreline_correct).length
  const last30GoalsDiffs = last30.filter(p => p.goals_diff !== null).map(p => Math.abs(p.goals_diff!))
  const last30AvgGoalsDiff = last30GoalsDiffs.length > 0 ? last30GoalsDiffs.reduce((a, b) => a + b, 0) / last30GoalsDiffs.length : 0
  const last30Within1Goal = last30GoalsDiffs.length > 0 ? last30GoalsDiffs.filter(d => d <= 1).length / last30GoalsDiffs.length : 0
  let last30BrierSum = 0
  for (const p of last30) {
    const actual30 = p.actual_winner === 'home' ? [1, 0, 0] : p.actual_winner === 'draw' ? [0, 1, 0] : [0, 0, 1]
    const pred30 = [p.predicted_home_win, p.predicted_draw, p.predicted_away_win]
    last30BrierSum += pred30.reduce((sum, pr, i) => sum + Math.pow(pr - actual30[i], 2), 0)
  }
  const last30Brier = last30.length > 0 ? last30BrierSum / last30.length : 0
  const last30High = last30.filter(p => p.confidence >= 55)
  const last30Med = last30.filter(p => p.confidence >= 42 && p.confidence < 55)
  const last30Low = last30.filter(p => p.confidence < 42)

  return NextResponse.json({
    overall: {
      total_predictions: total,
      completed_predictions: completedCount,
      winner_correct_count: winnerCorrect,
      winner_accuracy: Math.round(winnerAccuracy * 1000) / 1000,
      exact_scoreline_count: scoreCorrect,
      exact_scoreline_rate: Math.round((scoreCorrect / completedCount) * 1000) / 1000,
      avg_goals_difference: Math.round(avgGoalsDiff * 100) / 100,
      within_1_goal_rate: Math.round(within1Goal * 1000) / 1000,
      brier_score: Math.round(brierScore * 10000) / 10000,
      high_confidence_accuracy: Math.round(confAcc(highConf) * 1000) / 1000,
      medium_confidence_accuracy: Math.round(confAcc(medConf) * 1000) / 1000,
      low_confidence_accuracy: Math.round(confAcc(lowConf) * 1000) / 1000,
      recent_accuracy: Math.round(recentAccuracy * 1000) / 1000,
      home_win_predicted: completed.filter(p => p.predicted_winner === 'home').length,
      home_win_correct: completed.filter(p => p.predicted_winner === 'home' && p.winner_correct).length,
      draw_predicted: completed.filter(p => p.predicted_winner === 'draw').length,
      draw_correct: completed.filter(p => p.predicted_winner === 'draw' && p.winner_correct).length,
      away_win_predicted: completed.filter(p => p.predicted_winner === 'away').length,
      away_win_correct: completed.filter(p => p.predicted_winner === 'away' && p.winner_correct).length,
    },
    last_30_days: {
      total_predictions: last30.length,
      completed_predictions: last30.length,
      winner_correct_count: last30Correct,
      winner_accuracy: last30.length > 0 ? Math.round((last30Correct / last30.length) * 1000) / 1000 : 0,
      exact_scoreline_count: last30ScoreCorrect,
      exact_scoreline_rate: last30.length > 0 ? Math.round((last30ScoreCorrect / last30.length) * 1000) / 1000 : 0,
      avg_goals_difference: Math.round(last30AvgGoalsDiff * 100) / 100,
      within_1_goal_rate: Math.round(last30Within1Goal * 1000) / 1000,
      brier_score: Math.round(last30Brier * 10000) / 10000,
      high_confidence_accuracy: Math.round(confAcc(last30High) * 1000) / 1000,
      medium_confidence_accuracy: Math.round(confAcc(last30Med) * 1000) / 1000,
      low_confidence_accuracy: Math.round(confAcc(last30Low) * 1000) / 1000,
      recent_accuracy: last30.length > 0 ? Math.round((last30Correct / last30.length) * 1000) / 1000 : 0,
    },
    by_league: byLeague,
    recent_form: recentForm.slice(0, 10),
    current_streak: { type: streakType || 'N/A', count: streakCount },
    recent_predictions: recentPreds.slice(0, 20).map(p => ({
      match_id: p.match_id,
      home_team: p.home_team,
      away_team: p.away_team,
      league: p.league,
      match_date: p.match_date,
      predicted_winner: p.predicted_winner,
      predicted_scoreline: p.predicted_scoreline,
      actual_scoreline: p.actual_home_goals !== null ? `${p.actual_home_goals}-${p.actual_away_goals}` : null,
      actual_winner: p.actual_winner,
      winner_correct: p.winner_correct,
      scoreline_correct: p.scoreline_correct,
      confidence: p.confidence / 100,
      home_win_prob: p.predicted_home_win,
      draw_prob: p.predicted_draw,
      away_win_prob: p.predicted_away_win,
    })),
  })
}
