import { NextRequest, NextResponse } from 'next/server'

interface TeamStanding {
  position: number
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  form: string[]
  predictedPosition: number
  predictedPoints: number
  titleProbability: number
  top4Probability: number
  relegationProbability: number
}

interface LeagueStandings {
  league: string
  season: string
  standings: TeamStanding[]
  remainingMatches: number
  simulationsRun: number
}

// ESPN league ID mapping
const LEAGUE_ESPN_MAP: Record<string, string> = {
  premier_league: 'eng.1',
  la_liga: 'esp.1',
  bundesliga: 'ger.1',
  serie_a: 'ita.1',
  ligue_1: 'fra.1',
  mls: 'usa.1',
  eredivisie: 'ned.1',
  primeira_liga: 'por.1',
}

// Total matches per league (season length varies)
const LEAGUE_TOTAL_MATCHES: Record<string, number> = {
  premier_league: 38,
  la_liga: 38,
  bundesliga: 34,
  serie_a: 38,
  ligue_1: 34,
  mls: 34,
  eredivisie: 34,
  primeira_liga: 34,
}

/**
 * Fetch live standings from ESPN API for any supported league.
 */
async function fetchESPNStandings(espnId: string): Promise<TeamStanding[]> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/v2/sports/soccer/${espnId}/standings`,
      { next: { revalidate: 300 }, signal: AbortSignal.timeout(10000) }
    )
    if (!res.ok) return []
    const data = await res.json()

    const children = data.children || []
    const allEntries: any[] = []
    for (const child of children) {
      const entries = child?.standings?.entries || []
      allEntries.push(...entries)
    }
    if (allEntries.length === 0) return []

    // Sort by points (desc), then goal diff (desc), then goals for (desc)
    allEntries.sort((a: any, b: any) => {
      const getStat = (entry: any, name: string) => {
        const s = entry.stats?.find((s: any) => s.name === name)
        return parseInt(s?.value || '0', 10)
      }
      const ptsDiff = getStat(b, 'points') - getStat(a, 'points')
      if (ptsDiff !== 0) return ptsDiff
      const gdDiff = getStat(b, 'pointDifferential') - getStat(a, 'pointDifferential')
      if (gdDiff !== 0) return gdDiff
      return getStat(b, 'pointsFor') - getStat(a, 'pointsFor')
    })

    return allEntries.map((entry: any, idx: number) => {
      const getStat = (name: string) => {
        const s = entry.stats?.find((s: any) => s.name === name)
        return parseInt(s?.value || '0', 10)
      }
      return {
        position: idx + 1,
        team: entry.team?.displayName || 'Unknown',
        played: getStat('gamesPlayed'),
        won: getStat('wins'),
        drawn: getStat('ties'),
        lost: getStat('losses'),
        goalsFor: getStat('pointsFor'),
        goalsAgainst: getStat('pointsAgainst'),
        goalDifference: getStat('pointDifferential'),
        points: getStat('points'),
        form: [],
        predictedPosition: idx + 1,
        predictedPoints: getStat('points'),
        titleProbability: 0,
        top4Probability: 0,
        relegationProbability: 0,
      }
    })
  } catch {
    return []
  }
}

// Monte Carlo season simulation
function simulateSeason(standings: TeamStanding[], remainingMatches: number, simulations: number = 1000): TeamStanding[] {
  const simulatedStandings = standings.map(team => ({ ...team }))
  const n = simulatedStandings.length
  if (n === 0 || remainingMatches <= 0) return simulatedStandings

  const positionCounts: Record<string, number[]> = {}
  const pointsCounts: Record<string, number[]> = {}
  for (const team of simulatedStandings) {
    positionCounts[team.team] = new Array(n).fill(0)
    pointsCounts[team.team] = []
  }

  for (let sim = 0; sim < simulations; sim++) {
    const simPoints: Record<string, number> = {}
    for (const team of simulatedStandings) {
      let extraPoints = 0
      const matchesPerTeam = Math.ceil(remainingMatches / n * 2)
      for (let m = 0; m < matchesPerTeam; m++) {
        const winRate = team.won / Math.max(team.played, 1)
        const drawRate = team.drawn / Math.max(team.played, 1)
        const rand = Math.random()
        if (rand < winRate) extraPoints += 3
        else if (rand < winRate + drawRate) extraPoints += 1
      }
      simPoints[team.team] = team.points + extraPoints
      pointsCounts[team.team].push(simPoints[team.team])
    }
    const sorted = Object.entries(simPoints).sort((a, b) => b[1] - a[1])
    sorted.forEach(([teamName], idx) => {
      if (positionCounts[teamName]) positionCounts[teamName][idx]++
    })
  }

  for (const team of simulatedStandings) {
    const avgPoints = pointsCounts[team.team].reduce((a, b) => a + b, 0) / simulations
    team.predictedPoints = Math.round(avgPoints)
    team.titleProbability = Math.round((positionCounts[team.team][0] / simulations) * 100)
    const top4Count = positionCounts[team.team].slice(0, 4).reduce((a, b) => a + b, 0)
    team.top4Probability = Math.round((top4Count / simulations) * 100)
    const relegationSlots = Math.min(3, n)
    const relegationCount = positionCounts[team.team].slice(n - relegationSlots, n).reduce((a, b) => a + b, 0)
    team.relegationProbability = Math.round((relegationCount / simulations) * 100)
    const maxPosCount = Math.max(...positionCounts[team.team])
    team.predictedPosition = positionCounts[team.team].indexOf(maxPosCount) + 1
  }

  return simulatedStandings.sort((a, b) => b.points - a.points)
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const league = searchParams.get('league') || 'premier_league'
  const simulations = parseInt(searchParams.get('simulations') || '1000')

  try {
    const espnId = LEAGUE_ESPN_MAP[league]
    let standings: TeamStanding[] = []

    // Always fetch live from ESPN first
    if (espnId) {
      standings = await fetchESPNStandings(espnId)
    }

    if (standings.length === 0) {
      return NextResponse.json({
        league: league.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        season: '2025-2026',
        standings: [],
        remainingMatches: 0,
        simulationsRun: 0,
      })
    }

    // Use league-specific season length
    const totalMatches = LEAGUE_TOTAL_MATCHES[league] ?? 38
    const playedMatches = standings[0]?.played || 0
    const remainingMatches = Math.max(0, totalMatches - playedMatches)

    // Run simulation on live data
    const simulatedStandings = simulateSeason(standings, remainingMatches, simulations)

    return NextResponse.json({
      league: league.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      season: '2025-2026',
      standings: simulatedStandings,
      remainingMatches,
      simulationsRun: simulations,
    } as LeagueStandings)
  } catch (error) {
    console.error('Error generating standings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch standings' },
      { status: 500 }
    )
  }
}
