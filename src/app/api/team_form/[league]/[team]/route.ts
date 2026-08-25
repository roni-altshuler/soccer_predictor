import { NextRequest, NextResponse } from 'next/server'
import { ESPN_SITE } from '@/lib/espnHost'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ESPN_LEAGUES = [
  'eng.1',
  'esp.1',
  'ita.1',
  'ger.1',
  'fra.1',
  'ned.1',
  'por.1',
  'usa.1',
  'uefa.champions',
  'uefa.europa',
]

const ESPN_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
}

interface TeamFormMatch {
  date: string
  result: 'win' | 'draw' | 'loss'
  goals_for: number
  goals_against: number
  venue: 'home' | 'away'
  opponent: string
  score_str: string
  competition?: string
}

function normalizeTeamName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function teamNamesMatch(a: string, b: string): boolean {
  const first = normalizeTeamName(a)
  const second = normalizeTeamName(b)
  if (!first || !second) return false
  return first === second || first.includes(second) || second.includes(first)
}

function isCompletedStatus(statusName: string): boolean {
  return statusName.includes('FINAL') || statusName.includes('FULL_TIME')
}

function parseResult(goalsFor: number, goalsAgainst: number): 'win' | 'draw' | 'loss' {
  if (goalsFor > goalsAgainst) return 'win'
  if (goalsFor < goalsAgainst) return 'loss'
  return 'draw'
}

function resolveLeagueCandidates(league: string): string[] {
  if (!league || league === 'all') {
    return ESPN_LEAGUES
  }

  if (ESPN_LEAGUES.includes(league)) {
    return [league, ...ESPN_LEAGUES.filter((item) => item !== league)]
  }

  return ESPN_LEAGUES
}

