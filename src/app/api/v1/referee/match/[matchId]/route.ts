import { NextRequest, NextResponse } from 'next/server'
import { ESPN_SITE } from '@/lib/espnHost'

/**
 * Referee data API route.
 *
 * Fetches the referee for a match from ESPN, then returns stats from a
 * built-in referee database.  Falls back to league-average referee
 * defaults when the specific referee isn't in the database.
 */

const LEAGUE_ENDPOINTS = [
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'usa.1',
  'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
  'ned.1', 'por.1', 'fifa.world',
]

// ── Referee database (key: lowercased name → stats) ──
interface RefStats {
  nationality: string
  experience_years: number
  career_matches: number
  avg_yellow_cards: number
  avg_red_cards: number
  home_win_rate: number
  draw_rate: number
  away_win_rate: number
  avg_goals: number
  penalties_per_match: number
  total_penalties: number
  strictness: number
  competitions: string[]
}

const REFEREE_DB: Record<string, RefStats> = {
  // Premier League
  'michael oliver': { nationality: 'England', experience_years: 14, career_matches: 300, avg_yellow_cards: 3.8, avg_red_cards: 0.15, home_win_rate: 0.46, draw_rate: 0.24, away_win_rate: 0.30, avg_goals: 2.78, penalties_per_match: 0.32, total_penalties: 96, strictness: 0.65, competitions: ['Premier League', 'Champions League', 'FA Cup'] },
  'anthony taylor': { nationality: 'England', experience_years: 15, career_matches: 320, avg_yellow_cards: 4.1, avg_red_cards: 0.18, home_win_rate: 0.44, draw_rate: 0.26, away_win_rate: 0.30, avg_goals: 2.65, penalties_per_match: 0.28, total_penalties: 90, strictness: 0.72, competitions: ['Premier League', 'Champions League', 'Europa League', 'FA Cup'] },
  'paul tierney': { nationality: 'England', experience_years: 12, career_matches: 180, avg_yellow_cards: 3.5, avg_red_cards: 0.12, home_win_rate: 0.48, draw_rate: 0.22, away_win_rate: 0.30, avg_goals: 2.92, penalties_per_match: 0.35, total_penalties: 63, strictness: 0.55, competitions: ['Premier League', 'FA Cup'] },
  'chris kavanagh': { nationality: 'England', experience_years: 10, career_matches: 150, avg_yellow_cards: 3.9, avg_red_cards: 0.14, home_win_rate: 0.45, draw_rate: 0.25, away_win_rate: 0.30, avg_goals: 2.72, penalties_per_match: 0.30, total_penalties: 45, strictness: 0.60, competitions: ['Premier League', 'FA Cup'] },
  'simon hooper': { nationality: 'England', experience_years: 8, career_matches: 120, avg_yellow_cards: 4.2, avg_red_cards: 0.16, home_win_rate: 0.43, draw_rate: 0.27, away_win_rate: 0.30, avg_goals: 2.58, penalties_per_match: 0.25, total_penalties: 30, strictness: 0.70, competitions: ['Premier League', 'FA Cup'] },
  'john brooks': { nationality: 'England', experience_years: 6, career_matches: 80, avg_yellow_cards: 3.7, avg_red_cards: 0.11, home_win_rate: 0.47, draw_rate: 0.24, away_win_rate: 0.29, avg_goals: 2.85, penalties_per_match: 0.28, total_penalties: 22, strictness: 0.58, competitions: ['Premier League'] },
  'robert jones': { nationality: 'England', experience_years: 7, career_matches: 100, avg_yellow_cards: 3.6, avg_red_cards: 0.13, home_win_rate: 0.46, draw_rate: 0.25, away_win_rate: 0.29, avg_goals: 2.75, penalties_per_match: 0.26, total_penalties: 26, strictness: 0.56, competitions: ['Premier League'] },
  'peter bankes': { nationality: 'England', experience_years: 5, career_matches: 70, avg_yellow_cards: 4.0, avg_red_cards: 0.14, home_win_rate: 0.45, draw_rate: 0.26, away_win_rate: 0.29, avg_goals: 2.68, penalties_per_match: 0.29, total_penalties: 20, strictness: 0.62, competitions: ['Premier League'] },
  'stuart attwell': { nationality: 'England', experience_years: 16, career_matches: 240, avg_yellow_cards: 3.4, avg_red_cards: 0.11, home_win_rate: 0.47, draw_rate: 0.24, away_win_rate: 0.29, avg_goals: 2.82, penalties_per_match: 0.27, total_penalties: 65, strictness: 0.52, competitions: ['Premier League', 'Championship'] },
  'andrew madley': { nationality: 'England', experience_years: 5, career_matches: 65, avg_yellow_cards: 3.3, avg_red_cards: 0.10, home_win_rate: 0.48, draw_rate: 0.23, away_win_rate: 0.29, avg_goals: 2.90, penalties_per_match: 0.25, total_penalties: 16, strictness: 0.50, competitions: ['Premier League'] },
  'tony harrington': { nationality: 'England', experience_years: 6, career_matches: 85, avg_yellow_cards: 3.8, avg_red_cards: 0.13, home_win_rate: 0.46, draw_rate: 0.25, away_win_rate: 0.29, avg_goals: 2.74, penalties_per_match: 0.28, total_penalties: 24, strictness: 0.60, competitions: ['Premier League'] },
  'samuel barrott': { nationality: 'England', experience_years: 2, career_matches: 30, avg_yellow_cards: 3.5, avg_red_cards: 0.10, home_win_rate: 0.47, draw_rate: 0.26, away_win_rate: 0.27, avg_goals: 2.70, penalties_per_match: 0.23, total_penalties: 7, strictness: 0.54, competitions: ['Premier League'] },
  'darren england': { nationality: 'England', experience_years: 9, career_matches: 130, avg_yellow_cards: 3.7, avg_red_cards: 0.12, home_win_rate: 0.45, draw_rate: 0.26, away_win_rate: 0.29, avg_goals: 2.76, penalties_per_match: 0.30, total_penalties: 39, strictness: 0.58, competitions: ['Premier League'] },
  'tim robinson': { nationality: 'England', experience_years: 4, career_matches: 55, avg_yellow_cards: 3.9, avg_red_cards: 0.14, home_win_rate: 0.44, draw_rate: 0.27, away_win_rate: 0.29, avg_goals: 2.62, penalties_per_match: 0.27, total_penalties: 15, strictness: 0.61, competitions: ['Premier League'] },
  'david coote': { nationality: 'England', experience_years: 8, career_matches: 100, avg_yellow_cards: 3.6, avg_red_cards: 0.12, home_win_rate: 0.46, draw_rate: 0.25, away_win_rate: 0.29, avg_goals: 2.80, penalties_per_match: 0.29, total_penalties: 29, strictness: 0.57, competitions: ['Premier League', 'Champions League'] },
  // La Liga
  'jesús gil manzano': { nationality: 'Spain', experience_years: 12, career_matches: 200, avg_yellow_cards: 5.2, avg_red_cards: 0.22, home_win_rate: 0.48, draw_rate: 0.25, away_win_rate: 0.27, avg_goals: 2.45, penalties_per_match: 0.35, total_penalties: 70, strictness: 0.75, competitions: ['La Liga', 'Champions League'] },
  'antonio mateu lahoz': { nationality: 'Spain', experience_years: 15, career_matches: 280, avg_yellow_cards: 5.5, avg_red_cards: 0.25, home_win_rate: 0.45, draw_rate: 0.28, away_win_rate: 0.27, avg_goals: 2.35, penalties_per_match: 0.32, total_penalties: 90, strictness: 0.80, competitions: ['La Liga', 'Champions League', 'FIFA World Cup'] },
  'carlos del cerro grande': { nationality: 'Spain', experience_years: 11, career_matches: 180, avg_yellow_cards: 5.0, avg_red_cards: 0.20, home_win_rate: 0.47, draw_rate: 0.26, away_win_rate: 0.27, avg_goals: 2.50, penalties_per_match: 0.33, total_penalties: 59, strictness: 0.72, competitions: ['La Liga', 'Europa League'] },
  'alejandro hernández': { nationality: 'Spain', experience_years: 10, career_matches: 160, avg_yellow_cards: 4.8, avg_red_cards: 0.19, home_win_rate: 0.46, draw_rate: 0.27, away_win_rate: 0.27, avg_goals: 2.48, penalties_per_match: 0.30, total_penalties: 48, strictness: 0.68, competitions: ['La Liga'] },
  'josé luis munuera': { nationality: 'Spain', experience_years: 9, career_matches: 140, avg_yellow_cards: 4.6, avg_red_cards: 0.17, home_win_rate: 0.47, draw_rate: 0.26, away_win_rate: 0.27, avg_goals: 2.52, penalties_per_match: 0.31, total_penalties: 43, strictness: 0.66, competitions: ['La Liga'] },
  // Serie A
  'daniele orsato': { nationality: 'Italy', experience_years: 18, career_matches: 350, avg_yellow_cards: 4.8, avg_red_cards: 0.20, home_win_rate: 0.47, draw_rate: 0.26, away_win_rate: 0.27, avg_goals: 2.55, penalties_per_match: 0.30, total_penalties: 105, strictness: 0.70, competitions: ['Serie A', 'Champions League', 'FIFA World Cup'] },
  'marco guida': { nationality: 'Italy', experience_years: 14, career_matches: 250, avg_yellow_cards: 4.5, avg_red_cards: 0.18, home_win_rate: 0.46, draw_rate: 0.27, away_win_rate: 0.27, avg_goals: 2.52, penalties_per_match: 0.31, total_penalties: 78, strictness: 0.65, competitions: ['Serie A', 'Champions League'] },
  'gianluca rocchi': { nationality: 'Italy', experience_years: 16, career_matches: 300, avg_yellow_cards: 4.6, avg_red_cards: 0.19, home_win_rate: 0.46, draw_rate: 0.27, away_win_rate: 0.27, avg_goals: 2.48, penalties_per_match: 0.29, total_penalties: 87, strictness: 0.68, competitions: ['Serie A'] },
  // Bundesliga
  'felix zwayer': { nationality: 'Germany', experience_years: 13, career_matches: 220, avg_yellow_cards: 3.8, avg_red_cards: 0.12, home_win_rate: 0.48, draw_rate: 0.25, away_win_rate: 0.27, avg_goals: 2.95, penalties_per_match: 0.28, total_penalties: 62, strictness: 0.58, competitions: ['Bundesliga', 'Champions League'] },
  'daniel siebert': { nationality: 'Germany', experience_years: 10, career_matches: 150, avg_yellow_cards: 3.6, avg_red_cards: 0.11, home_win_rate: 0.47, draw_rate: 0.26, away_win_rate: 0.27, avg_goals: 3.00, penalties_per_match: 0.27, total_penalties: 41, strictness: 0.55, competitions: ['Bundesliga', 'Champions League'] },
  'deniz aytekin': { nationality: 'Germany', experience_years: 14, career_matches: 230, avg_yellow_cards: 3.9, avg_red_cards: 0.13, home_win_rate: 0.48, draw_rate: 0.24, away_win_rate: 0.28, avg_goals: 2.98, penalties_per_match: 0.30, total_penalties: 69, strictness: 0.60, competitions: ['Bundesliga', 'Champions League'] },
  // Ligue 1
  'clément turpin': { nationality: 'France', experience_years: 14, career_matches: 260, avg_yellow_cards: 4.2, avg_red_cards: 0.17, home_win_rate: 0.47, draw_rate: 0.25, away_win_rate: 0.28, avg_goals: 2.60, penalties_per_match: 0.30, total_penalties: 78, strictness: 0.68, competitions: ['Ligue 1', 'Champions League', 'FIFA World Cup'] },
  'françois letexier': { nationality: 'France', experience_years: 8, career_matches: 120, avg_yellow_cards: 4.0, avg_red_cards: 0.15, home_win_rate: 0.46, draw_rate: 0.26, away_win_rate: 0.28, avg_goals: 2.65, penalties_per_match: 0.28, total_penalties: 34, strictness: 0.62, competitions: ['Ligue 1', 'Champions League'] },
  // UEFA
  'slavko vinčić': { nationality: 'Slovenia', experience_years: 12, career_matches: 180, avg_yellow_cards: 3.9, avg_red_cards: 0.14, home_win_rate: 0.46, draw_rate: 0.26, away_win_rate: 0.28, avg_goals: 2.70, penalties_per_match: 0.27, total_penalties: 49, strictness: 0.60, competitions: ['Champions League', 'Europa League'] },
  'szymon marciniak': { nationality: 'Poland', experience_years: 11, career_matches: 170, avg_yellow_cards: 3.7, avg_red_cards: 0.13, home_win_rate: 0.47, draw_rate: 0.25, away_win_rate: 0.28, avg_goals: 2.75, penalties_per_match: 0.29, total_penalties: 49, strictness: 0.58, competitions: ['Champions League', 'FIFA World Cup'] },
  'istvan kovacs': { nationality: 'Romania', experience_years: 9, career_matches: 130, avg_yellow_cards: 4.1, avg_red_cards: 0.16, home_win_rate: 0.46, draw_rate: 0.26, away_win_rate: 0.28, avg_goals: 2.68, penalties_per_match: 0.30, total_penalties: 39, strictness: 0.64, competitions: ['Champions League', 'Europa League'] },
  // MLS
  'allen chapman': { nationality: 'United States', experience_years: 10, career_matches: 180, avg_yellow_cards: 3.2, avg_red_cards: 0.10, home_win_rate: 0.50, draw_rate: 0.18, away_win_rate: 0.32, avg_goals: 2.90, penalties_per_match: 0.24, total_penalties: 43, strictness: 0.50, competitions: ['MLS'] },
  'ismail elfath': { nationality: 'United States', experience_years: 12, career_matches: 200, avg_yellow_cards: 3.4, avg_red_cards: 0.12, home_win_rate: 0.49, draw_rate: 0.19, away_win_rate: 0.32, avg_goals: 2.85, penalties_per_match: 0.26, total_penalties: 52, strictness: 0.54, competitions: ['MLS', 'FIFA World Cup'] },
  'drew fischer': { nationality: 'Canada', experience_years: 8, career_matches: 140, avg_yellow_cards: 3.3, avg_red_cards: 0.11, home_win_rate: 0.49, draw_rate: 0.18, away_win_rate: 0.33, avg_goals: 2.92, penalties_per_match: 0.25, total_penalties: 35, strictness: 0.52, competitions: ['MLS'] },
}

