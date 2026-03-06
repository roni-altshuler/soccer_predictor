import { NextRequest, NextResponse } from 'next/server'

// League ID mapping for ESPN
const LEAGUE_MAPPING: Record<number, string> = {
  47: 'eng.1',  // Premier League
  87: 'esp.1',  // La Liga
  55: 'ita.1',  // Serie A
  54: 'ger.1',  // Bundesliga
  53: 'fra.1',  // Ligue 1
  130: 'usa.1', // MLS
  57: 'ned.1',  // Eredivisie
  61: 'por.1',  // Primeira Liga
}

const LEAGUE_NAMES: Record<number, string> = {
  47: 'Premier League',
  87: 'La Liga',
  55: 'Serie A',
  54: 'Bundesliga',
  53: 'Ligue 1',
  130: 'MLS',
  57: 'Eredivisie',
  61: 'Primeira Liga',
}

// League configuration - total matches per season
const LEAGUE_MATCH_CONFIG: Record<number, number> = {
  47: 38, 87: 38, 55: 38, 54: 34, 53: 34, 130: 34, 57: 34, 61: 34,
}

// League size (number of teams)
const LEAGUE_SIZE: Record<number, number> = {
  47: 20, 87: 20, 55: 20, 54: 18, 53: 18, 130: 29, 57: 18, 61: 18,
}

interface TeamData {
  name: string
  points: number
  wins: number
  draws: number
  losses: number
  gf: number
  ga: number
  gd: number
  matchesPlayed: number
}

interface Standing {
  team_name: string
  team_id: number | null
  current_position: number
  current_points: number
  matches_played: number
  avg_final_position: number
  avg_final_points: number
  title_probability: number
  top_4_probability: number
  europa_probability: number
  relegation_probability: number
  position_distribution: Record<number, number>  // position → probability
}

/**
 * Monte Carlo Season Simulation
 *
 * For each remaining match:
 *   1. Compute match probabilities from team strength (PPG-derived)
 *   2. Use Bradley-Terry model: P(home) = str_h / (str_h + str_a) * home_factor
 *   3. Sample outcome from (home_win, draw, away_win) distribution
 *   4. Award points accordingly
 *
 * After all remaining matches are simulated:
 *   - Sort teams by points (then GD tiebreaker)
 *   - Record each team's final position
 *   - Repeat N times and aggregate position frequencies
 */
