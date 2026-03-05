import { NextResponse } from 'next/server'
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
  predicted_home_goals: number
  predicted_away_goals: number
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  actual_home_goals: number | null
  actual_away_goals: number | null
  actual_winner: string | null
  winner_correct: boolean | null
  scoreline_correct: boolean | null
  goals_diff: number | null
  outcome_timestamp: string | null
  [key: string]: any
}

const LEAGUE_TO_ESPN: Record<string, string> = {
  'Premier League': 'eng.1',
  'La Liga': 'esp.1',
  'Bundesliga': 'ger.1',
  'Serie A': 'ita.1',
  'Ligue 1': 'fra.1',
  'MLS': 'usa.1',
  'Champions League': 'uefa.champions',
  'Europa League': 'uefa.europa',
  'Conference League': 'uefa.europa.conf',
  'Eredivisie': 'ned.1',
  'Primeira Liga': 'por.1',
  'FIFA World Cup': 'fifa.world',
}

export async function POST() {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) {
    return NextResponse.json({ updated: 0, message: 'No prediction data directory' })
  }

  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('predictions_') && f.endsWith('.json'))
  let totalUpdated = 0

  for (const file of files) {
    const filePath = path.join(dataDir, file)
    let fileData: any
    try {
      fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    } catch { continue }

    const predictions: Prediction[] = fileData.predictions || []
    const pending = predictions.filter(p => p.actual_winner === null)
    if (pending.length === 0) continue

    // Group pending by league for batch ESPN fetching
    const byLeague: Record<string, Prediction[]> = {}
    for (const p of pending) {
      if (!byLeague[p.league]) byLeague[p.league] = []
      byLeague[p.league].push(p)
    }

    let fileModified = false
    for (const [league, preds] of Object.entries(byLeague)) {
      const espnId = LEAGUE_TO_ESPN[league]
      if (!espnId) continue

      // Get date range for this batch
      const dates = preds.map(p => p.match_date).sort()
      const startDate = dates[0].replace(/-/g, '')
      const endDate = dates[dates.length - 1].replace(/-/g, '')

      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnId}/scoreboard?dates=${startDate}-${endDate}&limit=100`
        const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
        if (!resp.ok) continue
        const data = await resp.json()

        for (const event of data.events || []) {
          const status = event.status?.type?.name || ''
          if (!status.includes('STATUS_FULL_TIME') && !status.includes('STATUS_FINAL')) continue

          const matchId = event.id
          const comps = event.competitions?.[0]
          if (!comps) continue

          const homeComp = comps.competitors?.find((c: any) => c.homeAway === 'home')
          const awayComp = comps.competitors?.find((c: any) => c.homeAway === 'away')
          if (!homeComp || !awayComp) continue

          const homeGoals = parseInt(homeComp.score || '0', 10)
          const awayGoals = parseInt(awayComp.score || '0', 10)
          const actualWinner = homeGoals > awayGoals ? 'home' : homeGoals < awayGoals ? 'away' : 'draw'

          // Find matching prediction by match_id or team names
          const pred = preds.find(p =>
            p.match_id === matchId ||
            (p.home_team.includes(homeComp.team?.shortDisplayName || '___') ||
             homeComp.team?.displayName?.includes(p.home_team.split(' ').pop() || '___'))
          )

          if (pred && pred.actual_winner === null) {
            pred.actual_home_goals = homeGoals
            pred.actual_away_goals = awayGoals
            pred.actual_winner = actualWinner

            // Derive predicted outcome from predicted scoreline for consistency
            // (the scoreline is the source of truth, not the stored predicted_winner
            //  which may have been set from probabilities in older predictions)
            const scoreParts = (pred.predicted_scoreline || '0-0').split('-')
            const predH = parseInt(scoreParts[0] || '0', 10)
            const predA = parseInt(scoreParts[1] || '0', 10)
            const derivedPredWinner = predH > predA ? 'home' : predA > predH ? 'away' : 'draw'

            // Fix the stored predicted_winner to match the scoreline
            pred.predicted_winner = derivedPredWinner
            pred.winner_correct = derivedPredWinner === actualWinner
            pred.scoreline_correct = pred.predicted_scoreline === `${homeGoals}-${awayGoals}`
            const predictedTotal = pred.predicted_home_goals + pred.predicted_away_goals
            pred.goals_diff = Math.round(Math.abs((homeGoals + awayGoals) - predictedTotal))
            pred.outcome_timestamp = new Date().toISOString()
            totalUpdated++
            fileModified = true
          }
        }
      } catch {
        // ESPN fetch error, skip this league
      }
    }

    if (fileModified) {
      fileData.predictions = predictions
      fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2))
    }
  }

  return NextResponse.json({
    updated: totalUpdated,
    message: `Updated ${totalUpdated} prediction outcomes from ESPN`,
    timestamp: new Date().toISOString(),
  })
}
