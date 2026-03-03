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

// Sample standings data for major leagues
const SAMPLE_STANDINGS: Record<string, TeamStanding[]> = {
  'premier_league': [
    { position: 1, team: 'Liverpool', played: 21, won: 14, drawn: 6, lost: 1, goalsFor: 52, goalsAgainst: 22, goalDifference: 30, points: 48, form: ['W', 'W', 'D', 'W', 'W'], predictedPosition: 1, predictedPoints: 89, titleProbability: 65, top4Probability: 99, relegationProbability: 0 },
    { position: 2, team: 'Arsenal', played: 21, won: 12, drawn: 7, lost: 2, goalsFor: 43, goalsAgainst: 20, goalDifference: 23, points: 43, form: ['W', 'D', 'W', 'W', 'D'], predictedPosition: 2, predictedPoints: 82, titleProbability: 22, top4Probability: 97, relegationProbability: 0 },
    { position: 3, team: 'Nottingham Forest', played: 21, won: 12, drawn: 5, lost: 4, goalsFor: 37, goalsAgainst: 22, goalDifference: 15, points: 41, form: ['W', 'W', 'L', 'W', 'W'], predictedPosition: 4, predictedPoints: 74, titleProbability: 5, top4Probability: 78, relegationProbability: 0 },
    { position: 4, team: 'Chelsea', played: 21, won: 11, drawn: 5, lost: 5, goalsFor: 43, goalsAgainst: 27, goalDifference: 16, points: 38, form: ['L', 'W', 'D', 'W', 'W'], predictedPosition: 5, predictedPoints: 70, titleProbability: 3, top4Probability: 65, relegationProbability: 0 },
    { position: 5, team: 'Manchester City', played: 21, won: 10, drawn: 5, lost: 6, goalsFor: 42, goalsAgainst: 28, goalDifference: 14, points: 35, form: ['L', 'D', 'W', 'L', 'W'], predictedPosition: 3, predictedPoints: 76, titleProbability: 5, top4Probability: 82, relegationProbability: 0 },
    { position: 6, team: 'Newcastle United', played: 21, won: 10, drawn: 5, lost: 6, goalsFor: 35, goalsAgainst: 24, goalDifference: 11, points: 35, form: ['W', 'D', 'W', 'D', 'W'], predictedPosition: 6, predictedPoints: 66, titleProbability: 0, top4Probability: 45, relegationProbability: 0 },
    { position: 7, team: 'Bournemouth', played: 21, won: 10, drawn: 4, lost: 7, goalsFor: 35, goalsAgainst: 27, goalDifference: 8, points: 34, form: ['W', 'L', 'W', 'W', 'L'], predictedPosition: 8, predictedPoints: 58, titleProbability: 0, top4Probability: 15, relegationProbability: 0 },
    { position: 8, team: 'Aston Villa', played: 21, won: 9, drawn: 5, lost: 7, goalsFor: 32, goalsAgainst: 32, goalDifference: 0, points: 32, form: ['L', 'W', 'D', 'L', 'W'], predictedPosition: 7, predictedPoints: 62, titleProbability: 0, top4Probability: 22, relegationProbability: 0 },
    { position: 9, team: 'Brighton', played: 21, won: 7, drawn: 10, lost: 4, goalsFor: 35, goalsAgainst: 30, goalDifference: 5, points: 31, form: ['D', 'D', 'W', 'D', 'D'], predictedPosition: 9, predictedPoints: 55, titleProbability: 0, top4Probability: 8, relegationProbability: 0 },
    { position: 10, team: 'Fulham', played: 21, won: 8, drawn: 6, lost: 7, goalsFor: 32, goalsAgainst: 30, goalDifference: 2, points: 30, form: ['W', 'L', 'D', 'W', 'L'], predictedPosition: 10, predictedPoints: 52, titleProbability: 0, top4Probability: 5, relegationProbability: 2 },
    { position: 11, team: 'Manchester United', played: 21, won: 8, drawn: 4, lost: 9, goalsFor: 30, goalsAgainst: 29, goalDifference: 1, points: 28, form: ['L', 'W', 'L', 'W', 'L'], predictedPosition: 11, predictedPoints: 50, titleProbability: 0, top4Probability: 3, relegationProbability: 3 },
    { position: 12, team: 'Tottenham', played: 21, won: 8, drawn: 3, lost: 10, goalsFor: 42, goalsAgainst: 35, goalDifference: 7, points: 27, form: ['L', 'L', 'W', 'W', 'L'], predictedPosition: 12, predictedPoints: 48, titleProbability: 0, top4Probability: 2, relegationProbability: 5 },
    { position: 13, team: 'Brentford', played: 21, won: 8, drawn: 3, lost: 10, goalsFor: 39, goalsAgainst: 39, goalDifference: 0, points: 27, form: ['W', 'L', 'L', 'W', 'L'], predictedPosition: 13, predictedPoints: 46, titleProbability: 0, top4Probability: 1, relegationProbability: 8 },
    { position: 14, team: 'West Ham', played: 21, won: 7, drawn: 4, lost: 10, goalsFor: 29, goalsAgainst: 38, goalDifference: -9, points: 25, form: ['L', 'D', 'L', 'W', 'L'], predictedPosition: 14, predictedPoints: 44, titleProbability: 0, top4Probability: 0, relegationProbability: 12 },
    { position: 15, team: 'Everton', played: 21, won: 5, drawn: 8, lost: 8, goalsFor: 21, goalsAgainst: 28, goalDifference: -7, points: 23, form: ['D', 'L', 'D', 'D', 'L'], predictedPosition: 15, predictedPoints: 42, titleProbability: 0, top4Probability: 0, relegationProbability: 18 },
    { position: 16, team: 'Crystal Palace', played: 21, won: 5, drawn: 8, lost: 8, goalsFor: 24, goalsAgainst: 29, goalDifference: -5, points: 23, form: ['D', 'D', 'L', 'D', 'W'], predictedPosition: 16, predictedPoints: 40, titleProbability: 0, top4Probability: 0, relegationProbability: 22 },
    { position: 17, team: 'Wolverhampton', played: 21, won: 5, drawn: 7, lost: 9, goalsFor: 32, goalsAgainst: 40, goalDifference: -8, points: 22, form: ['L', 'D', 'W', 'L', 'D'], predictedPosition: 17, predictedPoints: 38, titleProbability: 0, top4Probability: 0, relegationProbability: 35 },
    { position: 18, team: 'Leicester City', played: 21, won: 5, drawn: 5, lost: 11, goalsFor: 28, goalsAgainst: 44, goalDifference: -16, points: 20, form: ['L', 'L', 'W', 'L', 'L'], predictedPosition: 18, predictedPoints: 35, titleProbability: 0, top4Probability: 0, relegationProbability: 58 },
    { position: 19, team: 'Ipswich Town', played: 21, won: 4, drawn: 7, lost: 10, goalsFor: 23, goalsAgainst: 38, goalDifference: -15, points: 19, form: ['D', 'L', 'D', 'L', 'L'], predictedPosition: 19, predictedPoints: 32, titleProbability: 0, top4Probability: 0, relegationProbability: 72 },
    { position: 20, team: 'Southampton', played: 21, won: 2, drawn: 4, lost: 15, goalsFor: 16, goalsAgainst: 47, goalDifference: -31, points: 10, form: ['L', 'L', 'L', 'D', 'L'], predictedPosition: 20, predictedPoints: 22, titleProbability: 0, top4Probability: 0, relegationProbability: 98 },
  ],
  'la_liga': [
    { position: 1, team: 'Atletico Madrid', played: 20, won: 14, drawn: 4, lost: 2, goalsFor: 36, goalsAgainst: 14, goalDifference: 22, points: 46, form: ['W', 'W', 'W', 'D', 'W'], predictedPosition: 1, predictedPoints: 88, titleProbability: 45, top4Probability: 99, relegationProbability: 0 },
    { position: 2, team: 'Real Madrid', played: 19, won: 13, drawn: 4, lost: 2, goalsFor: 42, goalsAgainst: 17, goalDifference: 25, points: 43, form: ['W', 'D', 'W', 'W', 'L'], predictedPosition: 2, predictedPoints: 86, titleProbability: 38, top4Probability: 98, relegationProbability: 0 },
    { position: 3, team: 'Barcelona', played: 20, won: 13, drawn: 4, lost: 3, goalsFor: 52, goalsAgainst: 23, goalDifference: 29, points: 43, form: ['W', 'L', 'W', 'D', 'W'], predictedPosition: 3, predictedPoints: 82, titleProbability: 15, top4Probability: 95, relegationProbability: 0 },
    { position: 4, team: 'Athletic Bilbao', played: 20, won: 11, drawn: 6, lost: 3, goalsFor: 32, goalsAgainst: 17, goalDifference: 15, points: 39, form: ['D', 'W', 'D', 'W', 'W'], predictedPosition: 4, predictedPoints: 74, titleProbability: 2, top4Probability: 85, relegationProbability: 0 },
    { position: 5, team: 'Villarreal', played: 20, won: 10, drawn: 4, lost: 6, goalsFor: 34, goalsAgainst: 31, goalDifference: 3, points: 34, form: ['L', 'W', 'W', 'L', 'W'], predictedPosition: 5, predictedPoints: 65, titleProbability: 0, top4Probability: 45, relegationProbability: 0 },
  ],
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

// Simulate remaining matches using Monte Carlo simulation
function simulateSeason(standings: TeamStanding[], remainingMatches: number, simulations: number = 1000): TeamStanding[] {
  // Clone standings for simulation
  const simulatedStandings = standings.map(team => ({ ...team }))
  
  // Run simulations
  const positionCounts: Record<string, number[]> = {}
  const pointsCounts: Record<string, number[]> = {}
  
  for (const team of simulatedStandings) {
    positionCounts[team.team] = new Array(20).fill(0)
    pointsCounts[team.team] = []
  }
  
  for (let sim = 0; sim < simulations; sim++) {
    // Simulate each team's remaining matches
    const simPoints: Record<string, number> = {}
    
    for (const team of simulatedStandings) {
      let extraPoints = 0
      const matchesPerTeam = Math.ceil(remainingMatches / simulatedStandings.length * 2)
      
      for (let m = 0; m < matchesPerTeam; m++) {
        // Simple probability based on current form
        const winRate = team.won / Math.max(team.played, 1)
        const drawRate = team.drawn / Math.max(team.played, 1)
        
        const rand = Math.random()
        if (rand < winRate) {
          extraPoints += 3
        } else if (rand < winRate + drawRate) {
          extraPoints += 1
        }
      }
      
      simPoints[team.team] = team.points + extraPoints
      pointsCounts[team.team].push(simPoints[team.team])
    }
    
    // Sort by points to get positions
    const sorted = Object.entries(simPoints).sort((a, b) => b[1] - a[1])
    sorted.forEach(([teamName], idx) => {
      positionCounts[teamName][idx]++
    })
  }
  
  // Calculate probabilities
  for (const team of simulatedStandings) {
    const avgPoints = pointsCounts[team.team].reduce((a, b) => a + b, 0) / simulations
    team.predictedPoints = Math.round(avgPoints)
    
    // Title probability (position 1)
    team.titleProbability = Math.round((positionCounts[team.team][0] / simulations) * 100)
    
    // Top 4 probability
    const top4Count = positionCounts[team.team].slice(0, 4).reduce((a, b) => a + b, 0)
    team.top4Probability = Math.round((top4Count / simulations) * 100)
    
    // Relegation probability (positions 18-20)
    const relegationCount = positionCounts[team.team].slice(17, 20).reduce((a, b) => a + b, 0)
    team.relegationProbability = Math.round((relegationCount / simulations) * 100)
    
    // Most likely final position
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
    // Get base standings — never fall back to a different league's data
    const baseStandings = SAMPLE_STANDINGS[league]
    
    if (!baseStandings || baseStandings.length === 0) {
      // No cached standings for this league — return empty so the client
      // relies on the primary ESPN fetch instead of stale data from another league
      return NextResponse.json({
        league: league.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        season: '2025-2026',
        standings: [],
        remainingMatches: 0,
        simulationsRun: 0,
      })
    }
    
    // Use league-specific season length (default 38)
    const totalMatches = LEAGUE_TOTAL_MATCHES[league] ?? 38
    const playedMatches = baseStandings[0]?.played || 0
    const remainingMatches = Math.max(0, totalMatches - playedMatches)
    
    // Run simulation
    const simulatedStandings = simulateSeason(baseStandings, remainingMatches, simulations)
    
    const result: LeagueStandings = {
      league: league.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      season: '2025-2026',
      standings: simulatedStandings,
      remainingMatches,
      simulationsRun: simulations,
    }
    
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error generating standings simulation:', error)
    return NextResponse.json(
      { error: 'Failed to generate standings simulation' },
      { status: 500 }
    )
  }
}
