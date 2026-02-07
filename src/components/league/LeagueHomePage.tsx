'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import MatchCalendar from '@/components/match/MatchCalendar'
import { getESPNDateRange } from '@/lib/api'

interface Standing {
  position: number
  teamName: string
  teamId?: number
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  points: number
  form?: string[]
}

interface TopScorer {
  rank: number
  name: string
  team: string
  goals: number
  assists: number
  matches: number
}

interface UpcomingMatch {
  id: string
  homeTeam: string
  awayTeam: string
  date: string
  time: string
  venue?: string
}

interface RecentMatch {
  id: string
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  date: string
}

interface NewsItem {
  headline: string
  description: string
  link?: string
  image?: string
  published: string
}

interface LeagueHomeData {
  leagueId: number
  leagueName: string
  country: string
  season: string
  standings: Standing[]
  topScorers: TopScorer[]
  upcomingMatches: UpcomingMatch[]
  recentResults: RecentMatch[]
  news: NewsItem[]
  simulation?: {
    mostLikelyChampion: string
    championProbability: number
    topFourTeams: string[]
  }
}

interface LeagueHomePageProps {
  leagueId: string
  leagueName: string
  country: string
}

// Official league logo URLs (similar to FotMob style)
const LEAGUE_LOGOS: Record<string, string> = {
  'premier_league': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/23.png',
  'la_liga': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/15.png',
  'bundesliga': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/10.png',
  'serie_a': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/12.png',
  'ligue_1': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/9.png',
  'mls': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/19.png',
  'eredivisie': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/11.png',
  'primeira_liga': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/14.png',
  // ESPN-style IDs
  'eng.1': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/23.png',
  'esp.1': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/15.png',
  'ger.1': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/10.png',
  'ita.1': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/12.png',
  'fra.1': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/9.png',
  'usa.1': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/19.png',
  'ned.1': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/11.png',
  'por.1': 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/14.png',
}

// Available seasons for dropdown
const AVAILABLE_SEASONS = [
  { value: '2025', label: '2025-26' },
  { value: '2024', label: '2024-25' },
  { value: '2023', label: '2023-24' },
  { value: '2022', label: '2022-23' },
  { value: '2021', label: '2021-22' },
]

