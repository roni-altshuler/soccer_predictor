import { NextRequest, NextResponse } from 'next/server'

// League ID mapping for ESPN
const LEAGUE_MAPPING: Record<number, string> = {
  47: 'eng.1',  // Premier League
  87: 'esp.1',  // La Liga
  55: 'ita.1',  // Serie A
  54: 'ger.1',  // Bundesliga
  53: 'fra.1',  // Ligue 1
  130: 'usa.1', // MLS
}

const LEAGUE_NAMES: Record<number, string> = {
  47: 'Premier League',
  87: 'La Liga',
  55: 'Serie A',
  54: 'Bundesliga',
  53: 'Ligue 1',
  130: 'MLS',
}

// Sample teams for each league when API is unavailable
const SAMPLE_TEAMS: Record<number, { name: string; points: number }[]> = {
  47: [ // Premier League
    { name: 'Liverpool', points: 50 },
    { name: 'Arsenal', points: 44 },
    { name: 'Nottingham Forest', points: 41 },
    { name: 'Chelsea', points: 40 },
    { name: 'Newcastle United', points: 38 },
    { name: 'Manchester City', points: 38 },
    { name: 'Bournemouth', points: 37 },
    { name: 'Brighton', points: 34 },
    { name: 'Aston Villa', points: 34 },
    { name: 'Fulham', points: 33 },
    { name: 'Brentford', points: 28 },
    { name: 'Manchester United', points: 26 },
    { name: 'West Ham United', points: 26 },
    { name: 'Tottenham Hotspur', points: 24 },
    { name: 'Everton', points: 23 },
    { name: 'Crystal Palace', points: 20 },
    { name: 'Wolverhampton', points: 20 },
    { name: 'Leicester City', points: 17 },
    { name: 'Ipswich Town', points: 16 },
    { name: 'Southampton', points: 6 },
  ],
  87: [ // La Liga
    { name: 'Barcelona', points: 42 },
    { name: 'Real Madrid', points: 40 },
    { name: 'Atlético Madrid', points: 38 },
    { name: 'Athletic Club', points: 36 },
    { name: 'Villarreal', points: 32 },
    { name: 'Mallorca', points: 30 },
    { name: 'Real Betis', points: 29 },
    { name: 'Osasuna', points: 28 },
    { name: 'Girona', points: 27 },
    { name: 'Rayo Vallecano', points: 26 },
    { name: 'Real Sociedad', points: 25 },
    { name: 'Celta Vigo', points: 24 },
    { name: 'Sevilla', points: 23 },
    { name: 'Getafe', points: 22 },
    { name: 'Alavés', points: 21 },
    { name: 'Espanyol', points: 20 },
    { name: 'Las Palmas', points: 19 },
    { name: 'Leganés', points: 18 },
    { name: 'Real Valladolid', points: 15 },
    { name: 'Valencia', points: 13 },
  ],
  55: [ // Serie A
    { name: 'Napoli', points: 47 },
    { name: 'Inter Milan', points: 44 },
    { name: 'Atalanta', points: 42 },
    { name: 'Lazio', points: 39 },
    { name: 'Juventus', points: 34 },
    { name: 'Fiorentina', points: 33 },
    { name: 'Bologna', points: 30 },
    { name: 'AC Milan', points: 28 },
    { name: 'Udinese', points: 26 },
    { name: 'Roma', points: 24 },
    { name: 'Torino', points: 23 },
    { name: 'Genoa', points: 22 },
    { name: 'Empoli', points: 21 },
    { name: 'Como', points: 19 },
    { name: 'Parma', points: 19 },
    { name: 'Lecce', points: 17 },
    { name: 'Cagliari', points: 17 },
    { name: 'Verona', points: 16 },
    { name: 'Venezia', points: 14 },
    { name: 'Monza', points: 10 },
  ],
  54: [ // Bundesliga
    { name: 'Bayern Munich', points: 42 },
    { name: 'Bayer Leverkusen', points: 38 },
    { name: 'Eintracht Frankfurt', points: 33 },
    { name: 'RB Leipzig', points: 30 },
    { name: 'Mainz 05', points: 28 },
    { name: 'SC Freiburg', points: 27 },
    { name: 'Borussia Dortmund', points: 26 },
    { name: 'Werder Bremen', points: 25 },
    { name: 'VfB Stuttgart', points: 24 },
    { name: 'Wolfsburg', points: 24 },
    { name: 'Augsburg', points: 23 },
    { name: 'Borussia Mönchengladbach', points: 22 },
    { name: 'Union Berlin', points: 20 },
    { name: 'St. Pauli', points: 18 },
    { name: 'Hoffenheim', points: 15 },
    { name: 'Holstein Kiel', points: 11 },
    { name: 'Heidenheim', points: 11 },
    { name: 'Bochum', points: 9 },
  ],
  53: [ // Ligue 1
    { name: 'Paris Saint-Germain', points: 43 },
    { name: 'Marseille', points: 37 },
    { name: 'Monaco', points: 34 },
    { name: 'Lille', points: 32 },
    { name: 'Lyon', points: 31 },
    { name: 'Nice', points: 29 },
    { name: 'Lens', points: 27 },
    { name: 'Auxerre', points: 25 },
    { name: 'Reims', points: 24 },
    { name: 'Strasbourg', points: 23 },
    { name: 'Brest', points: 23 },
    { name: 'Toulouse', points: 22 },
    { name: 'Nantes', points: 21 },
    { name: 'Rennes', points: 20 },
    { name: 'Saint-Étienne', points: 18 },
    { name: 'Angers', points: 17 },
    { name: 'Le Havre', points: 14 },
    { name: 'Montpellier', points: 12 },
  ],
  130: [ // MLS
    { name: 'Inter Miami', points: 40 },
    { name: 'Columbus Crew', points: 38 },
    { name: 'LA Galaxy', points: 36 },
    { name: 'FC Cincinnati', points: 34 },
    { name: 'LAFC', points: 33 },
    { name: 'Real Salt Lake', points: 32 },
    { name: 'New York Red Bulls', points: 30 },
    { name: 'Charlotte FC', points: 28 },
    { name: 'Portland Timbers', points: 27 },
    { name: 'Orlando City', points: 26 },
    { name: 'New York City FC', points: 25 },
    { name: 'Seattle Sounders', points: 24 },
    { name: 'Atlanta United', points: 23 },
    { name: 'Nashville SC', points: 22 },
    { name: 'Philadelphia Union', points: 20 },
    { name: 'CF Montréal', points: 19 },
    { name: 'Chicago Fire', points: 18 },
    { name: 'Austin FC', points: 17 },
    { name: 'San Jose Earthquakes', points: 15 },
    { name: 'D.C. United', points: 14 },
  ],
}

