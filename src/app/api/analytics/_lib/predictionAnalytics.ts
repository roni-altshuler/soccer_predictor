import fs from 'fs'
import path from 'path'

export interface CompletedPrediction {
  league: string
  match_date: string
  actual_winner: 'home' | 'draw' | 'away'
  actual_home_goals: number
  actual_away_goals: number
}

const LEAGUE_ALIASES: Record<string, string> = {
  'eng.1': 'Premier League',
  premier_league: 'Premier League',
  'premier league': 'Premier League',
  'esp.1': 'La Liga',
  la_liga: 'La Liga',
  'la liga': 'La Liga',
  'ger.1': 'Bundesliga',
  bundesliga: 'Bundesliga',
  'ita.1': 'Serie A',
  serie_a: 'Serie A',
  'serie a': 'Serie A',
  'fra.1': 'Ligue 1',
  ligue_1: 'Ligue 1',
  'ligue 1': 'Ligue 1',
  'usa.1': 'MLS',
  mls: 'MLS',
  'ned.1': 'Eredivisie',
  eredivisie: 'Eredivisie',
  'por.1': 'Primeira Liga',
  primeira_liga: 'Primeira Liga',
  'primeira liga': 'Primeira Liga',
  'uefa.champions': 'Champions League',
  champions_league: 'Champions League',
  'champions league': 'Champions League',
  'uefa.europa': 'Europa League',
  europa_league: 'Europa League',
  'europa league': 'Europa League',
  'uefa.europa.conf': 'Conference League',
  conference_league: 'Conference League',
  'conference league': 'Conference League',
  'fifa.world': 'FIFA World Cup',
  world_cup: 'FIFA World Cup',
  'fifa world cup': 'FIFA World Cup',
}

function normalizeLeagueKey(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function resolveLeagueAlias(value: string): string {
  if (!value) return value
  const direct = LEAGUE_ALIASES[value]
  if (direct) return direct
  const normalized = normalizeLeagueKey(value)
  return LEAGUE_ALIASES[normalized] || value
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toSeasonLabel(matchDate: string): string {
  const parsed = new Date(matchDate)
  if (Number.isNaN(parsed.getTime())) return 'Unknown'
  const year = parsed.getUTCFullYear()
  const month = parsed.getUTCMonth() + 1
  const seasonStart = month >= 8 ? year : year - 1
  return `${seasonStart}-${seasonStart + 1}`
}

export function loadCompletedPredictions(leagueParam?: string): CompletedPrediction[] {
  const predictionsDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(predictionsDir)) return []

  const requestedLeague = resolveLeagueAlias(leagueParam || '')
  const requestedNormalized = normalizeLeagueKey(requestedLeague)
  const includeAll = !requestedNormalized || requestedNormalized === 'all'
  const files = fs
    .readdirSync(predictionsDir)
    .filter((fileName) => fileName.startsWith('predictions_') && fileName.endsWith('.json'))
    .sort()

  const completed: CompletedPrediction[] = []

  for (const fileName of files) {
    try {
      const filePath = path.join(predictionsDir, fileName)
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
        predictions?: Array<Record<string, unknown>>
      }

      for (const prediction of parsed.predictions || []) {
        const leagueRaw = typeof prediction.league === 'string' ? prediction.league : ''
        const normalizedLeague = normalizeLeagueKey(leagueRaw)
        if (!includeAll) {
          const leagueDisplay = resolveLeagueAlias(leagueRaw)
          const normalizedDisplay = normalizeLeagueKey(leagueDisplay)
          if (
            normalizedLeague !== requestedNormalized &&
            normalizedDisplay !== requestedNormalized
          ) {
            continue
          }
        }

        const actualWinner = prediction.actual_winner
        const homeGoals = toNumber(prediction.actual_home_goals)
        const awayGoals = toNumber(prediction.actual_away_goals)
        const matchDate = typeof prediction.match_date === 'string' ? prediction.match_date : ''

        if (
          !matchDate ||
          (actualWinner !== 'home' && actualWinner !== 'draw' && actualWinner !== 'away') ||
          homeGoals === null ||
          awayGoals === null
        ) {
          continue
        }

        completed.push({
          league: resolveLeagueAlias(leagueRaw),
          match_date: matchDate,
          actual_winner: actualWinner,
          actual_home_goals: homeGoals,
          actual_away_goals: awayGoals,
        })
      }
    } catch {
      continue
    }
  }

  return completed
}