function scoreTeamNameMatch(query: string, candidateDisplayName: string, candidateShortName: string): number {
  const q = normalizeTeamName(query)
  const display = normalizeTeamName(candidateDisplayName)
  const short = normalizeTeamName(candidateShortName)

  if (!q) return 0
  if (q === display) return 100
  if (q === short) return 95
  if (display.includes(q) || q.includes(display)) return 80
  if (short && (short.includes(q) || q.includes(short))) return 75
  return 0
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const response = await fetch(url, {
      headers: ESPN_HEADERS,
      next: { revalidate: 1800 },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function resolveTeamInLeague(league: string, teamName: string): Promise<{ id: string; name: string } | null> {
  const teamsData = await fetchJson(`${ESPN_SITE}/${league}/teams?limit=300`)
  const teams = teamsData?.sports?.[0]?.leagues?.[0]?.teams || []
  if (!Array.isArray(teams) || teams.length === 0) return null

  let best: { id: string; name: string; score: number } | null = null
  for (const entry of teams) {
    const displayName = String(entry?.team?.displayName || entry?.team?.name || '')
    const shortName = String(entry?.team?.shortDisplayName || '')
    const teamId = String(entry?.team?.id || '')
    if (!displayName || !teamId) continue

    const score = scoreTeamNameMatch(teamName, displayName, shortName)
    if (score <= 0) continue

    if (!best || score > best.score) {
      best = { id: teamId, name: displayName, score }
    }
  }

  if (!best) return null
  return { id: best.id, name: best.name }
}

function buildTeamMatches(scheduleData: any, requestedTeamName: string, teamId: string): TeamFormMatch[] {
  const events = Array.isArray(scheduleData?.events) ? scheduleData.events : []
  const matches: TeamFormMatch[] = []

  for (const event of events) {
    const competition = event?.competitions?.[0]
    if (!competition) continue

    const statusName = String(competition?.status?.type?.name || '')
    if (!isCompletedStatus(statusName)) continue

    const home = competition?.competitors?.find((c: any) => c?.homeAway === 'home')
    const away = competition?.competitors?.find((c: any) => c?.homeAway === 'away')
    if (!home || !away) continue

    const homeTeamName = String(home?.team?.displayName || home?.team?.name || '')
    const awayTeamName = String(away?.team?.displayName || away?.team?.name || '')
    const homeTeamId = String(home?.team?.id || '')
    const awayTeamId = String(away?.team?.id || '')

    const isHome = (teamId && homeTeamId === teamId) || teamNamesMatch(homeTeamName, requestedTeamName)
    const isAway = (teamId && awayTeamId === teamId) || teamNamesMatch(awayTeamName, requestedTeamName)
    if (!isHome && !isAway) continue

    const goalsFor = parseInt(String(isHome ? home?.score : away?.score || '0'), 10) || 0
    const goalsAgainst = parseInt(String(isHome ? away?.score : home?.score || '0'), 10) || 0
    const opponent = isHome ? awayTeamName : homeTeamName
    const date = String(event?.date || competition?.date || '')

    matches.push({
      date,
      result: parseResult(goalsFor, goalsAgainst),
      goals_for: goalsFor,
      goals_against: goalsAgainst,
      venue: isHome ? 'home' : 'away',
      opponent,
      score_str: `${goalsFor}-${goalsAgainst}`,
      competition: String(event?.league?.name || competition?.notes?.[0]?.headline || ''),
    })
  }

  return matches.sort((a, b) => b.date.localeCompare(a.date))
}

function buildH2HSummary(matches: TeamFormMatch[], opponent: string) {
  const opponentMatches = matches.filter((match) => teamNamesMatch(match.opponent, opponent)).slice(0, 8)
  const teamWins = opponentMatches.filter((match) => match.result === 'win').length
  const draws = opponentMatches.filter((match) => match.result === 'draw').length
  const opponentWins = opponentMatches.filter((match) => match.result === 'loss').length
  const avgGoals = opponentMatches.length > 0
    ? opponentMatches.reduce((acc, match) => acc + match.goals_for + match.goals_against, 0) / opponentMatches.length
    : 0

  return {
    opponent,
    teamWins,
    draws,
    opponentWins,
    avgGoals,
    homeWins: teamWins,
    awayWins: opponentWins,
    matches: opponentMatches,
  }
}

function buildResponse(teamName: string, league: string, matches: TeamFormMatch[], opponent?: string | null) {
  const recent = matches.slice(0, 10)
  const form = recent.slice(0, 5).map((match) => {
    if (match.result === 'win') return 'W'
    if (match.result === 'loss') return 'L'
    return 'D'
  })

  const wins = recent.filter((match) => match.result === 'win').length
  const draws = recent.filter((match) => match.result === 'draw').length
  const losses = recent.filter((match) => match.result === 'loss').length
  const goalsScored = recent.reduce((acc, match) => acc + match.goals_for, 0)
  const goalsConceded = recent.reduce((acc, match) => acc + match.goals_against, 0)
  const sample = recent.length || 1

  return {
    team: teamName,
    league,
    form,
    recent_form: form,
    matches: recent,
    matches_played: recent.length,
    wins,
    draws,
    losses,
    points: (wins * 3) + draws,
    goals_scored: goalsScored,
    goals_conceded: goalsConceded,
    win_rate: recent.length > 0 ? wins / recent.length : 0,
    avg_goals_scored: goalsScored / sample,
    avg_goals_conceded: goalsConceded / sample,
    h2h: opponent ? buildH2HSummary(matches, opponent) : null,
  }
}

function emptyResponse(teamName: string, league: string, opponent?: string | null) {
  return {
    team: teamName,
    league,
    form: [],
    recent_form: [],
    matches: [],
    matches_played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    goals_scored: 0,
    goals_conceded: 0,
    win_rate: 0,
    avg_goals_scored: 0,
    avg_goals_conceded: 0,
    h2h: opponent
      ? {
          opponent,
          teamWins: 0,
          draws: 0,
          opponentWins: 0,
          avgGoals: 0,
          homeWins: 0,
          awayWins: 0,
          matches: [],
        }
      : null,
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ league: string; team: string }> }
) {
  const { league, team } = await params
  const decodedTeam = decodeURIComponent(team)
  const opponent = request.nextUrl.searchParams.get('opponent')

  try {
    const leagueCandidates = resolveLeagueCandidates(league)

    for (const leagueId of leagueCandidates) {
      const resolvedTeam = await resolveTeamInLeague(leagueId, decodedTeam)
      if (!resolvedTeam) continue

      const scheduleData = await fetchJson(`${ESPN_SITE}/${leagueId}/teams/${resolvedTeam.id}/schedule`)
      if (!scheduleData) continue

      const matches = buildTeamMatches(scheduleData, resolvedTeam.name, resolvedTeam.id)
      if (matches.length === 0) continue

      return NextResponse.json(buildResponse(resolvedTeam.name, leagueId, matches, opponent), {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      })
    }

    return NextResponse.json(emptyResponse(decodedTeam, league, opponent), {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('Error fetching team form:', error)
    return NextResponse.json(emptyResponse(decodedTeam, league, opponent), {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  }
}