function runMonteCarloSimulation(
  teams: TeamData[],
  totalMatchesPerSeason: number,
  nSimulations: number,
  leagueId: number,
): Standing[] {
  const numTeams = teams.length
  if (numTeams === 0) return []

  // Track position counts for each team across simulations
  // positionCounts[teamIdx][position] = count
  const positionCounts: number[][] = teams.map(() => new Array(numTeams).fill(0))
  const totalPointsSum: number[] = new Array(numTeams).fill(0)

  // Compute team strength from current PPG (points per game)
  // Convert to Bradley-Terry strength: strength = 10^(ppg / scale)
  const strengths = teams.map(t => {
    const ppg = t.matchesPlayed > 0 ? t.points / t.matchesPlayed : 1.3
    return Math.pow(10, ppg / 2.0) // Scale factor
  })

  // Remaining matches per team
  const remainingPerTeam = teams.map(t => Math.max(0, totalMatchesPerSeason - t.matchesPlayed))

  // Build fixture list: for a round-robin league, each team plays every other team
  // twice (home and away). We generate "abstract" remaining fixtures.
  // For simplicity, distribute remaining matches as matchups against league opponents
  // weighted by how many games each needs to play.
  interface Fixture { homeIdx: number; awayIdx: number }

  // Generate remaining fixtures: sample proportionally
  function generateRemainingFixtures(): Fixture[] {
    const fixtures: Fixture[] = []
    const remaining = [...remainingPerTeam]

    // Create a pool of possible matchups
    for (let i = 0; i < numTeams; i++) {
      for (let j = 0; j < numTeams; j++) {
        if (i !== j && remaining[i] > 0 && remaining[j] > 0) {
          fixtures.push({ homeIdx: i, awayIdx: j })
          remaining[i]--
          remaining[j]--
          if (remaining[i] <= 0) break
        }
      }
    }
    return fixtures
  }

  const fixtures = generateRemainingFixtures()
  const totalRemainingMatches = fixtures.length

  // Home advantage factor (empirically ~1.3-1.5 for most leagues)
  const homeFactor = 1.35

  // League-specific draw rate (used to calibrate draw probability)
  const leagueDrawRates: Record<number, number> = {
    47: 0.25, 87: 0.24, 55: 0.27, 54: 0.23, 53: 0.24,
    130: 0.20, 57: 0.22, 61: 0.25,
  }
  const baseDrawRate = leagueDrawRates[leagueId] || 0.24

  // Seeded PRNG for reproducibility (xorshift32)
  let seed = 42
  function rand(): number {
    seed ^= seed << 13
    seed ^= seed >> 17
    seed ^= seed << 5
    return ((seed >>> 0) / 4294967296)
  }

  for (let sim = 0; sim < nSimulations; sim++) {
    // Start each sim with current points
    const simPoints = teams.map(t => t.points)
    const simGD = teams.map(t => t.gd)

    for (const fixture of fixtures) {
      const { homeIdx, awayIdx } = fixture
      const homeStr = strengths[homeIdx] * homeFactor
      const awayStr = strengths[awayIdx]
      const total = homeStr + awayStr

      // Bradley-Terry probabilities
      let pHome = homeStr / total
      let pAway = awayStr / total

      // Inject draw probability: scale down H/A, add draw
      // Draw is more likely when teams are close in strength
      const strengthRatio = Math.min(homeStr, awayStr) / Math.max(homeStr, awayStr)
      const drawProb = baseDrawRate * (0.7 + 0.6 * strengthRatio) // Higher when teams are closer
      const clampedDraw = Math.min(0.40, Math.max(0.10, drawProb))

      pHome = pHome * (1 - clampedDraw)
      pAway = pAway * (1 - clampedDraw)

      // Sample outcome
      const r = rand()
      if (r < pHome) {
        // Home win
        simPoints[homeIdx] += 3
        simGD[homeIdx] += 1
        simGD[awayIdx] -= 1
      } else if (r < pHome + clampedDraw) {
        // Draw
        simPoints[homeIdx] += 1
        simPoints[awayIdx] += 1
      } else {
        // Away win
        simPoints[awayIdx] += 3
        simGD[awayIdx] += 1
        simGD[homeIdx] -= 1
      }
    }

    // Sort teams by points (then GD) to determine final positions
    const indices = teams.map((_, i) => i)
    indices.sort((a, b) => {
      if (simPoints[b] !== simPoints[a]) return simPoints[b] - simPoints[a]
      return simGD[b] - simGD[a]
    })

    for (let pos = 0; pos < indices.length; pos++) {
      const teamIdx = indices[pos]
      positionCounts[teamIdx][pos]++
      totalPointsSum[teamIdx] += simPoints[teamIdx]
    }
  }

  // Build standings from simulation results
  const standings: Standing[] = teams.map((team, idx) => {
    const counts = positionCounts[idx]
    const avgPoints = totalPointsSum[idx] / nSimulations

    // Position distribution as probabilities
    const positionDist: Record<number, number> = {}
    for (let p = 0; p < numTeams; p++) {
      if (counts[p] > 0) {
        positionDist[p + 1] = parseFloat((counts[p] / nSimulations).toFixed(4))
      }
    }

    // Calculate average final position
    let avgPosition = 0
    for (let p = 0; p < numTeams; p++) {
      avgPosition += (p + 1) * counts[p]
    }
    avgPosition /= nSimulations

    // Title = finished 1st
    const titleProb = (counts[0] || 0) / nSimulations

    // Top 4 = finished in positions 1-4
    const top4Prob = ((counts[0] || 0) + (counts[1] || 0) + (counts[2] || 0) + (counts[3] || 0)) / nSimulations

    // Europa = positions 5-7
    const europaProb = ((counts[4] || 0) + (counts[5] || 0) + (counts[6] || 0)) / nSimulations

    // Relegation = bottom 3
    const relegationZone = numTeams <= 18 ? 3 : 3
    let relegationProb = 0
    for (let p = numTeams - relegationZone; p < numTeams; p++) {
      relegationProb += (counts[p] || 0)
    }
    relegationProb /= nSimulations

    return {
      team_name: team.name,
      team_id: null,
      current_position: idx + 1,
      current_points: team.points,
      matches_played: team.matchesPlayed,
      avg_final_position: parseFloat(avgPosition.toFixed(2)),
      avg_final_points: parseFloat(avgPoints.toFixed(1)),
      title_probability: parseFloat(titleProb.toFixed(4)),
      top_4_probability: parseFloat(top4Prob.toFixed(4)),
      europa_probability: parseFloat(europaProb.toFixed(4)),
      relegation_probability: parseFloat(relegationProb.toFixed(4)),
      position_distribution: positionDist,
    }
  })

  // Sort by avg_final_position (predicted finish)
  standings.sort((a, b) => a.avg_final_position - b.avg_final_position)

  return standings
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId: leagueIdStr } = await params
  const leagueId = parseInt(leagueIdStr, 10)
  const espnLeagueId = LEAGUE_MAPPING[leagueId]
  const leagueName = LEAGUE_NAMES[leagueId] || 'Unknown League'

  const searchParams = request.nextUrl.searchParams
  const nSimulations = Math.min(50000, Math.max(100, parseInt(searchParams.get('n_simulations') || '10000', 10)))

  if (!espnLeagueId) {
    return NextResponse.json({ error: 'Invalid league ID' }, { status: 400 })
  }

  const totalMatchesPerSeason = LEAGUE_MATCH_CONFIG[leagueId] || 38

  try {
    // Fetch current standings from ESPN
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

    // Parse ESPN standings with full stats
    const teams: TeamData[] = entries.map((entry: any) => {
      const stats = entry.stats || []
      const getStat = (name: string) => stats.find((s: any) => s.name === name)?.value || 0
      return {
        name: entry.team?.displayName || 'Unknown',
        points: getStat('points'),
        wins: getStat('wins'),
        draws: getStat('ties'),
        losses: getStat('losses'),
        gf: getStat('pointsFor'),
        ga: getStat('pointsAgainst'),
        gd: getStat('pointDifferential'),
        matchesPlayed: getStat('gamesPlayed'),
      }
    })

    // Sort by current points (ESPN should already do this, but ensure)
    teams.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      return b.gd - a.gd
    })

    const standings = runMonteCarloSimulation(teams, totalMatchesPerSeason, nSimulations, leagueId)

    const remainingMatches = Math.max(0, totalMatchesPerSeason - (teams[0]?.matchesPlayed || 0))
    const mostLikelyChampion = standings[0]?.team_name || 'Unknown'
    const championProbability = standings[0]?.title_probability || 0

    const sortedByTop4 = [...standings].sort((a, b) => b.top_4_probability - a.top_4_probability)
    const likelyTop4 = sortedByTop4.slice(0, 4).map(t => t.team_name)

    const sortedByRelegation = [...standings].sort((a, b) => b.relegation_probability - a.relegation_probability)
    const relegationCandidates = sortedByRelegation.slice(0, 3).map(t => t.team_name)

    return NextResponse.json({
      league_id: leagueId,
      league_name: leagueName,
      n_simulations: nSimulations,
      remaining_matches: remainingMatches,
      matches_per_season: totalMatchesPerSeason,
      most_likely_champion: mostLikelyChampion,
      champion_probability: championProbability,
      likely_top_4: likelyTop4,
      relegation_candidates: relegationCandidates,
      standings,
    })
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch league standings. Please try again later.' },
      { status: 500 }
    )
  }
}