const LEAGUE_CONFIGS: Record<string, { color: string; gradient: string; flag: string }> = {
  // Main leagues
  'premier_league': { color: '#3D195B', gradient: 'from-purple-900 to-purple-700', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  'la_liga': { color: '#EE8707', gradient: 'from-orange-600 to-red-600', flag: '🇪🇸' },
  'bundesliga': { color: '#D20515', gradient: 'from-red-700 to-red-500', flag: '🇩🇪' },
  'serie_a': { color: '#008FD7', gradient: 'from-blue-700 to-blue-500', flag: '🇮🇹' },
  'ligue_1': { color: '#091C3E', gradient: 'from-blue-900 to-blue-700', flag: '🇫🇷' },
  'champions_league': { color: '#1A428A', gradient: 'from-blue-800 to-indigo-600', flag: '🇪🇺' },
  'europa_league': { color: '#F26F21', gradient: 'from-orange-500 to-amber-500', flag: '🇪🇺' },
  'conference_league': { color: '#19A974', gradient: 'from-green-600 to-teal-500', flag: '🇪🇺' },
  'mls': { color: '#00245D', gradient: 'from-blue-900 to-red-600', flag: '🇺🇸' },
  'world_cup': { color: '#56042C', gradient: 'from-purple-900 to-red-800', flag: '🌍' },
  // Additional leagues
  'eredivisie': { color: '#E70012', gradient: 'from-orange-500 to-red-600', flag: '🇳🇱' },
  'primeira_liga': { color: '#004D25', gradient: 'from-green-800 to-green-600', flag: '🇵🇹' },
  'scottish_premiership': { color: '#003087', gradient: 'from-blue-800 to-blue-600', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  'belgian_pro_league': { color: '#000000', gradient: 'from-yellow-500 to-red-600', flag: '🇧🇪' },
  'super_lig': { color: '#E30A17', gradient: 'from-red-700 to-red-500', flag: '🇹🇷' },
  'brasileirao': { color: '#009739', gradient: 'from-green-600 to-yellow-500', flag: '🇧🇷' },
  'liga_mx': { color: '#006847', gradient: 'from-green-700 to-red-600', flag: '🇲🇽' },
  // ESPN-style IDs
  'eng.1': { color: '#3D195B', gradient: 'from-purple-900 to-purple-700', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  'esp.1': { color: '#EE8707', gradient: 'from-orange-600 to-red-600', flag: '🇪🇸' },
  'ger.1': { color: '#D20515', gradient: 'from-red-700 to-red-500', flag: '🇩🇪' },
  'ita.1': { color: '#008FD7', gradient: 'from-blue-700 to-blue-500', flag: '🇮🇹' },
  'fra.1': { color: '#091C3E', gradient: 'from-blue-900 to-blue-700', flag: '🇫🇷' },
  'ned.1': { color: '#E70012', gradient: 'from-orange-500 to-red-600', flag: '🇳🇱' },
  'por.1': { color: '#004D25', gradient: 'from-green-800 to-green-600', flag: '🇵🇹' },
  'usa.1': { color: '#00245D', gradient: 'from-blue-900 to-red-600', flag: '🇺🇸' },
  // FotMob numeric IDs
  '47': { color: '#3D195B', gradient: 'from-purple-900 to-purple-700', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  '87': { color: '#EE8707', gradient: 'from-orange-600 to-red-600', flag: '🇪🇸' },
  '54': { color: '#D20515', gradient: 'from-red-700 to-red-500', flag: '🇩🇪' },
  '55': { color: '#008FD7', gradient: 'from-blue-700 to-blue-500', flag: '🇮🇹' },
  '53': { color: '#091C3E', gradient: 'from-blue-900 to-blue-700', flag: '🇫🇷' },
}

// Simulation count options (like in Predict tab)
const SIMULATION_OPTIONS = [1000, 5000, 10000, 25000, 50000]

// Table column counts for colSpan calculations
const MLS_CONFERENCE_TABLE_COLUMNS = 5  // #, Team, P, Pts, Form

// League ID to numeric ID mapping (shared across component)
const LEAGUE_NUMERIC_ID_MAP: Record<string, number> = {
  'eng.1': 47, 'premier_league': 47,
  'esp.1': 87, 'la_liga': 87,
  'ger.1': 54, 'bundesliga': 54,
  'ita.1': 55, 'serie_a': 55,
  'fra.1': 53, 'ligue_1': 53,
  'usa.1': 29, 'mls': 29,
}

// Tab label mapping for display
const TAB_LABELS: Record<string, string> = {
  'scorers': 'Top Scorers',
  'simulator': 'Simulator',
}

// MLS Conference configuration - Updated with ESPN team names for accurate matching
// ESPN typically uses full official team names like "LA Galaxy", "Inter Miami CF", etc.
const MLS_CONFERENCES = {
  eastern: [
    // Full ESPN names
    'Inter Miami CF', 'Inter Miami', 'Miami',
    'FC Cincinnati', 'Cincinnati',
    'Columbus Crew', 'Columbus',
    'Orlando City SC', 'Orlando City', 'Orlando',
    'Charlotte FC', 'Charlotte',
    'New York Red Bulls', 'Red Bulls', 'NY Red Bulls',
    'New York City FC', 'NYCFC', 'NYC FC',
    'Philadelphia Union', 'Philadelphia',
    'Atlanta United FC', 'Atlanta United', 'Atlanta',
    'D.C. United', 'DC United', 'D.C.',
    'Chicago Fire FC', 'Chicago Fire', 'Chicago',
    'CF Montréal', 'CF Montreal', 'Montreal',
    'New England Revolution', 'New England',
    'Nashville SC', 'Nashville',
    'Toronto FC', 'Toronto',
  ],
  western: [
    // Full ESPN names
    'Los Angeles FC', 'LAFC', 'LA FC',
    'LA Galaxy', 'Los Angeles Galaxy', 'Galaxy',
    'Seattle Sounders FC', 'Seattle Sounders', 'Seattle',
    'Houston Dynamo FC', 'Houston Dynamo', 'Houston',
    'Real Salt Lake', 'RSL', 'Salt Lake',
    'Minnesota United FC', 'Minnesota United', 'Minnesota',
    'Colorado Rapids', 'Colorado',
    'Portland Timbers', 'Portland',
    'Vancouver Whitecaps FC', 'Vancouver Whitecaps', 'Vancouver',
    'St. Louis City SC', 'St. Louis City', 'St. Louis', 'Saint Louis',
    'Austin FC', 'Austin',
    'Sporting Kansas City', 'Sporting KC', 'Kansas City',
    'FC Dallas', 'Dallas',
    'San Jose Earthquakes', 'San Jose',
    'San Diego FC', 'San Diego', // 2025 expansion team
  ],
}

// Pre-compute lowercased conference team names for efficient matching
const MLS_EASTERN_LOWER = MLS_CONFERENCES.eastern.map(t => t.toLowerCase())
const MLS_WESTERN_LOWER = MLS_CONFERENCES.western.map(t => t.toLowerCase())

// Helper function for more accurate MLS conference matching
const isInConference = (teamName: string, conferenceTeams: string[]): boolean => {
  const teamLower = teamName.toLowerCase().trim()
  
  // Check if any conference team name matches
  for (const confTeam of conferenceTeams) {
    const confLower = confTeam.toLowerCase()
    // Exact match
    if (teamLower === confLower) return true
    // Team contains conference entry
    if (teamLower.includes(confLower)) return true
    // Conference entry contains team
    if (confLower.includes(teamLower) && teamLower.length > 3) return true
  }
  return false
}

export default function LeagueHomePage({ leagueId, leagueName, country }: LeagueHomePageProps) {
  const [data, setData] = useState<LeagueHomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'standings' | 'scorers' | 'fixtures' | 'simulator' | 'news'>('overview')
  const [selectedSeason, setSelectedSeason] = useState('2025')
  const [runningSimulation, setRunningSimulation] = useState(false)
  const [numSimulations, setNumSimulations] = useState(10000)
  const [simulationResults, setSimulationResults] = useState<{
    league_name: string
    n_simulations: number
    remaining_matches: number
    most_likely_champion: string
    champion_probability: number
    likely_top_4: string[]
    relegation_candidates: string[]
    standings: Array<{
      team_name: string
      current_points: number
      avg_final_points: number
      title_probability: number
      top_4_probability: number
      relegation_probability: number
    }>
  } | null>(null)

  // Check if this is MLS to show conferences
  const isMLS = leagueId === 'usa.1' || leagueId === 'mls'

  const config = LEAGUE_CONFIGS[leagueId] || LEAGUE_CONFIGS['premier_league']
  const leagueLogo = LEAGUE_LOGOS[leagueId]

  // Helper to get ESPN league ID
  // League ID mapping for cleaner code
  const LEAGUE_ID_MAPPING: Record<string, string> = {
    'eng': 'premier_league',
    'esp': 'la_liga',
    'ger': 'bundesliga',
    'ita': 'serie_a',
    'fra': 'ligue_1',
    'usa': 'mls',
  }
  
  const LEAGUE_TO_ESPN_ID: Record<string, string> = {
    'premier_league': 'eng.1',
    'la_liga': 'esp.1',
    'bundesliga': 'ger.1',
    'serie_a': 'ita.1',
    'ligue_1': 'fra.1',
    'mls': 'usa.1',
  }

  const getEspnLeagueId = () => {
    // If already an ESPN-style ID (e.g., 'eng.1'), return it
    if (leagueId.includes('.')) {
      return leagueId
    }
    
    // Convert from short form (e.g., 'eng') to internal name
    const prefix = leagueId.split('.')[0]
    const leagueParam = LEAGUE_ID_MAPPING[prefix] || leagueId
    
    // Return ESPN ID
    return LEAGUE_TO_ESPN_ID[leagueParam] || leagueId
  }

  // Run end of season simulation - stores full data like SeasonSimulator
  const runSeasonSimulation = async () => {
    setRunningSimulation(true)
    try {
      const numericLeagueId = LEAGUE_NUMERIC_ID_MAP[leagueId] || 47
      
      const res = await fetch(`/api/simulation/${numericLeagueId}?n_simulations=${numSimulations}`)
      if (res.ok) {
        const simData = await res.json()
        // Store full simulation result like SeasonSimulator does
        setSimulationResults({
          league_name: simData.league_name || leagueName,
          n_simulations: simData.n_simulations || numSimulations,
          remaining_matches: simData.remaining_matches || 0,
          most_likely_champion: simData.most_likely_champion || simData.standings?.[0]?.team_name || 'Unknown',
          champion_probability: simData.champion_probability || simData.standings?.[0]?.title_probability || 0,
          likely_top_4: simData.likely_top_4 || simData.standings?.slice(0, 4).map((s: any) => s.team_name) || [],
          relegation_candidates: simData.relegation_candidates || simData.standings?.slice(-3).map((s: any) => s.team_name) || [],
          standings: (simData.standings || []).map((s: any) => ({
            team_name: s.team_name || s.team || 'Unknown',
            current_points: s.current_points || 0,
            avg_final_points: s.avg_final_points || s.predicted_points || 0,
            title_probability: s.title_probability || 0,
            top_4_probability: s.top_4_probability || 0,
            relegation_probability: s.relegation_probability || 0,
          })),
        })
      }
    } catch (error) {
      console.error('Simulation error:', error)
    } finally {
      setRunningSimulation(false)
    }
  }

  useEffect(() => {
    const fetchLeagueData = async () => {
      setLoading(true)
      try {
        // Convert ESPN-style league ID to internal format
        const leagueParam = leagueId.includes('.') 
          ? leagueId.split('.')[0] === 'eng' ? 'premier_league'
            : leagueId.split('.')[0] === 'esp' ? 'la_liga'
            : leagueId.split('.')[0] === 'ger' ? 'bundesliga'
            : leagueId.split('.')[0] === 'ita' ? 'serie_a'
            : leagueId.split('.')[0] === 'fra' ? 'ligue_1'
            : leagueId.split('.')[0] === 'usa' ? 'mls'
            : leagueId
          : leagueId
        
        // Fetch data from existing endpoints in parallel
        const [standingsRes, fixturesRes, newsRes] = await Promise.allSettled([
          fetch(`/api/standings?league=${leagueParam}`),
          fetch(`/api/upcoming_matches?league=${leagueParam}&limit=10`),
          fetch(`/api/news?league=${leagueParam}`),
        ])
        
        // Also fetch from ESPN for real-time data including top scorers
        const espnLeagueId = getEspnLeagueId()
        
        // Get date range for fetching matches (next 14 days)
        const { dateRange } = getESPNDateRange(14)

        const espnResults = await Promise.allSettled([
          fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${espnLeagueId}/standings`),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/scoreboard?dates=${dateRange}`),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/leaders`),
        ])

        const leagueData: LeagueHomeData = {
          leagueId: parseInt(leagueId) || 0,
          leagueName,
          country,
          season: AVAILABLE_SEASONS.find(s => s.value === selectedSeason)?.label || '2025-26',
          standings: [],
          topScorers: [],
          upcomingMatches: [],
          recentResults: [],
          news: [],
        }

        // PRIORITIZE ESPN data for accurate real-time standings
        // ESPN provides the most up-to-date standings data
        let espnStandingsLoaded = false
        if (espnResults[0].status === 'fulfilled') {
          const espnStandings = espnResults[0] as PromiseFulfilledResult<Response>
          if (espnStandings.value.ok) {
            const espnData = await espnStandings.value.json()
            const entries = espnData.children?.[0]?.standings?.entries || []
            if (entries.length > 0) {
              leagueData.standings = entries.map((entry: any, idx: number) => {
                const getStatVal = (name: string) => {
                  const stat = entry.stats?.find((s: any) => s.name === name)
                  return parseInt(stat?.value || '0', 10)
                }
                return {
                  position: idx + 1,
                  teamName: entry.team?.displayName || 'Unknown',
                  teamId: entry.team?.id,
                  played: getStatVal('gamesPlayed'),
                  won: getStatVal('wins'),
                  drawn: getStatVal('ties'),
                  lost: getStatVal('losses'),
                  goalsFor: getStatVal('pointsFor'),
                  goalsAgainst: getStatVal('pointsAgainst'),
                  goalDiff: getStatVal('pointDifferential'),
                  points: getStatVal('points'),
                  form: [],
                }
              })
              espnStandingsLoaded = true
            }
          }
        }
        
        // Fallback to local standings if ESPN fails
        if (!espnStandingsLoaded && standingsRes.status === 'fulfilled' && standingsRes.value.ok) {
          const standingsJson = await standingsRes.value.json()
          leagueData.standings = (standingsJson.standings || []).map((s: any, idx: number) => ({
            position: s.position || idx + 1,
            teamName: s.team || s.name || s.team_name || 'Unknown',
            teamId: s.id,
            played: s.played || 0,
            won: s.won || s.wins || 0,
            drawn: s.drawn || s.draws || 0,
            lost: s.lost || s.losses || 0,
            goalsFor: s.goalsFor || 0,
            goalsAgainst: s.goalsAgainst || 0,
            goalDiff: s.goalDifference || s.goalConDiff || 0,
            points: s.points || s.pts || 0,
            form: s.form || [],
          }))
        }

        // Process upcoming matches from ESPN
        if (espnResults[1].status === 'fulfilled') {
          const espnMatches = espnResults[1] as PromiseFulfilledResult<Response>
          if (espnMatches.value.ok) {
            const matchesData = await espnMatches.value.json()
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
              
              if (isFinished) {
                leagueData.recentResults.push({
                  id: String(event.id),
                  homeTeam: homeTeam?.team?.displayName || 'Home',
                  awayTeam: awayTeam?.team?.displayName || 'Away',
                  homeScore: parseInt(homeTeam?.score || '0'),
                  awayScore: parseInt(awayTeam?.score || '0'),
                  date: matchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                })
              } else if (matchDate >= now) {
                leagueData.upcomingMatches.push({
                  id: String(event.id),
                  homeTeam: homeTeam?.team?.displayName || 'Home',
                  awayTeam: awayTeam?.team?.displayName || 'Away',
                  date: matchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                  time: matchDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                  venue: competition.venue?.fullName,
                })
              }
            }
          }
        }

        // Process top scorers from ESPN with comprehensive parsing
        if (espnResults[2].status === 'fulfilled') {
          const espnLeaders = espnResults[2] as PromiseFulfilledResult<Response>
          if (espnLeaders.value.ok) {
            const leadersData = await espnLeaders.value.json()
            
            // Try different paths to find leaders data (ESPN API format varies by league)
            let scorers: any[] = []
            
            // Path 1: leaders array with categories
            if (leadersData.leaders && Array.isArray(leadersData.leaders)) {
              const goalsCategory = leadersData.leaders.find((cat: any) => 
                cat.name?.toLowerCase().includes('goal') || 
                cat.displayName?.toLowerCase().includes('goal') ||
                cat.abbreviation?.toLowerCase() === 'g' ||
                cat.name?.toLowerCase() === 'goals'
              )
              if (goalsCategory?.leaders) {
                scorers = goalsCategory.leaders
              }
              // Fallback: take first category if no goals found
              if (scorers.length === 0 && leadersData.leaders[0]?.leaders) {
                scorers = leadersData.leaders[0].leaders
              }
            }
            
            // Path 2: categories within leaders
            if (scorers.length === 0 && leadersData.categories) {
              const goalsCategory = leadersData.categories.find((cat: any) =>
                cat.name?.toLowerCase().includes('goal') ||
                cat.displayName?.toLowerCase().includes('goal') ||
                cat.abbreviation?.toLowerCase() === 'g'
              )
              if (goalsCategory?.leaders) {
                scorers = goalsCategory.leaders
              }
              // Fallback: take first category
              if (scorers.length === 0 && leadersData.categories[0]?.leaders) {
                scorers = leadersData.categories[0].leaders
              }
            }
            
            // Path 3: direct leaders array
            if (scorers.length === 0 && leadersData.athletes) {
              scorers = leadersData.athletes
            }
            
            // Path 4: root-level array
            if (scorers.length === 0 && Array.isArray(leadersData)) {
              scorers = leadersData
            }
            
            // Path 5: nested in sports structure (common for some ESPN endpoints)
            if (scorers.length === 0 && leadersData.sports?.[0]?.leagues?.[0]?.athletes) {
              scorers = leadersData.sports[0].leagues[0].athletes
            }
            
            if (scorers.length > 0) {
              leagueData.topScorers = scorers.slice(0, 10).map((leader: any, idx: number) => ({
                rank: idx + 1,
                name: leader.athlete?.displayName || leader.athlete?.fullName || leader.displayName || leader.name || leader.fullName || 'Unknown',
                team: leader.athlete?.team?.displayName || leader.team?.displayName || leader.team?.name || leader.teamName || '',
                goals: parseInt(leader.value || leader.stat || leader.goals || leader.statistics?.goals || '0'),
                assists: parseInt(leader.assists || leader.statistics?.assists || '0'),
                matches: leader.athlete?.statistics?.gamesPlayed || leader.gamesPlayed || leader.statistics?.gamesPlayed || 0,
              }))
            }
          }
        }
        
        // Fallback: Try alternative ESPN endpoint for leaders if still empty
        if (leagueData.topScorers.length === 0) {
          try {
            const altLeadersRes = await fetch(
              `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/statistics`,
              { next: { revalidate: 3600 } }
            )
            if (altLeadersRes.ok) {
              const statsData = await altLeadersRes.json()
              const leaders = statsData.leaders?.categories?.[0]?.leaders || statsData.categories?.[0]?.leaders || []
              if (leaders.length > 0) {
                leagueData.topScorers = leaders.slice(0, 10).map((leader: any, idx: number) => ({
                  rank: idx + 1,
                  name: leader.athlete?.displayName || leader.name || 'Unknown',
                  team: leader.athlete?.team?.displayName || leader.team || '',
                  goals: parseInt(leader.value || '0'),
                  assists: 0,
                  matches: 0,
                }))
              }
            }
          } catch (e) {
            // Silently fail on alternative endpoint
          }
        }

        // Process league-specific news from ESPN
        try {
          const espnNewsRes = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/news`,
            { next: { revalidate: 300 } }
          )
          if (espnNewsRes.ok) {
            const espnNewsData = await espnNewsRes.json()
            leagueData.news = (espnNewsData.articles || []).slice(0, 8).map((n: any) => ({
              headline: n.headline || '',
              description: n.description || '',
              link: n.links?.web?.href || '',
              image: n.images?.[0]?.url || '',
              published: n.published || '',
            }))
          }
        } catch (e) {
          // Fallback to general news
          if (newsRes.status === 'fulfilled' && newsRes.value.ok) {
            const newsJson = await newsRes.value.json()
            leagueData.news = (newsJson.articles || newsJson.news || []).slice(0, 5).map((n: any) => ({
              headline: n.headline || n.title || '',
              description: n.description || n.summary || '',
              link: n.links?.web?.href || n.url || '',
              image: n.images?.[0]?.url || n.image || '',
              published: n.published || '',
            }))
          }
        }

        setData(leagueData)
      } catch (error) {
        console.error('Error fetching league data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchLeagueData()
  }, [leagueId, leagueName, country, selectedSeason])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20" style={{ backgroundColor: 'var(--background)' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
      </div>
    )
  }

  return (
    <div className="flex-1" style={{ backgroundColor: 'var(--background)' }}>
      {/* Hero Header - FotMob Style */}
      <div className={`bg-gradient-to-r ${config.gradient} py-8 px-4`}>
        <div className="max-w-6xl mx-auto">
          {/* Back Button */}
          <Link
            href="/matches"
            className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-4 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Leagues
          </Link>
          
          <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
            <div className="flex items-center gap-4">
              {/* League Logo */}
              {leagueLogo ? (
                <img 
                  src={leagueLogo} 
                  alt={leagueName}
                  className="w-16 h-16 object-contain bg-white rounded-xl p-1"
                />
              ) : (
                <span className="text-4xl">{config.flag}</span>
              )}
              <div>
                <h1 className="text-3xl font-bold text-white">{leagueName}</h1>
                <p className="text-white/80">{AVAILABLE_SEASONS.find(s => s.value === selectedSeason)?.label || '2025-26'} Season • {country}</p>
              </div>
            </div>
            
            {/* Season Dropdown & Simulation Button - Match Tournament styling */}
            <div className="flex items-center gap-3">
              <select
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(e.target.value)}
                className="px-4 py-2 rounded-lg bg-white/20 text-white border border-white/30 backdrop-blur-sm cursor-pointer hover:bg-white/30 transition-colors"
              >
                {AVAILABLE_SEASONS.map(season => (
                  <option key={season.value} value={season.value} className="text-gray-900">
                    {season.label}
                  </option>
                ))}
              </select>
              
              <button
                onClick={runSeasonSimulation}
                disabled={runningSimulation || !data?.standings?.length}
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
          
          {/* Simulation Results - Match Tournament styling */}
          {simulationResults && (
            <div className="mt-4 p-4 bg-white/10 backdrop-blur-sm rounded-xl border border-white/20">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="text-amber-300 text-sm font-medium">🏆 Monte Carlo Simulation ({simulationResults.n_simulations.toLocaleString()} runs)</p>
                  <p className="text-white font-bold text-lg">{simulationResults.most_likely_champion} predicted champion</p>
                  <p className="text-white/70 text-sm mt-1">
                    Top 4: {simulationResults.likely_top_4.join(', ')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-amber-400">
                    {(simulationResults.champion_probability * 100).toFixed(1)}%
                  </p>
                  <p className="text-white/60 text-xs">title probability</p>
                </div>
              </div>
            </div>
          )}

          {/* Quick Stats - Always show based on available data */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            {/* Current Leader */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <p className="text-white/70 text-sm">Current Leader</p>
              <p className="text-white font-bold text-lg">{data?.standings[0]?.teamName || 'TBD'}</p>
              <p className="text-white/80 text-sm">{data?.standings[0]?.points || 0} points</p>
            </div>
            
            {/* Top Scorer or point diff leader */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <p className="text-white/70 text-sm">{data?.topScorers[0] ? 'Top Scorer' : 'Best GD'}</p>
              {data?.topScorers[0] ? (
                <>
                  <p className="text-white font-bold text-lg truncate">{data.topScorers[0].name}</p>
                  <p className="text-white/80 text-sm">{data.topScorers[0].goals} goals</p>
                </>
              ) : (
                <>
                  <p className="text-white font-bold text-lg">{data?.standings[0]?.teamName || 'TBD'}</p>
                  <p className="text-white/80 text-sm">
                    {data?.standings[0]?.goalDiff > 0 ? '+' : ''}{data?.standings[0]?.goalDiff || 0} GD
                  </p>
                </>
              )}
            </div>
            
            {/* Matches Played */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <p className="text-white/70 text-sm">Matchweek</p>
              <p className="text-white font-bold text-lg">{data?.standings[0]?.played || 0}</p>
              <p className="text-white/80 text-sm">matches played</p>
            </div>
            
            {/* Upcoming Matches */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <p className="text-white/70 text-sm">Coming Up</p>
              <p className="text-white font-bold text-lg">{data?.upcomingMatches?.length || 0}</p>
              <p className="text-white/80 text-sm">fixtures scheduled</p>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs - Match tournament pill-button styling */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
          {(['overview', 'standings', 'scorers', 'fixtures', 'simulator', 'news'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? `bg-gradient-to-r ${config.gradient} text-white`
                  : 'bg-[var(--muted-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {TAB_LABELS[tab] || tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-2">
        {/* Overview Tab - Like Tournament pages */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Matches */}
            <div className="lg:col-span-2 space-y-6">
              {/* Upcoming Matches */}
              <div className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">Upcoming Matches</h2>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                  {data?.upcomingMatches && data.upcomingMatches.length > 0 ? (
                    data.upcomingMatches.slice(0, 5).map((match) => (
                      <Link
                        key={match.id}
                        href={`/matches/${match.id}`}
                        className="block p-4 hover:bg-[var(--muted-bg)] transition-colors"
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <p className="font-medium text-[var(--text-primary)]">{match.homeTeam}</p>
                            <p className="font-medium text-[var(--text-primary)]">{match.awayTeam}</p>
                          </div>
                          <div className="text-right text-sm">
                            <p className="text-[var(--text-secondary)]">{match.date}</p>
                            <p className="text-[var(--text-tertiary)]">{match.time}</p>
                          </div>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <p className="p-4 text-[var(--text-tertiary)]">No upcoming matches</p>
                  )}
                </div>
              </div>

              {/* Recent Results */}
              <div className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">Recent Results</h2>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                  {data?.recentResults && data.recentResults.length > 0 ? (
                    data.recentResults.slice(0, 5).map((match) => (
                      <Link
                        key={match.id}
                        href={`/matches/${match.id}`}
                        className="block p-4 hover:bg-[var(--muted-bg)] transition-colors"
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <p className={`font-medium ${match.homeScore > match.awayScore ? 'text-green-500' : 'text-[var(--text-primary)]'}`}>
                              {match.homeTeam}
                            </p>
                            <p className={`font-medium ${match.awayScore > match.homeScore ? 'text-green-500' : 'text-[var(--text-primary)]'}`}>
                              {match.awayTeam}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-[var(--text-primary)]">{match.homeScore}</p>
                            <p className="text-lg font-bold text-[var(--text-primary)]">{match.awayScore}</p>
                          </div>
                        </div>
                        <p className="text-xs text-[var(--text-tertiary)] mt-1">{match.date}</p>
                      </Link>
                    ))
                  ) : (
                    <p className="p-4 text-[var(--text-tertiary)]">No recent results</p>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Simulation Card */}
            <div className="space-y-6">
              <div
                onClick={() => setActiveTab('simulator')}
                className="bg-gradient-to-br from-indigo-600/20 to-purple-600/20 rounded-xl p-6 cursor-pointer hover:from-indigo-600/30 hover:to-purple-600/30 transition-all border border-indigo-500/30 hover:scale-[1.02] hover:shadow-lg"
              >
                <div className="text-4xl mb-3">🎲</div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Run Simulation</h3>
                <p className="text-sm text-[var(--text-secondary)]">Predict final standings with AI</p>
              </div>

              {/* Compact Standings Preview */}
              <div className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--border-color)' }}>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">Standings</h2>
                  <button
                    onClick={() => setActiveTab('standings')}
                    className="text-sm text-[var(--accent-primary)] hover:underline"
                  >
                    View All
                  </button>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                  {data?.standings.slice(0, 5).map((team, idx) => (
                    <div key={team.teamName} className="flex justify-between items-center p-3">
                      <div className="flex items-center gap-2">
                        <span className="w-6 text-center text-sm text-[var(--text-tertiary)]">{idx + 1}</span>
                        <span className="font-medium text-[var(--text-primary)]">{team.teamName}</span>
                      </div>
                      <span className="font-bold text-[var(--text-primary)]">{team.points}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'standings' && data?.standings && (
          <div className="space-y-4">
            {/* Current Standings - with MLS Conference Support */}
            {isMLS ? (
              // MLS: Show Eastern and Western Conferences
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {['Eastern Conference', 'Western Conference'].map((conference) => {
                  const isEastern = conference.includes('Eastern')
                  const conferenceTeamsList = isEastern ? MLS_EASTERN_LOWER : MLS_WESTERN_LOWER
                  const conferenceTeams = data.standings.filter(team => 
                    isInConference(team.teamName, conferenceTeamsList)
                  )
                  
                  return (
                    <div key={conference} className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                      <div className={`p-4 border-b bg-gradient-to-r ${isEastern ? 'from-blue-600/20 to-indigo-600/20' : 'from-orange-600/20 to-red-600/20'}`} style={{ borderColor: 'var(--border-color)' }}>
                        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{conference}</h2>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-[var(--muted-bg)]">
                            <tr className="text-xs text-[var(--text-tertiary)]">
                              <th className="text-left py-3 px-3 font-medium">#</th>
                              <th className="text-left py-3 px-3 font-medium">Team</th>
                              <th className="text-center py-3 px-2 font-medium">P</th>
                              <th className="text-center py-3 px-2 font-medium">Pts</th>
                              <th className="text-center py-3 px-2 font-medium hidden sm:table-cell">Form</th>
                            </tr>
                          </thead>
                          <tbody>
                            {conferenceTeams.length > 0 ? conferenceTeams.map((team, idx) => {
                              let zoneClass = ''
                              if (idx < 7) zoneClass = 'border-l-4 border-l-green-400 bg-green-500/20'  // Playoff spots
                              else if (idx < 9) zoneClass = 'border-l-4 border-l-amber-400 bg-amber-500/20'  // Wild card

                              return (
                                <tr key={team.teamName} className={`border-b hover:bg-[var(--muted-bg)] ${zoneClass}`} style={{ borderColor: 'var(--border-color)' }}>
                                  <td className="py-2.5 px-3 text-[var(--text-secondary)]">{idx + 1}</td>
                                  <td className="py-2.5 px-3 font-medium text-[var(--text-primary)]">{team.teamName}</td>
                                  <td className="py-2.5 px-2 text-center text-[var(--text-secondary)]">{team.played}</td>
                                  <td className="py-2.5 px-2 text-center font-bold text-[var(--text-primary)]">{team.points}</td>
                                  <td className="py-2.5 px-2 text-center hidden sm:table-cell">
                                    <div className="flex justify-center gap-0.5">
                                      {team.form && team.form.length > 0 ? (
                                        team.form.slice(-5).map((result, i) => (
                                          <span
                                            key={i}
                                            className={`w-4 h-4 flex items-center justify-center text-[9px] font-bold rounded ${
                                              result === 'W' ? 'bg-green-500 text-white' :
                                              result === 'D' ? 'bg-gray-400 text-white' :
                                              'bg-red-500 text-white'
                                            }`}
                                          >
                                            {result}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-[var(--text-tertiary)] text-xs">-</span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            }) : (
                              <tr><td colSpan={MLS_CONFERENCE_TABLE_COLUMNS} className="py-4 text-center text-[var(--text-tertiary)]">No teams found</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="p-3 border-t text-xs text-[var(--text-tertiary)] flex gap-3" style={{ borderColor: 'var(--border-color)' }}>
                        <span><span className="inline-block w-2 h-2 rounded-sm bg-green-400 mr-1"></span> Playoff</span>
                        <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1"></span> Wild Card</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              // Regular league standings
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                    League Standings
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-[var(--muted-bg)]">
                      <tr className="text-xs text-[var(--text-tertiary)]">
                        <th className="text-left py-3 px-4 font-medium">#</th>
                        <th className="text-left py-3 px-4 font-medium">Team</th>
                        <th className="text-center py-3 px-2 font-medium">P</th>
                        <th className="text-center py-3 px-2 font-medium">W</th>
                        <th className="text-center py-3 px-2 font-medium">D</th>
                        <th className="text-center py-3 px-2 font-medium">L</th>
                        <th className="text-center py-3 px-2 font-medium">GD</th>
                        <th className="text-center py-3 px-4 font-medium">Pts</th>
                        <th className="text-center py-3 px-2 font-medium hidden sm:table-cell">Form</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.standings.map((team, idx) => {
                        // Determine zone coloring with improved visibility
                        let zoneClass = ''
                        if (idx < 4) zoneClass = 'border-l-4 border-l-green-400 bg-green-500/20'
                        else if (idx >= data.standings.length - 3) zoneClass = 'border-l-4 border-l-red-400 bg-red-500/20'
                        else if (idx < 6) zoneClass = 'border-l-4 border-l-blue-400 bg-blue-500/20'

                        return (
                          <tr
                            key={team.teamName}
                            className={`border-b hover:bg-[var(--muted-bg)] transition-colors ${zoneClass}`}
                            style={{ borderColor: 'var(--border-color)' }}
                          >
                            <td className="py-3 px-4 text-[var(--text-secondary)]">{team.position}</td>
                            <td className="py-3 px-4 font-medium text-[var(--text-primary)]">{team.teamName}</td>
                            <td className="py-3 px-2 text-center text-[var(--text-secondary)]">{team.played}</td>
                            <td className="py-3 px-2 text-center text-green-500">{team.won}</td>
                            <td className="py-3 px-2 text-center text-[var(--text-tertiary)]">{team.drawn}</td>
                            <td className="py-3 px-2 text-center text-red-400">{team.lost}</td>
                            <td className="py-3 px-2 text-center text-[var(--text-secondary)]">
                              {team.goalDiff > 0 ? `+${team.goalDiff}` : team.goalDiff}
                            </td>
                            <td className="py-3 px-4 text-center font-bold text-[var(--text-primary)]">{team.points}</td>
                            <td className="py-3 px-2 text-center hidden sm:table-cell">
                              <div className="flex justify-center gap-0.5">
                                {team.form && team.form.length > 0 ? (
                                  team.form.slice(-5).map((result, i) => (
                                    <span
                                      key={i}
                                      className={`w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded ${
                                        result === 'W' ? 'bg-green-500 text-white' :
                                        result === 'D' ? 'bg-gray-400 text-white' :
                                        'bg-red-500 text-white'
                                      }`}
                                    >
                                      {result}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[var(--text-tertiary)] text-xs">-</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Legend */}
                <div className="p-4 border-t flex flex-wrap gap-4 text-xs" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-400 rounded" />
                    <span className="text-[var(--text-tertiary)]">Champions League</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-400 rounded" />
                    <span className="text-[var(--text-tertiary)]">Europa League</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-red-400 rounded" />
                    <span className="text-[var(--text-tertiary)]">Relegation</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'scorers' && (
          <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Top Scorers</h2>
            </div>
            {data?.topScorers && data.topScorers.length > 0 ? (
              <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {data.topScorers.map((scorer) => (
                  <div key={scorer.name} className="flex items-center justify-between p-4 hover:bg-[var(--muted-bg)]">
                    <div className="flex items-center gap-4">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                        scorer.rank <= 3 ? 'bg-amber-500 text-white' : 'bg-[var(--muted-bg)] text-[var(--text-secondary)]'
                      }`}>
                        {scorer.rank}
                      </span>
                      <div>
                        <p className="font-medium text-[var(--text-primary)]">{scorer.name}</p>
                        <p className="text-sm text-[var(--text-tertiary)]">{scorer.team}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-[var(--accent-primary)]">{scorer.goals}</p>
                      <p className="text-xs text-[var(--text-tertiary)]">{scorer.assists} assists</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center">
                <span className="text-3xl mb-2 block">⚽</span>
                <p className="text-[var(--text-tertiary)]">Top scorers data is being loaded...</p>
                <p className="text-sm text-[var(--text-tertiary)] mt-1">Check back later for the latest statistics</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'fixtures' && (
          <div className="space-y-6">
            {/* Calendar View */}
            <MatchCalendar leagueId={getEspnLeagueId()} leagueName={leagueName} />
          </div>
        )}

        {/* Simulator Tab - Like SeasonSimulator from Predict page */}
        {activeTab === 'simulator' && (
          <div className="space-y-6">
            <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] p-6">
              <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <span>🎲</span>
                    Season Simulation
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Monte Carlo simulation using team ELO ratings and Poisson goal distributions
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={numSimulations}
                    onChange={(e) => setNumSimulations(parseInt(e.target.value))}
                    className="px-4 py-2 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                  >
                    <option value={500}>500 (Fast)</option>
                    <option value={1000}>1,000</option>
                    <option value={5000}>5,000</option>
                    <option value={10000}>10,000 (Accurate)</option>
                    <option value={25000}>25,000</option>
                    <option value={50000}>50,000</option>
                  </select>
                  <button
                    onClick={runSeasonSimulation}
                    disabled={runningSimulation}
                    className="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-indigo-500/25 flex items-center gap-2"
                  >
                    {runningSimulation ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Simulating...</span>
                      </>
                    ) : (
                      <>
                        <span>🎲</span>
                        <span>Run Simulation</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Simulation Results */}
            {simulationResults && (
              <div className="space-y-6 animate-fade-in">
                {/* Summary Card */}
                <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
                  <div className="p-6 bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border-b border-[var(--border-color)]">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div>
                        <h3 className="text-2xl font-bold text-[var(--text-primary)]">{simulationResults.league_name}</h3>
                        <p className="text-[var(--text-secondary)]">
                          {simulationResults.remaining_matches} matches remaining • {simulationResults.n_simulations.toLocaleString()} simulations
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-[var(--text-secondary)]">Most Likely Champion</p>
                        <p className="text-xl font-bold text-amber-400">{simulationResults.most_likely_champion}</p>
                        <p className="text-sm text-amber-400/80">{(simulationResults.champion_probability * 100).toFixed(1)}% probability</p>
                      </div>
                    </div>
                  </div>

                  {/* Key Insights */}
                  <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                      <p className="text-sm text-[var(--text-secondary)] mb-2">🥇 Title Contenders</p>
                      <div className="space-y-1">
                        {simulationResults.standings
                          .filter(t => t.title_probability > 0.01)
                          .sort((a, b) => b.title_probability - a.title_probability)
                          .slice(0, 4)
                          .map((team) => (
                            <div key={team.team_name} className="flex justify-between text-sm">
                              <span className="text-[var(--text-primary)]">{team.team_name}</span>
                              <span className="text-amber-400">{(team.title_probability * 100).toFixed(1)}%</span>
                            </div>
                          ))}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                      <p className="text-sm text-[var(--text-secondary)] mb-2">🏆 Top 4 Favorites</p>
                      <div className="space-y-1">
                        {simulationResults.likely_top_4?.slice(0, 4).map((team, idx) => (
                          <div key={team} className="flex items-center gap-2 text-sm">
                            <span className="w-5 text-center text-emerald-400">{idx + 1}</span>
                            <span className="text-[var(--text-primary)]">{team}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                      <p className="text-sm text-[var(--text-secondary)] mb-2">⚠️ Relegation Danger</p>
                      <div className="space-y-1">
                        {simulationResults.relegation_candidates?.slice(0, 3).map((team) => (
                          <div key={team} className="flex items-center gap-2 text-sm">
                            <span className="w-5 text-center text-red-400">↓</span>
                            <span className="text-[var(--text-primary)]">{team}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Full Standings Table */}
                <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
                  <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
                    <h3 className="font-semibold text-[var(--text-primary)]">Predicted Final Standings</h3>
                    <span className="text-sm text-[var(--text-secondary)]">
                      📊 {simulationResults.remaining_matches} games remaining
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-xs text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
                          <th className="text-left py-3 px-4">Pos</th>
                          <th className="text-left py-3 px-4">Team</th>
                          <th className="text-center py-3 px-4">Current Pts</th>
                          <th className="text-center py-3 px-4">Predicted Pts</th>
                          <th className="text-center py-3 px-4">Title %</th>
                          <th className="text-center py-3 px-4">Top 4 %</th>
                          <th className="text-center py-3 px-4">Relegation %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simulationResults.standings
                          .sort((a, b) => b.avg_final_points - a.avg_final_points)
                          .map((team, idx) => (
                            <tr
                              key={team.team_name}
                              className={`border-b border-[var(--border-color)] hover:bg-[var(--background-secondary)] transition-colors ${
                                idx < 4 ? 'border-l-2 border-l-emerald-500' : 
                                idx >= simulationResults.standings.length - 3 ? 'border-l-2 border-l-red-500' : ''
                              }`}
                            >
                              <td className="py-3 px-4 text-[var(--text-secondary)]">{idx + 1}</td>
                              <td className="py-3 px-4 text-[var(--text-primary)] font-medium">{team.team_name}</td>
                              <td className="py-3 px-4 text-center text-[var(--text-secondary)]">{team.current_points}</td>
                              <td className="py-3 px-4 text-center text-[var(--text-primary)] font-semibold">
                                {team.avg_final_points.toFixed(0)}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.title_probability > 0.01 ? (
                                  <span className="text-amber-400">{(team.title_probability * 100).toFixed(1)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.top_4_probability > 0.01 ? (
                                  <span className="text-emerald-400">{(team.top_4_probability * 100).toFixed(0)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.relegation_probability > 0.01 ? (
                                  <span className="text-red-400">{(team.relegation_probability * 100).toFixed(0)}%</span>
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
                      <div className="w-3 h-3 bg-emerald-500 rounded" />
                      <span>Champions League</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-red-500 rounded" />
                      <span>Relegation Zone</span>
                    </div>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <p className="text-sm text-amber-800 dark:text-amber-200/80 text-center">
                    <span className="font-semibold">⚠️ Note:</span> Predictions are based on Monte Carlo simulations using current standings and team ratings. 
                    Actual results may vary significantly due to injuries, transfers, and unpredictable events.
                  </p>
                </div>
              </div>
            )}

            {/* Initial state - no simulation run yet */}
            {!simulationResults && !runningSimulation && (
              <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] p-8 text-center">
                <span className="text-6xl mb-4 block">🔮</span>
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">Season Simulation</h3>
                <p className="text-[var(--text-secondary)] max-w-md mx-auto">
                  Run a Monte Carlo simulation to predict final standings, 
                  title probabilities, and relegation risks based on remaining fixtures.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'news' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data?.news && data.news.length > 0 ? (
              data.news.map((item, idx) => (
                <a 
                  key={idx} 
                  href={item.link || '#'} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden transition-all duration-300 group hover:scale-[1.02] hover:shadow-xl hover:border-[var(--accent-primary)]" 
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  {/* Cover Photo */}
                  {item.image && (
                    <div className="aspect-video w-full overflow-hidden">
                      <img 
                        src={item.image} 
                        alt={item.headline} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                      />
                    </div>
                  )}
                  <div className="p-4">
                    <h3 className="font-semibold text-[var(--text-primary)] mb-2 group-hover:text-[var(--accent-primary)] transition-colors line-clamp-2">
                      {item.headline}
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">{item.description}</p>
                    {item.published && (
                      <p className="text-xs text-[var(--text-tertiary)] mt-2">{item.published}</p>
                    )}
                  </div>
                </a>
              ))
            ) : (
              <div className="bg-[var(--card-bg)] border rounded-2xl p-8 text-center col-span-2" style={{ borderColor: 'var(--border-color)' }}>
                <p className="text-[var(--text-tertiary)]">No news available</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