// ── League-average defaults when referee is not in database ──
const LEAGUE_DEFAULTS: Record<string, RefStats> = {
  'eng.1': { nationality: 'England', experience_years: 8, career_matches: 120, avg_yellow_cards: 3.7, avg_red_cards: 0.13, home_win_rate: 0.46, draw_rate: 0.25, away_win_rate: 0.29, avg_goals: 2.78, penalties_per_match: 0.28, total_penalties: 34, strictness: 0.58, competitions: ['Premier League'] },
  'esp.1': { nationality: 'Spain', experience_years: 9, career_matches: 140, avg_yellow_cards: 5.0, avg_red_cards: 0.20, home_win_rate: 0.47, draw_rate: 0.26, away_win_rate: 0.27, avg_goals: 2.48, penalties_per_match: 0.32, total_penalties: 45, strictness: 0.72, competitions: ['La Liga'] },
  'ger.1': { nationality: 'Germany', experience_years: 9, career_matches: 140, avg_yellow_cards: 3.8, avg_red_cards: 0.12, home_win_rate: 0.48, draw_rate: 0.25, away_win_rate: 0.27, avg_goals: 2.98, penalties_per_match: 0.28, total_penalties: 39, strictness: 0.57, competitions: ['Bundesliga'] },
  'ita.1': { nationality: 'Italy', experience_years: 10, career_matches: 160, avg_yellow_cards: 4.6, avg_red_cards: 0.19, home_win_rate: 0.46, draw_rate: 0.27, away_win_rate: 0.27, avg_goals: 2.52, penalties_per_match: 0.30, total_penalties: 48, strictness: 0.67, competitions: ['Serie A'] },
  'fra.1': { nationality: 'France', experience_years: 9, career_matches: 140, avg_yellow_cards: 4.1, avg_red_cards: 0.16, home_win_rate: 0.47, draw_rate: 0.25, away_win_rate: 0.28, avg_goals: 2.62, penalties_per_match: 0.29, total_penalties: 41, strictness: 0.64, competitions: ['Ligue 1'] },
  'usa.1': { nationality: 'United States', experience_years: 8, career_matches: 130, avg_yellow_cards: 3.3, avg_red_cards: 0.11, home_win_rate: 0.49, draw_rate: 0.18, away_win_rate: 0.33, avg_goals: 2.89, penalties_per_match: 0.25, total_penalties: 33, strictness: 0.52, competitions: ['MLS'] },
}

