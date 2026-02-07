'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { KnockoutSimulator, KnockoutBracket, type BracketRound, type KnockoutMatch as BracketMatch } from '@/components/knockout'
import MatchCalendar from '@/components/match/MatchCalendar'
import { getESPNDateRange } from '@/lib/api'

interface TournamentHomePageProps {
  tournamentId: 'champions_league' | 'europa_league' | 'world_cup'
  tournamentName: string
}

interface GroupStanding {
  position: number
  team: string
  teamId?: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

interface Group {
  name: string
  standings: GroupStanding[]
}

interface Match {
  id: string
  homeTeam: string
  awayTeam: string
  homeScore?: number
  awayScore?: number
  date: string
  time?: string
  round?: string
  venue?: string
  status?: 'upcoming' | 'live' | 'finished'
}

interface NewsItem {
  headline: string
  description: string
  link: string
  image?: string
  published: string
}

interface TournamentData {
  groups: Group[]
  knockoutMatches: Match[]
  upcomingMatches: Match[]
  recentResults: Match[]
  news: NewsItem[]
}

const TOURNAMENT_CONFIG = {
  champions_league: {
    name: 'UEFA Champions League',
    emoji: '🏆',
    gradient: 'from-blue-800 to-indigo-600',
    color: 'blue',
    knockoutType: 'champions_league' as const,
    groupCount: 8,
    leagueId: 'uefa.champions',
    espnId: 'uefa.champions',
    logo: 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2.png',
  },
  europa_league: {
    name: 'UEFA Europa League',
    emoji: '🏆',
    gradient: 'from-orange-500 to-amber-500',
    color: 'orange',
    knockoutType: 'europa_league' as const,
    groupCount: 8,
    leagueId: 'uefa.europa',
    espnId: 'uefa.europa',
    logo: 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2310.png',
  },
  world_cup: {
    name: 'FIFA World Cup',
    emoji: '🌍',
    gradient: 'from-purple-900 to-red-800',
    color: 'purple',
    knockoutType: 'world_cup' as const,
    groupCount: 8,
    leagueId: 'fifa.world',
    espnId: 'fifa.world',
    logo: 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/4.png',
  },
}

const TABS = ['Overview', 'Groups', 'Knockout', 'Fixtures', 'Simulator', 'News'] as const
type TabType = typeof TABS[number]

// Available tournament seasons for dropdown
const TOURNAMENT_SEASONS = [
  { value: '2025', label: '2025-26' },
  { value: '2024', label: '2024-25' },
  { value: '2023', label: '2023-24' },
  { value: '2022', label: '2022-23' },
  { value: '2021', label: '2021-22' },
  { value: '2020', label: '2020-21' },
  { value: '2019', label: '2019-20' },
]

const WORLD_CUP_SEASONS = [
  { value: '2026', label: '2026' },
  { value: '2022', label: '2022 (Qatar)' },
  { value: '2018', label: '2018 (Russia)' },
  { value: '2014', label: '2014 (Brazil)' },
  { value: '2010', label: '2010 (South Africa)' },
]

// Simulation count options (like in Predict tab)
const SIMULATION_OPTIONS = [
  { value: 500, label: '500 (Fast)' },
  { value: 1000, label: '1,000' },
  { value: 5000, label: '5,000' },
  { value: 10000, label: '10,000 (Accurate)' },
  { value: 25000, label: '25,000' },
  { value: 50000, label: '50,000' },
]

// Simulation constants
const GOAL_DIFF_NORMALIZATION = 10  // Factor to normalize goal difference impact
const RANDOM_VARIANCE = 5  // Random variance added to team strength
const ROUND_VARIANCE = 3   // Random variance for knockout round outcomes

export default function TournamentHomePage({ tournamentId, tournamentName }: TournamentHomePageProps) {
  const config = TOURNAMENT_CONFIG[tournamentId]
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>('Overview')
  const [loading, setLoading] = useState(true)
  const [selectedSeason, setSelectedSeason] = useState(tournamentId === 'world_cup' ? '2026' : '2025')
  const [runningSimulation, setRunningSimulation] = useState(false)
  const [numSimulations, setNumSimulations] = useState(10000)
  // New: Probability-based simulation results (like LeagueHomePage)
  const [simulationResults, setSimulationResults] = useState<{
    tournament_name: string
    n_simulations: number
    teams: Array<{
      team_name: string
      current_points: number
      win_probability: number
      final_probability: number
      semi_final_probability: number
      quarter_final_probability: number
    }>
    most_likely_winner: string
    winner_probability: number
  } | null>(null)
  const [bracketRounds, setBracketRounds] = useState<BracketRound[]>([])
  const [simulationProbabilities, setSimulationProbabilities] = useState<{
    champion: { team: string; probability: number }[]
    final: { team: string; probability: number }[]
    semi_finals: { team: string; probability: number }[]
    quarter_finals: { team: string; probability: number }[]
  } | null>(null)
  const [data, setData] = useState<TournamentData>({
    groups: [],
    knockoutMatches: [],
    upcomingMatches: [],
    recentResults: [],
    news: [],
  })

  // Get available seasons based on tournament type
  const availableSeasons = tournamentId === 'world_cup' ? WORLD_CUP_SEASONS : TOURNAMENT_SEASONS

  // Minimum number of teams required for tournament simulation
  const MIN_TEAMS_FOR_SIMULATION = 8

  // Run tournament simulation with probability-based output (like LeagueHomePage)
  const runTournamentSimulation = async () => {
    setRunningSimulation(true)
    try {
      // Safely get teams from standings with null checks
      if (!data.groups || data.groups.length === 0) {
        console.error(`Tournament simulation requires group data. Please ensure tournament data is loaded.`)
        setRunningSimulation(false)
        return
      }

      const teams = data.groups.flatMap(g => 
        (g.standings || []).map(s => ({
          team: s.team,
          points: s.points,
          goalDifference: s.goalDifference,
        }))
      ).filter(t => t.team)

      if (teams.length < MIN_TEAMS_FOR_SIMULATION) {
        console.error(`Tournament simulation requires at least ${MIN_TEAMS_FOR_SIMULATION} teams, found ${teams.length}. Please ensure tournament data is loaded.`)
        setRunningSimulation(false)
        return
      }

      // Monte Carlo simulation based on team strength (points + GD)
      const teamResults: Record<string, { wins: number; finals: number; semis: number; quarters: number }> = {}
      teams.forEach(t => {
        teamResults[t.team] = { wins: 0, finals: 0, semis: 0, quarters: 0 }
      })

      // Run simulations
      for (let sim = 0; sim < numSimulations; sim++) {
        // Create tournament bracket simulation
        // Weight teams by their points + goal difference using named constants
        const weightedTeams = teams.map(t => ({
          ...t,
          strength: t.points + (t.goalDifference / GOAL_DIFF_NORMALIZATION) + Math.random() * RANDOM_VARIANCE,
        })).sort((a, b) => b.strength - a.strength)

        // Simulate knockout rounds
        const quarterFinalists = weightedTeams.slice(0, 8)
        quarterFinalists.forEach(t => teamResults[t.team].quarters++)

        // Semi-finals (top 4 based on weighted random)
        const semiFinalists = quarterFinalists
          .map(t => ({ ...t, roundStrength: t.strength + Math.random() * ROUND_VARIANCE }))
          .sort((a, b) => b.roundStrength - a.roundStrength)
          .slice(0, 4)
        semiFinalists.forEach(t => teamResults[t.team].semis++)

        // Finals (top 2)
        const finalists = semiFinalists
          .map(t => ({ ...t, roundStrength: t.strength + Math.random() * ROUND_VARIANCE }))
          .sort((a, b) => b.roundStrength - a.roundStrength)
          .slice(0, 2)
        finalists.forEach(t => teamResults[t.team].finals++)

        // Winner - Use weighted probability based on team strength instead of coin flip
        // Calculate probability based on relative strength of finalists
        const totalStrength = finalists[0].roundStrength + finalists[1].roundStrength
        const team1WinProb = finalists[0].roundStrength / totalStrength
        const winner = Math.random() < team1WinProb ? finalists[0] : finalists[1]
        if (winner) teamResults[winner.team].wins++
      }

      // Calculate probabilities
      const teamProbabilities = Object.entries(teamResults)
        .map(([team_name, results]) => ({
          team_name,
          current_points: teams.find(t => t.team === team_name)?.points || 0,
          win_probability: results.wins / numSimulations,
          final_probability: results.finals / numSimulations,
          semi_final_probability: results.semis / numSimulations,
          quarter_final_probability: results.quarters / numSimulations,
        }))
        .sort((a, b) => b.win_probability - a.win_probability)

      const mostLikelyWinner = teamProbabilities[0]

      setSimulationResults({
        tournament_name: tournamentName,
        n_simulations: numSimulations,
        teams: teamProbabilities,
        most_likely_winner: mostLikelyWinner?.team_name || 'Unknown',
        winner_probability: mostLikelyWinner?.win_probability || 0,
      })
    } catch (error) {
      console.error('Simulation error:', error)
    } finally {
      setRunningSimulation(false)
    }
  }

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const newData: TournamentData = {
          groups: [],
          knockoutMatches: [],
          upcomingMatches: [],
          recentResults: [],
          news: [],
        }

        // Fetch from ESPN APIs for real tournament data
        const espnLeagueId = config.espnId
        
        // Get date range for fetching matches (next 14 days)
        const { dateRange } = getESPNDateRange(14)
        
        // Fetch standings (groups), matches, and news in parallel from ESPN
        const espnResults = await Promise.allSettled([
          fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${espnLeagueId}/standings`),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/scoreboard?dates=${dateRange}`),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/news`),
        ])

        // Process standings/groups from ESPN
        if (espnResults[0].status === 'fulfilled') {
          const standingsRes = espnResults[0] as PromiseFulfilledResult<Response>
          if (standingsRes.value.ok) {
            const standingsData = await standingsRes.value.json()
            const children = standingsData.children || []
            
            // Process groups
            for (const child of children) {
              const groupName = child.name || child.abbreviation || 'Group'
              const entries = child.standings?.entries || []
              
              if (entries.length > 0) {
                const groupTeams: GroupStanding[] = entries.map((entry: any, idx: number) => {
                  const getStatVal = (name: string) => {
                    const stat = entry.stats?.find((s: any) => s.name === name)
                    return parseInt(stat?.value || '0', 10)
                  }
                  return {
                    position: idx + 1,
                    team: entry.team?.displayName || 'Unknown',
                    teamId: entry.team?.id,
                    played: getStatVal('gamesPlayed'),
                    won: getStatVal('wins'),
                    drawn: getStatVal('ties'),
                    lost: getStatVal('losses'),
                    goalsFor: getStatVal('pointsFor'),
                    goalsAgainst: getStatVal('pointsAgainst'),
                    goalDifference: getStatVal('pointDifferential'),
                    points: getStatVal('points'),
                  }
                })
                newData.groups.push({ name: groupName, standings: groupTeams })
              }
            }
          }
        }

        // Process matches from ESPN
        if (espnResults[1].status === 'fulfilled') {
          const matchesRes = espnResults[1] as PromiseFulfilledResult<Response>
          if (matchesRes.value.ok) {
            const matchesData = await matchesRes.value.json()
            const events = matchesData.events || []
            const now = new Date()
            
            for (const event of events) {
              const competition = event.competitions?.[0]
              if (!competition) continue
              
              const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home')
              const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away')
              const matchDate = new Date(event.date)
              const statusType = competition.status?.type?.name || ''
              
              const isFinished = statusType.includes('FINAL') || statusType.includes('FULL_TIME')
              const isLive = statusType.includes('IN_PROGRESS') || statusType.includes('HALFTIME')
              const roundName = event.competitions?.[0]?.type?.text || event.shortName || ''
              const isKnockout = roundName.toLowerCase().includes('final') || 
                                roundName.toLowerCase().includes('round of') ||
                                roundName.toLowerCase().includes('knockout')
              
              const matchObj: Match = {
                id: String(event.id),
                homeTeam: homeTeam?.team?.displayName || 'Home',
                awayTeam: awayTeam?.team?.displayName || 'Away',
                homeScore: isFinished || isLive ? parseInt(homeTeam?.score || '0') : undefined,
                awayScore: isFinished || isLive ? parseInt(awayTeam?.score || '0') : undefined,
                date: matchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                time: matchDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                round: roundName,
                venue: competition.venue?.fullName,
                status: isFinished ? 'finished' : isLive ? 'live' : 'upcoming',
              }
              
              if (isKnockout && isFinished) {
                newData.knockoutMatches.push(matchObj)
                // Also add to recent results so they show on overview
                newData.recentResults.push(matchObj)
              } else if (isFinished) {
                newData.recentResults.push(matchObj)
              } else {
                newData.upcomingMatches.push(matchObj)
              }
            }
            
            // Build bracket rounds from knockout matches
            const roundsMap: Record<string, BracketMatch[]> = {}
            for (const match of newData.knockoutMatches) {
              const round = match.round || 'Unknown'
              if (!roundsMap[round]) {
                roundsMap[round] = []
              }
              roundsMap[round].push({
                id: match.id,
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                homeScore: match.homeScore,
                awayScore: match.awayScore,
                date: match.date,
                time: match.time,
                status: match.status as 'scheduled' | 'live' | 'finished',
                round: round,
                winner: match.homeScore !== undefined && match.awayScore !== undefined
                  ? match.homeScore > match.awayScore ? 'home' 
                  : match.awayScore > match.homeScore ? 'away' 
                  : null
                  : null,
              })
            }
            
            // Convert to bracket rounds array
            const bracketData: BracketRound[] = Object.entries(roundsMap).map(([name, matches]) => ({
              name,
              matches,
            }))
            setBracketRounds(bracketData)
          }
        }

        // Process news from ESPN (tournament-specific)
        if (espnResults[2].status === 'fulfilled') {
          const newsRes = espnResults[2] as PromiseFulfilledResult<Response>
          if (newsRes.value.ok) {
            const newsData = await newsRes.value.json()
            newData.news = (newsData.articles || []).slice(0, 8).map((n: any) => ({
              headline: n.headline || '',
              description: n.description || '',
              link: n.links?.web?.href || '',
              image: n.images?.[0]?.url || '',
              published: n.published || '',
            }))
          }
        }

        setData(newData)
      } catch (error) {
        console.error('Error fetching tournament data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [config.espnId])
  
  // Fetch simulation probabilities for the tournament
  useEffect(() => {
    const fetchSimulation = async () => {
      try {
        const endpoint = tournamentId === 'champions_league' 
          ? '/api/v1/knockout/champions-league/simulate'
          : tournamentId === 'europa_league'
          ? '/api/v1/knockout/europa-league/simulate'
          : '/api/v1/knockout/world-cup/simulate'
        
        const res = await fetch(`${endpoint}?n_simulations=5000`)
        if (res.ok) {
          const simData = await res.json()
          setSimulationProbabilities({
            champion: simData.winnerProbabilities || [],
            final: simData.finalProbabilities || [],
            semi_finals: simData.semiFinalProbabilities || [],
            quarter_finals: simData.quarterFinalProbabilities || [],
          })
        }
      } catch (error) {
        console.error('Error fetching simulation:', error)
      }
    }
    
    fetchSimulation()
  }, [tournamentId])

  const renderGroupsTable = (group: Group) => (
    <div key={group.name} className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className={`bg-gradient-to-r ${config.gradient} px-4 py-2`}>
        <h3 className="text-white font-semibold">{group.name}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-[var(--text-tertiary)]" style={{ borderColor: 'var(--border-color)' }}>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Team</th>
              <th className="px-3 py-2 text-center">P</th>
              <th className="px-3 py-2 text-center">W</th>
              <th className="px-3 py-2 text-center">D</th>
              <th className="px-3 py-2 text-center">L</th>
              <th className="px-3 py-2 text-center">GD</th>
              <th className="px-3 py-2 text-center font-semibold">Pts</th>
              <th className="px-3 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {group.standings.map((team, teamIdx) => {
              // Determine qualification status based on tournament type
              // For UCL/UEL new league format (36 teams in single league):
              // - Positions 1-8 = Direct to Round of 16
              // - Positions 9-24 = R16 Playoff
              // - Positions 25-36 = Eliminated
              // Calculate overall position across all entries for the league table format
              let overallPos = team.position
              // If there are multiple groups, calculate overall position
              if (data.groups.length > 1) {
                const groupIdx = data.groups.findIndex(g => g.name === group.name)
                const teamsPerGroup = group.standings.length
                overallPos = groupIdx * teamsPerGroup + team.position
              }
              
              let statusBadge = null
              let bgClass = ''
              
              if (tournamentId === 'world_cup') {
                // World Cup: Top 2 qualify, 3rd has possible qualification
                if (team.position <= 2) {
                  statusBadge = <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded whitespace-nowrap font-medium">Qualified</span>
                  bgClass = 'bg-green-500/20 border-l-4 border-l-green-400'
                } else if (team.position === 3) {
                  statusBadge = <span className="text-xs bg-amber-600 text-white px-2 py-0.5 rounded whitespace-nowrap font-medium">Possible</span>
                  bgClass = 'bg-amber-500/20 border-l-4 border-l-amber-400'
                }
              } else {
                // Champions League / Europa League: New league format
                // Top 8 overall = Direct R16, 9-24 = R16 Playoff, 25+ = Eliminated
                if (overallPos <= 8) {
                  statusBadge = <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded whitespace-nowrap font-medium">R16</span>
                  bgClass = 'bg-green-500/20 border-l-4 border-l-green-400'
                } else if (overallPos <= 24) {
                  statusBadge = <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded whitespace-nowrap font-medium">R16 Playoff</span>
                  bgClass = 'bg-blue-500/20 border-l-4 border-l-blue-400'
                } else {
                  statusBadge = <span className="text-xs bg-red-500/80 text-white px-2 py-0.5 rounded whitespace-nowrap font-medium">Eliminated</span>
                  bgClass = 'bg-red-500/10 border-l-4 border-l-red-400'
                }
              }
              
              return (
                <tr 
                  key={team.team}
                  className={`border-b hover:bg-[var(--muted-bg)] transition-colors ${bgClass}`}
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <td className="px-3 py-2 text-[var(--text-tertiary)]">{team.position}</td>
                  <td className="px-3 py-2 text-[var(--text-primary)] font-medium">
                    {team.teamId ? (
                      <Link href={`/teams/${team.teamId}`} className="hover:text-[var(--accent-primary)]">
                        {team.team}
                      </Link>
                    ) : team.team}
                  </td>
                  <td className="px-3 py-2 text-center text-[var(--text-secondary)]">{team.played}</td>
                  <td className="px-3 py-2 text-center text-[var(--text-secondary)]">{team.won}</td>
                  <td className="px-3 py-2 text-center text-[var(--text-secondary)]">{team.drawn}</td>
                  <td className="px-3 py-2 text-center text-[var(--text-secondary)]">{team.lost}</td>
                  <td className="px-3 py-2 text-center text-[var(--text-secondary)]">
                    {team.goalDifference > 0 ? '+' : ''}{team.goalDifference}
                  </td>
                  <td className="px-3 py-2 text-center font-semibold text-[var(--text-primary)]">{team.points}</td>
                  <td className="px-3 py-2 text-center">{statusBadge}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-xs text-[var(--text-tertiary)] border-t flex flex-wrap gap-3" style={{ borderColor: 'var(--border-color)' }}>
        {tournamentId === 'world_cup' ? (
          <>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-green-400 mr-1"></span> Qualified for knockout</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-amber-400 mr-1"></span> Possible qualification</span>
          </>
        ) : (
          <>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-green-400 mr-1"></span> Round of 16 (Top 8)</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-blue-400 mr-1"></span> R16 Playoff (9-24)</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-red-400 mr-1"></span> Eliminated (25+)</span>
          </>
        )}
      </div>
    </div>
  )

  const renderMatchCard = (match: Match, showResult = false) => (
    <Link
      key={match.id}
      href={`/matches/${match.id}`}
      className="block p-4 rounded-xl bg-[var(--muted-bg)] hover:bg-[var(--muted-bg-hover)] transition-colors animate-fadeIn"
    >
      <div className="flex justify-between items-center">
        <div className="flex-1">
          <p className="font-medium text-[var(--text-primary)]">{match.homeTeam}</p>
          <p className="font-medium text-[var(--text-primary)]">{match.awayTeam}</p>
        </div>
        {showResult && match.homeScore !== undefined ? (
          <div className="text-right">
            <p className={`font-bold ${match.homeScore > (match.awayScore || 0) ? 'text-green-500' : 'text-[var(--text-primary)]'}`}>
              {match.homeScore}
            </p>
            <p className={`font-bold ${(match.awayScore || 0) > match.homeScore ? 'text-green-500' : 'text-[var(--text-primary)]'}`}>
              {match.awayScore}
            </p>
          </div>
        ) : (
          <div className="text-right">
            <p className="text-sm text-[var(--text-tertiary)]">{match.date}</p>
            <p className="text-sm text-[var(--text-secondary)]">{match.time}</p>
          </div>
        )}
      </div>
      {match.round && (
        <p className="text-xs text-[var(--text-tertiary)] mt-2">{match.round}</p>
      )}
      {match.status === 'live' && (
        <span className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-500 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
          LIVE
        </span>
      )}
    </Link>
  )

  const renderOverview = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Column - Upcoming Matches */}
      <div className="lg:col-span-2 space-y-6">
        {/* Upcoming Matches */}
        <div className="bg-[var(--card-bg)] rounded-xl border p-6" style={{ borderColor: 'var(--border-color)' }}>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Upcoming Matches</h2>
          {data.upcomingMatches.length > 0 ? (
            <div className="space-y-3">
              {data.upcomingMatches.slice(0, 5).map(match => renderMatchCard(match))}
            </div>
          ) : (
            <p className="text-[var(--text-tertiary)]">No upcoming matches</p>
          )}
        </div>

        {/* Recent Results */}
        <div className="bg-[var(--card-bg)] rounded-xl border p-6" style={{ borderColor: 'var(--border-color)' }}>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Recent Results</h2>
          {data.recentResults.length > 0 ? (
            <div className="space-y-3">
              {data.recentResults.slice(0, 5).map(match => renderMatchCard(match, true))}
            </div>
          ) : (
            <p className="text-[var(--text-tertiary)]">No recent results</p>
          )}
        </div>
      </div>

      {/* Right Column - Groups Preview & News */}
      <div className="space-y-6">
        {/* Groups Preview */}
        {data.groups.length > 0 && (
          <div className="bg-[var(--card-bg)] rounded-xl border p-6" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Group Standings</h2>
              <button
                onClick={() => setActiveTab('Groups')}
                className="text-sm text-[var(--accent-primary)] hover:underline"
              >
                View All
              </button>
            </div>
            <div className="space-y-2">
              {data.groups.slice(0, 4).map(group => (
                <div key={group.name} className="p-3 rounded-lg bg-[var(--muted-bg)]">
                  <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{group.name}</p>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {group.standings.slice(0, 2).map((t, i) => (
                      <span key={t.team}>
                        {i > 0 && ' • '}{t.team} ({t.points}pts)
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Latest News */}
        {data.news.length > 0 && (
          <div className="bg-[var(--card-bg)] rounded-xl border p-6" style={{ borderColor: 'var(--border-color)' }}>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Latest News</h2>
            <div className="space-y-4">
              {data.news.slice(0, 3).map((item, idx) => (
                <a
                  key={idx}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block group"
                >
                  {item.image && (
                    <img
                      src={item.image}
                      alt={item.headline}
                      className="w-full h-32 object-cover rounded-lg mb-2"
                    />
                  )}
                  <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] line-clamp-2">
                    {item.headline}
                  </p>
                  {item.published && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">
                      {formatDistanceToNow(new Date(item.published), { addSuffix: true })}
                    </p>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Quick Simulator Link */}
        <div
          className={`bg-gradient-to-r ${config.gradient} rounded-xl p-6 text-white cursor-pointer hover:opacity-90 transition-opacity`}
          onClick={() => setActiveTab('Simulator')}
        >
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎲</span>
            <div>
              <h3 className="font-semibold">Run Simulation</h3>
              <p className="text-sm text-white/80">Predict the tournament winner</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderKnockoutBracket = () => (
    <div className="space-y-6">
      {/* Main Bracket Visualization - Always show */}
      <KnockoutBracket
        tournament={config.knockoutType}
        rounds={bracketRounds}
        simulationData={simulationProbabilities || undefined}
        showProbabilities={!!simulationProbabilities}
        onMatchClick={(match) => {
          // Navigate to match page using Next.js router for client-side navigation
          router.push(`/matches/${match.id}`)
        }}
      />
      
      {/* Detailed Match List */}
      {data.knockoutMatches.length > 0 && (
        <div className="bg-[var(--card-bg)] rounded-xl border p-6" style={{ borderColor: 'var(--border-color)' }}>
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-6">Knockout Matches</h2>
          
          <div className="space-y-8">
            {/* Group knockout matches by round */}
            {['Final', 'Semi-Final', 'Quarter-Final', 'Round of 16'].map(round => {
              const roundMatches = data.knockoutMatches.filter(m => 
                m.round?.toLowerCase().includes(round.toLowerCase())
              )
              if (roundMatches.length === 0) return null

              return (
                <div key={round}>
                  <h3 className={`text-lg font-semibold text-[var(--text-primary)] mb-4 pb-2 border-b`} style={{ borderColor: 'var(--border-color)' }}>
                    {round}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {roundMatches.map(match => (
                      <Link
                        key={match.id}
                        href={`/matches/${match.id}`}
                        className="p-4 rounded-xl bg-[var(--muted-bg)] hover:bg-[var(--muted-bg-hover)] transition-colors"
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <div className={`flex items-center gap-2 ${match.homeScore !== undefined && match.homeScore > (match.awayScore || 0) ? 'font-bold' : ''}`}>
                              <span className="text-[var(--text-primary)]">{match.homeTeam}</span>
                              {match.homeScore !== undefined && (
                                <span className="font-bold text-[var(--text-primary)]">{match.homeScore}</span>
                              )}
                            </div>
                            <div className={`flex items-center gap-2 ${match.awayScore !== undefined && match.awayScore > (match.homeScore || 0) ? 'font-bold' : ''}`}>
                              <span className="text-[var(--text-primary)]">{match.awayTeam}</span>
                              {match.awayScore !== undefined && (
                                <span className="font-bold text-[var(--text-primary)]">{match.awayScore}</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right text-sm text-[var(--text-tertiary)]">
                            {match.date}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Back Button */}
      <Link
        href="/matches"
        className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-4 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Leagues
      </Link>
      
      {/* Header */}
      <div className={`bg-gradient-to-r ${config.gradient} rounded-2xl p-8 mb-6`}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            {config.logo ? (
              <img 
                src={config.logo} 
                alt={tournamentName}
                className="w-16 h-16 object-contain bg-white rounded-xl p-1"
              />
            ) : (
              <span className="text-5xl">{config.emoji}</span>
            )}
            <div>
              <h1 className="text-3xl font-bold text-white">{tournamentName}</h1>
              <p className="text-white/80">
                {tournamentId === 'world_cup' ? 'International Tournament' : 'European Club Competition'} • {availableSeasons.find(s => s.value === selectedSeason)?.label || '2025-26'}
              </p>
            </div>
          </div>
          
          {/* Season Selector & Simulation Button */}
          <div className="flex items-center gap-3">
            <select
              value={selectedSeason}
              onChange={(e) => setSelectedSeason(e.target.value)}
              className="px-4 py-2 rounded-lg bg-white/20 text-white border border-white/30 backdrop-blur-sm cursor-pointer hover:bg-white/30 transition-colors"
            >
              {availableSeasons.map(season => (
                <option key={season.value} value={season.value} className="text-gray-900">
                  {season.label}
                </option>
              ))}
            </select>
            
            <button
              onClick={runTournamentSimulation}
              disabled={runningSimulation || data.groups.length === 0}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black font-semibold transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {runningSimulation ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Simulating...
                </>
              ) : (
                <>
                  🎲 Run Simulation
                </>
              )}
            </button>
          </div>
        </div>
        
        {/* Simulation Results - Updated to show probability-based output */}
        {simulationResults && (
          <div className="mt-4 p-4 bg-white/10 backdrop-blur-sm rounded-xl border border-white/20">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-amber-300 text-sm font-medium">🏆 Monte Carlo Simulation ({simulationResults.n_simulations.toLocaleString()} runs)</p>
                <p className="text-white font-bold text-lg">{simulationResults.most_likely_winner} to win the tournament</p>
                <p className="text-white/70 text-sm mt-1">
                  Top contenders: {simulationResults.teams.slice(0, 3).map(t => `${t.team_name} (${(t.win_probability * 100).toFixed(1)}%)`).join(', ')}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-amber-400">
                  {(simulationResults.winner_probability * 100).toFixed(1)}%
                </p>
                <p className="text-white/60 text-xs">win probability</p>
              </div>
            </div>
          </div>
        )}
        
        {/* Quick Stats - Match LeagueHomePage styling */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {/* Group Leader */}
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <p className="text-white/70 text-sm">Group Leader</p>
            <p className="text-white font-bold text-lg">
              {data.groups[0]?.standings[0]?.team || 'TBD'}
            </p>
            <p className="text-white/80 text-sm">
              {data.groups[0]?.standings[0]?.points || 0} points
            </p>
          </div>
          
          {/* Teams Qualified */}
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <p className="text-white/70 text-sm">Teams</p>
            <p className="text-white font-bold text-lg">
              {data.groups.flatMap(g => g.standings).length || 0}
            </p>
            <p className="text-white/80 text-sm">participating</p>
          </div>
          
          {/* Recent Matches */}
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <p className="text-white/70 text-sm">Recent Results</p>
            <p className="text-white font-bold text-lg">{data.recentResults.length || 0}</p>
            <p className="text-white/80 text-sm">matches played</p>
          </div>
          
          {/* Upcoming Matches */}
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
            <p className="text-white/70 text-sm">Coming Up</p>
            <p className="text-white font-bold text-lg">{data.upcomingMatches.length || 0}</p>
            <p className="text-white/80 text-sm">fixtures scheduled</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? `bg-gradient-to-r ${config.gradient} text-white`
                  : 'bg-[var(--muted-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Loading State */}
      {loading && activeTab !== 'Simulator' ? (
        <div className="flex items-center justify-center py-20">
          <svg className="animate-spin h-8 w-8 text-[var(--accent-primary)]" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : (
        <>
          {/* Tab Content */}
          {activeTab === 'Overview' && renderOverview()}
          
          {activeTab === 'Groups' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.groups.length > 0 ? (
                data.groups.map(group => renderGroupsTable(group))
              ) : (
                <div className="col-span-2 text-center py-12">
                  <p className="text-[var(--text-tertiary)]">Group stage data not available</p>
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'Knockout' && renderKnockoutBracket()}
          
          {activeTab === 'Fixtures' && (
            <MatchCalendar leagueId={config.espnId} leagueName={tournamentName} />
          )}
          
          {activeTab === 'Simulator' && (
            <div className="space-y-6">
              {/* Simulation Instructions/Status - without duplicate Run button */}
              {!simulationResults && (
                <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] p-6">
                  <div className="text-center py-8">
                    <h3 className="text-xl font-bold text-[var(--text-primary)] flex items-center justify-center gap-2 mb-4">
                      <span>🎲</span>
                      Tournament Simulation
                    </h3>
                    {data.groups.length === 0 ? (
                      <>
                        <p className="text-[var(--text-tertiary)]">Tournament data is loading...</p>
                        <p className="text-sm text-[var(--text-tertiary)] mt-1">Simulation will be available once team data is loaded</p>
                      </>
                    ) : (
                      <>
                        <p className="text-[var(--text-secondary)]">Click "Run Simulation" in the header to predict the tournament winner</p>
                        <p className="text-sm text-[var(--text-tertiary)] mt-1">
                          Based on {data.groups.flatMap(g => g.standings).length} teams from the group stage
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Simulation Results - Full probability table like LeagueHomePage */}
              {simulationResults && (
                <div className="space-y-6 animate-fade-in">
                  {/* Summary Card */}
                  <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
                    <div className={`p-6 bg-gradient-to-r ${config.gradient}/20 border-b border-[var(--border-color)]`}>
                      <div className="flex items-center justify-between flex-wrap gap-4">
                        <div>
                          <h3 className="text-2xl font-bold text-[var(--text-primary)]">{simulationResults.tournament_name}</h3>
                          <p className="text-[var(--text-secondary)]">
                            {simulationResults.n_simulations.toLocaleString()} simulations completed
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-[var(--text-secondary)]">Most Likely Winner</p>
                          <p className="text-xl font-bold text-amber-400">{simulationResults.most_likely_winner}</p>
                          <p className="text-sm text-amber-400/80">{(simulationResults.winner_probability * 100).toFixed(1)}% probability</p>
                        </div>
                      </div>
                    </div>

                    {/* Key Insights */}
                    <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                        <p className="text-sm text-[var(--text-secondary)] mb-2">🏆 Title Contenders</p>
                        <div className="space-y-1">
                          {simulationResults.teams
                            .filter(t => t.win_probability > 0.01)
                            .slice(0, 4)
                            .map((team) => (
                              <div key={team.team_name} className="flex justify-between text-sm">
                                <span className="text-[var(--text-primary)]">{team.team_name}</span>
                                <span className="text-amber-400">{(team.win_probability * 100).toFixed(1)}%</span>
                              </div>
                            ))}
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                        <p className="text-sm text-[var(--text-secondary)] mb-2">🥈 Finalists</p>
                        <div className="space-y-1">
                          {simulationResults.teams
                            .sort((a, b) => b.final_probability - a.final_probability)
                            .slice(0, 4)
                            .map((team) => (
                              <div key={team.team_name} className="flex justify-between text-sm">
                                <span className="text-[var(--text-primary)]">{team.team_name}</span>
                                <span className="text-blue-400">{(team.final_probability * 100).toFixed(0)}%</span>
                              </div>
                            ))}
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                        <p className="text-sm text-[var(--text-secondary)] mb-2">🥉 Semi-Finalists</p>
                        <div className="space-y-1">
                          {simulationResults.teams
                            .sort((a, b) => b.semi_final_probability - a.semi_final_probability)
                            .slice(0, 4)
                            .map((team) => (
                              <div key={team.team_name} className="flex justify-between text-sm">
                                <span className="text-[var(--text-primary)]">{team.team_name}</span>
                                <span className="text-emerald-400">{(team.semi_final_probability * 100).toFixed(0)}%</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Full Standings Table */}
                  <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
                    <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
                      <h3 className="font-semibold text-[var(--text-primary)]">Team Probabilities</h3>
                      <span className="text-sm text-[var(--text-secondary)]">
                        📊 {simulationResults.teams.length} teams analyzed
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="text-xs text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
                            <th className="text-left py-3 px-4">Rank</th>
                            <th className="text-left py-3 px-4">Team</th>
                            <th className="text-center py-3 px-4">Current Pts</th>
                            <th className="text-center py-3 px-4">Win %</th>
                            <th className="text-center py-3 px-4">Final %</th>
                            <th className="text-center py-3 px-4">Semi %</th>
                            <th className="text-center py-3 px-4">Quarter %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {simulationResults.teams.map((team, idx) => (
                            <tr
                              key={team.team_name}
                              className={`border-b border-[var(--border-color)] hover:bg-[var(--background-secondary)] transition-colors ${
                                idx < 1 ? 'border-l-2 border-l-amber-500' : 
                                idx < 4 ? 'border-l-2 border-l-emerald-500' : ''
                              }`}
                            >
                              <td className="py-3 px-4 text-[var(--text-secondary)]">{idx + 1}</td>
                              <td className="py-3 px-4 text-[var(--text-primary)] font-medium">{team.team_name}</td>
                              <td className="py-3 px-4 text-center text-[var(--text-secondary)]">{team.current_points}</td>
                              <td className="py-3 px-4 text-center">
                                {team.win_probability > 0.001 ? (
                                  <span className="text-amber-400 font-semibold">{(team.win_probability * 100).toFixed(1)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.final_probability > 0.01 ? (
                                  <span className="text-blue-400">{(team.final_probability * 100).toFixed(0)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.semi_final_probability > 0.01 ? (
                                  <span className="text-emerald-400">{(team.semi_final_probability * 100).toFixed(0)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.quarter_final_probability > 0.01 ? (
                                  <span className="text-purple-400">{(team.quarter_final_probability * 100).toFixed(0)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Legend */}
                    <div className="p-4 flex gap-6 text-xs text-[var(--text-tertiary)] border-t border-[var(--border-color)]">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-amber-500 rounded" />
                        <span>Winner</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-emerald-500 rounded" />
                        <span>Top Contenders</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Also show the advanced knockout simulator */}
              <div className="border-t pt-6" style={{ borderColor: 'var(--border-color)' }}>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Advanced Knockout Simulator</h3>
                <KnockoutSimulator tournament={config.knockoutType} />
              </div>
            </div>
          )}
          
          {activeTab === 'News' && (
            <div className="bg-[var(--card-bg)] rounded-xl border p-6" style={{ borderColor: 'var(--border-color)' }}>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mb-6">Latest News</h2>
              {data.news.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {data.news.map((item, idx) => (
                    <a
                      key={idx}
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block group bg-[var(--muted-bg)] rounded-xl overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:border hover:border-[var(--accent-primary)]"
                    >
                      {item.image && (
                        <div className="overflow-hidden">
                          <img
                            src={item.image}
                            alt={item.headline}
                            className="w-full h-40 object-cover group-hover:scale-110 transition-transform duration-300"
                          />
                        </div>
                      )}
                      <div className="p-4">
                        <p className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] line-clamp-2">
                          {item.headline}
                        </p>
                        <p className="text-sm text-[var(--text-tertiary)] mt-2 line-clamp-2">
                          {item.description}
                        </p>
                        {item.published && (
                          <p className="text-xs text-[var(--text-tertiary)] mt-2">
                            {formatDistanceToNow(new Date(item.published), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--text-tertiary)]">No news available</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