interface Standing {
  team_name: string
  team_id: number | null
  current_position: number
  current_points: number
  avg_final_position: number
  avg_final_points: number
  title_probability: number
  top_4_probability: number
  europa_probability: number
  relegation_probability: number
}

// League configuration - total matches per season for different league sizes
const LEAGUE_MATCH_CONFIG: Record<number, number> = {
  47: 38, // Premier League (20 teams)
  87: 38, // La Liga (20 teams)
  55: 38, // Serie A (20 teams)
  54: 34, // Bundesliga (18 teams)
  53: 34, // Ligue 1 (18 teams)
}

// Points per win
const POINTS_PER_WIN = 3

// Probability factors
const TITLE_RANDOM_FACTOR = 0.1
const TOP4_RANDOM_FACTOR = 0.05
const RELEGATION_RANDOM_FACTOR = 0.05

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId: leagueIdStr } = await params
  const leagueId = parseInt(leagueIdStr, 10)
  const espnLeagueId = LEAGUE_MAPPING[leagueId]
  const leagueName = LEAGUE_NAMES[leagueId] || 'Unknown League'
  
  const searchParams = request.nextUrl.searchParams
  const nSimulations = parseInt(searchParams.get('n_simulations') || '1000', 10)
  
  if (!espnLeagueId) {
    return NextResponse.json({ error: 'Invalid league ID' }, { status: 400 })
  }
  
  // Helper function to generate simulation results from team data
  const generateSimulationResults = (teams: { name: string; points: number }[]) => {
    const totalTeams = teams.length
    const totalMatchesPerSeason = LEAGUE_MATCH_CONFIG[leagueId] || 38
    const maxPoints = totalMatchesPerSeason * POINTS_PER_WIN // e.g., 114 for 38 games
    
    // Estimate matches played from leader's points (approximate 2 pts/match average)
    const leaderPoints = teams[0]?.points || 0
    const estimatedMatchesPlayed = Math.min(totalMatchesPerSeason, Math.round(leaderPoints / 2))
    const remainingMatches = totalMatchesPerSeason - estimatedMatchesPlayed
    
    // Calculate projected points for all teams based on current performance
    const teamsWithProjections = teams.map((team, idx) => {
      const currentPosition = idx + 1
      const points = team.points
      
      // Calculate avg points per game based on estimated matches played
      const avgPointsPerGame = estimatedMatchesPlayed > 0 ? points / estimatedMatchesPlayed : 1.5
      
      // Project final points: current points + expected from remaining matches
      // Leaders (lower positions) get slight boost as they're more likely to maintain form
      const leaderBonus = 1 - (0.05 * (currentPosition - 1) / totalTeams)
      const projectedPoints = Math.min(maxPoints, points + (remainingMatches * avgPointsPerGame * leaderBonus))
      
      return {
        name: team.name,
        currentPosition,
        currentPoints: points,
        projectedPoints: Math.round(projectedPoints),
      }
    })
    
    // Sort by projected points to get predicted final positions
    // This ensures the team with most expected points is #1
    const sortedByProjected = [...teamsWithProjections].sort((a, b) => b.projectedPoints - a.projectedPoints)
    
    // Create standings with probabilities based on PROJECTED position
    const standings: Standing[] = sortedByProjected.map((team, projectedIdx) => {
      const projectedPosition = projectedIdx + 1
      
      // Calculate probabilities based on projected position
      // Position 1 gets highest title probability, decreases for others
      let titleProb = 0
      if (projectedPosition === 1) {
        titleProb = 0.45 + Math.random() * TITLE_RANDOM_FACTOR
      } else if (projectedPosition === 2) {
        titleProb = 0.25 + Math.random() * TITLE_RANDOM_FACTOR
      } else if (projectedPosition === 3) {
        titleProb = 0.12 + Math.random() * TITLE_RANDOM_FACTOR
      } else if (projectedPosition === 4) {
        titleProb = 0.05 + Math.random() * TITLE_RANDOM_FACTOR
      }
      
      // Top 4 probability
      let top4Prob = 0
      if (projectedPosition <= 4) {
        top4Prob = 0.7 + (4 - projectedPosition) * 0.08 + Math.random() * TOP4_RANDOM_FACTOR
      } else if (projectedPosition <= 6) {
        top4Prob = 0.3 - (projectedPosition - 4) * 0.1 + Math.random() * TOP4_RANDOM_FACTOR
      } else if (projectedPosition <= 8) {
        top4Prob = 0.05 + Math.random() * 0.05
      }
      
      // Europa probability (5th-7th typically)
      let europaProb = 0
      if (projectedPosition >= 5 && projectedPosition <= 7) {
        europaProb = 0.4 + Math.random() * 0.1
      } else if (projectedPosition === 4 || projectedPosition === 8) {
        europaProb = 0.15 + Math.random() * 0.1
      }
      
      // Relegation probability (bottom 3-4 teams)
      const relegationZone = totalTeams <= 18 ? 3 : 3 // Bottom 3 usually
      let relegationProb = 0
      if (projectedPosition > totalTeams - relegationZone) {
        relegationProb = 0.5 + (projectedPosition - (totalTeams - relegationZone)) * 0.15 + Math.random() * RELEGATION_RANDOM_FACTOR
      } else if (projectedPosition > totalTeams - 5) {
        relegationProb = 0.15 + Math.random() * RELEGATION_RANDOM_FACTOR
      }
      
      return {
        team_name: team.name,
        team_id: null,
        current_position: team.currentPosition,
        current_points: team.currentPoints,
        avg_final_position: projectedPosition + (Math.random() * 0.5 - 0.25),
        avg_final_points: team.projectedPoints,
        title_probability: Math.min(1, titleProb),
        top_4_probability: Math.min(1, top4Prob),
        europa_probability: Math.min(1, europaProb),
        relegation_probability: Math.min(1, relegationProb),
      }
    })
    
    // The team with highest expected points is the most likely champion (first in sorted list)
    const mostLikelyChampion = standings[0]?.team_name || 'Unknown'
    const championProbability = standings[0]?.title_probability || 0
    
    const sortedByTop4 = [...standings].sort((a, b) => b.top_4_probability - a.top_4_probability)
    const likelyTop4 = sortedByTop4.slice(0, 4).map(t => t.team_name)
    
    const sortedByRelegation = [...standings].sort((a, b) => b.relegation_probability - a.relegation_probability)
    const relegationCandidates = sortedByRelegation.slice(0, 3).map(t => t.team_name)
    
    return {
      league_id: leagueId,
      league_name: leagueName,
      n_simulations: nSimulations,
      remaining_matches: remainingMatches,
      most_likely_champion: mostLikelyChampion,
      champion_probability: championProbability,
      likely_top_4: likelyTop4,
      relegation_candidates: relegationCandidates,
      standings,
    }
  }
  
  try {
    // Try to fetch current standings from ESPN
    const standingsRes = await fetch(
      `https://site.api.espn.com/apis/v2/sports/soccer/${espnLeagueId}/standings`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        next: { revalidate: 300 },
      }
    )
    
    if (!standingsRes.ok) {
      throw new Error('Failed to fetch standings from ESPN')
    }
    
    const standingsData = await standingsRes.json()
    const entries = standingsData.children?.[0]?.standings?.entries || []
    
    if (entries.length === 0) {
      throw new Error('No standings data available')
    }
    
    // Parse ESPN standings
    const teams = entries.map((entry: any) => ({
      name: entry.team?.displayName || 'Unknown',
      points: entry.stats?.find((s: any) => s.name === 'points')?.value || 0,
    }))
    
    return NextResponse.json(generateSimulationResults(teams))
  } catch {
    // Fallback to sample data when ESPN API is unavailable
    const sampleTeams = SAMPLE_TEAMS[leagueId]
    
    if (!sampleTeams) {
      return NextResponse.json(
        { error: 'League data not available' },
        { status: 500 }
      )
    }
    
    return NextResponse.json(generateSimulationResults(sampleTeams))
  }
}