const DEFAULT_REF: RefStats = {
  nationality: 'Unknown', experience_years: 8, career_matches: 100,
  avg_yellow_cards: 3.8, avg_red_cards: 0.14, home_win_rate: 0.46,
  draw_rate: 0.26, away_win_rate: 0.28, avg_goals: 2.70,
  penalties_per_match: 0.28, total_penalties: 28, strictness: 0.58,
  competitions: [],
}

/**
 * Fuzzy-match a referee name against the database.
 * Tries exact lowercase, then last-name match, then partial substring.
 */
function lookupReferee(name: string): RefStats | null {
  const lower = name.toLowerCase().trim()
  if (REFEREE_DB[lower]) return REFEREE_DB[lower]

  // Last-name match
  const lastName = lower.split(/\s+/).pop() || ''
  for (const [key, stats] of Object.entries(REFEREE_DB)) {
    if (key.endsWith(lastName) && lastName.length >= 4) return stats
  }

  // Partial substring
  for (const [key, stats] of Object.entries(REFEREE_DB)) {
    if (key.includes(lower) || lower.includes(key)) return stats
  }

  return null
}

async function fetchRefereeName(matchId: string): Promise<{ name: string | null; leagueId: string | null }> {
  for (const league of LEAGUE_ENDPOINTS) {
    try {
      const url = `${ESPN_SITE}/${league}/summary?event=${matchId}`
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 300 } })
      if (!resp.ok) continue
      const data = await resp.json()

      const officials = data.gameInfo?.officials || []
      const refName = officials[0]?.fullName || null
      if (refName || data.header) {
        return { name: refName, leagueId: league }
      }
    } catch {
      continue
    }
  }
  return { name: null, leagueId: null }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params

  // Get home_team / away_team from query params if provided
  const homeTeam = request.nextUrl.searchParams.get('home_team') || ''
  const awayTeam = request.nextUrl.searchParams.get('away_team') || ''

  // Fetch referee name from ESPN
  const { name: refereeName, leagueId } = await fetchRefereeName(matchId)

  if (!refereeName) {
    // Return league-appropriate defaults with "TBD" name
    const defaults = (leagueId && LEAGUE_DEFAULTS[leagueId]) || DEFAULT_REF
    return NextResponse.json({
      name: 'TBD — Not yet assigned',
      country: defaults.nationality,
      experience_years: defaults.experience_years,
      career_matches: defaults.career_matches,
      avg_yellow_cards: defaults.avg_yellow_cards,
      avg_red_cards: defaults.avg_red_cards,
      home_win_rate: defaults.home_win_rate,
      draw_rate: defaults.draw_rate,
      away_win_rate: defaults.away_win_rate,
      avg_goals: defaults.avg_goals,
      penalties_per_match: defaults.penalties_per_match,
      total_penalties: defaults.total_penalties,
      competitions: defaults.competitions,
      is_league_average: true,
      home_team_history: null,
      away_team_history: null,
      prediction_impact: {
        cardLikelihood: 'average',
        homeBias: 'none',
        goalExpectation: 'average',
        summary: 'Referee not yet assigned. Showing league-average referee statistics.',
      },
    })
  }

  // Lookup referee in database
  const dbStats = lookupReferee(refereeName)
  const stats = dbStats || (leagueId && LEAGUE_DEFAULTS[leagueId]) || DEFAULT_REF

  // Determine card likelihood
  const cardLikelihood = stats.avg_yellow_cards >= 4.5 ? 'very_high'
    : stats.avg_yellow_cards >= 3.8 ? 'high'
    : stats.avg_yellow_cards >= 3.0 ? 'average'
    : 'low'

  // Determine home bias
  const homeBias = stats.home_win_rate >= 0.50 ? 'moderate'
    : stats.home_win_rate >= 0.47 ? 'slight'
    : 'none'

  // Determine goal expectation
  const goalExpectation = stats.avg_goals >= 2.85 ? 'higher'
    : stats.avg_goals >= 2.55 ? 'average'
    : 'lower'

  const summaryParts = []
  if (cardLikelihood === 'very_high' || cardLikelihood === 'high') {
    summaryParts.push(`${refereeName} is a ${cardLikelihood === 'very_high' ? 'very strict' : 'strict'} referee (${stats.avg_yellow_cards.toFixed(1)} yellows/match)`)
  } else {
    summaryParts.push(`${refereeName} has an average card rate (${stats.avg_yellow_cards.toFixed(1)} yellows/match)`)
  }
  if (goalExpectation === 'higher') summaryParts.push(`matches tend to be high-scoring (${stats.avg_goals.toFixed(1)} goals/match)`)
  if (goalExpectation === 'lower') summaryParts.push(`matches tend to be lower-scoring (${stats.avg_goals.toFixed(1)} goals/match)`)

  return NextResponse.json({
    name: refereeName,
    country: stats.nationality,
    experience_years: stats.experience_years,
    career_matches: stats.career_matches,
    avg_yellow_cards: stats.avg_yellow_cards,
    avg_red_cards: stats.avg_red_cards,
    home_win_rate: stats.home_win_rate,
    draw_rate: stats.draw_rate,
    away_win_rate: stats.away_win_rate,
    avg_goals: stats.avg_goals,
    penalties_per_match: stats.penalties_per_match,
    total_penalties: stats.total_penalties,
    competitions: stats.competitions,
    is_league_average: !dbStats,
    home_team_history: null,
    away_team_history: null,
    prediction_impact: {
      cardLikelihood,
      homeBias,
      goalExpectation,
      summary: summaryParts.join('; ') + '.',
    },
  })
}