export function summarizeOverview(predictions: CompletedPrediction[]) {
  const total = predictions.length
  if (total === 0) {
    return {
      total_matches: 0,
      avg_goals_per_match: 0,
      avg_home_goals: 0,
      avg_away_goals: 0,
      home_win_rate: 0,
      draw_rate: 0,
      away_win_rate: 0,
      home_win_percentage: 0,
      draw_percentage: 0,
      away_win_percentage: 0,
    }
  }

  const homeWins = predictions.filter((p) => p.actual_winner === 'home').length
  const draws = predictions.filter((p) => p.actual_winner === 'draw').length
  const awayWins = predictions.filter((p) => p.actual_winner === 'away').length
  const totalHomeGoals = predictions.reduce((sum, p) => sum + p.actual_home_goals, 0)
  const totalAwayGoals = predictions.reduce((sum, p) => sum + p.actual_away_goals, 0)
  const totalGoals = totalHomeGoals + totalAwayGoals

  const homeWinRate = homeWins / total
  const drawRate = draws / total
  const awayWinRate = awayWins / total

  return {
    total_matches: total,
    avg_goals_per_match: Math.round((totalGoals / total) * 100) / 100,
    avg_home_goals: Math.round((totalHomeGoals / total) * 100) / 100,
    avg_away_goals: Math.round((totalAwayGoals / total) * 100) / 100,
    home_win_rate: Math.round(homeWinRate * 10000) / 10000,
    draw_rate: Math.round(drawRate * 10000) / 10000,
    away_win_rate: Math.round(awayWinRate * 10000) / 10000,
    home_win_percentage: Math.round(homeWinRate * 1000) / 10,
    draw_percentage: Math.round(drawRate * 1000) / 10,
    away_win_percentage: Math.round(awayWinRate * 1000) / 10,
  }
}

export function summarizeResultDistribution(predictions: CompletedPrediction[]) {
  const total = predictions.length
  const homeWins = predictions.filter((p) => p.actual_winner === 'home').length
  const draws = predictions.filter((p) => p.actual_winner === 'draw').length
  const awayWins = predictions.filter((p) => p.actual_winner === 'away').length

  const percentage = (value: number) => (total > 0 ? Math.round((value / total) * 1000) / 10 : 0)

  return {
    total_matches: total,
    distribution: [
      { result: 'Home Win', count: homeWins, percentage: percentage(homeWins) },
      { result: 'Draw', count: draws, percentage: percentage(draws) },
      { result: 'Away Win', count: awayWins, percentage: percentage(awayWins) },
    ],
    chart_data: [
      { name: 'win', value: homeWins, percentage: percentage(homeWins) },
      { name: 'draw', value: draws, percentage: percentage(draws) },
      { name: 'loss', value: awayWins, percentage: percentage(awayWins) },
    ],
  }
}

export function summarizeGoalsDistribution(predictions: CompletedPrediction[]) {
  const total = predictions.length
  const counts = new Map<number, number>()

  for (const prediction of predictions) {
    const goals = prediction.actual_home_goals + prediction.actual_away_goals
    counts.set(goals, (counts.get(goals) || 0) + 1)
  }

  const sortedGoals = Array.from(counts.keys()).sort((a, b) => a - b)
  const distribution = sortedGoals.map((goals) => {
    const count = counts.get(goals) || 0
    return {
      goals,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    }
  })

  return {
    total_matches: total,
    distribution,
    chart_data: distribution.map((item) => ({
      name: String(item.goals),
      value: item.count,
      percentage: item.percentage,
    })),
  }
}

export function summarizeSeasonTrends(predictions: CompletedPrediction[]) {
  const bySeason = new Map<
    string,
    { matches: number; goals: number; homeWins: number; draws: number; awayWins: number }
  >()

  for (const prediction of predictions) {
    const season = toSeasonLabel(prediction.match_date)
    const current = bySeason.get(season) || {
      matches: 0,
      goals: 0,
      homeWins: 0,
      draws: 0,
      awayWins: 0,
    }
    current.matches += 1
    current.goals += prediction.actual_home_goals + prediction.actual_away_goals
    if (prediction.actual_winner === 'home') current.homeWins += 1
    if (prediction.actual_winner === 'draw') current.draws += 1
    if (prediction.actual_winner === 'away') current.awayWins += 1
    bySeason.set(season, current)
  }

  return Array.from(bySeason.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([season, agg]) => ({
      season,
      avg_goals: agg.matches > 0 ? Math.round((agg.goals / agg.matches) * 100) / 100 : 0,
      home_wins: agg.matches > 0 ? Math.round((agg.homeWins / agg.matches) * 1000) / 10 : 0,
      draws: agg.matches > 0 ? Math.round((agg.draws / agg.matches) * 1000) / 10 : 0,
      away_wins: agg.matches > 0 ? Math.round((agg.awayWins / agg.matches) * 1000) / 10 : 0,
      total_matches: agg.matches,
    }))
}
