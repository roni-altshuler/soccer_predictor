'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import MatchCalendar from '@/components/match/MatchCalendar'

import { BorderBeam } from '@/components/magicui/border-beam'
import { Spotlight } from '@/components/magicui/spotlight'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { GenderToggle } from '@/components/GenderToggle'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'

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
  assists: number | null
  matches: number | null
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
  topScorerSource?: string
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

// Available seasons for dropdown
const AVAILABLE_SEASONS = [
  { value: '2025', label: '2025-26' },
  { value: '2024', label: '2024-25' },
  { value: '2023', label: '2023-24' },
  { value: '2022', label: '2022-23' },
  { value: '2021', label: '2021-22' },
]

// MLS uses calendar-year seasons (2026 = Feb–Nov 2026)
const MLS_SEASONS = [
  { value: '2026', label: '2026' },
  { value: '2025', label: '2025' },
  { value: '2024', label: '2024' },
  { value: '2023', label: '2023' },
  { value: '2022', label: '2022' },
]

// Calendar-year league IDs
const CALENDAR_YEAR_LEAGUE_IDS = new Set(['usa.1', 'mls'])

// Table column counts for colSpan calculations
const MLS_CONFERENCE_TABLE_COLUMNS = 5  // #, Team, P, Pts, Form

// League ID to numeric ID mapping (shared across component)
const LEAGUE_NUMERIC_ID_MAP: Record<string, number> = {
  'eng.1': 47, 'premier_league': 47,
  'esp.1': 87, 'la_liga': 87,
  'ger.1': 54, 'bundesliga': 54,
  'ita.1': 55, 'serie_a': 55,
  'fra.1': 53, 'ligue_1': 53,
  'usa.1': 130, 'mls': 130,
  'ned.1': 57, 'eredivisie': 57,
  'por.1': 61, 'primeira_liga': 61,
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

const formatShortDate = (value: string) => {
  if (!value) return 'TBD'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function LeagueFact({ label, value, note }: { label: string; value: string | number; note: string }) {
  const isNumeric = typeof value === 'number'
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm transition-colors hover:bg-white/15">
      <p className="text-[10px] uppercase tracking-wider text-white/65 font-semibold">{label}</p>
      <p className="mt-1 truncate text-sm md:text-base font-bold text-white tabular-nums">
        {isNumeric ? <NumberTicker value={value as number} className="text-white" /> : value}
      </p>
      <p className="text-[11px] text-white/70 truncate">{note}</p>
    </div>
  )
}

function MatchStrip({
  match,
  mode,
}: {
  match: UpcomingMatch | RecentMatch
  mode: 'upcoming' | 'result'
}) {
  const isResult = mode === 'result'
  const result = match as RecentMatch
  const upcoming = match as UpcomingMatch
  const homeWon = isResult && result.homeScore > result.awayScore
  const awayWon = isResult && result.awayScore > result.homeScore

  return (
    <Link
      href={`/matches/${match.id}`}
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3 hover:bg-[var(--card-hover)] transition-colors"
    >
      <div className="min-w-0 text-right">
        <p className={`truncate text-sm font-semibold ${homeWon ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
          {match.homeTeam}
        </p>
      </div>
      <div className="min-w-[84px] text-center">
        {isResult ? (
          <>
            <p className="font-mono text-lg font-black text-[var(--text-primary)]">
              {result.homeScore}-{result.awayScore}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">FT</p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold text-[var(--accent-ai)]">{upcoming.time || 'TBD'}</p>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{formatShortDate(upcoming.date)}</p>
          </>
        )}
      </div>
      <div className="min-w-0 text-left">
        <p className={`truncate text-sm font-semibold ${awayWon ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
          {match.awayTeam}
        </p>
      </div>
    </Link>
  )
}

function ActionCard({
  title,
  description,
  eyebrow,
  href,
  onClick,
}: {
  title: string
  description: string
  eyebrow: string
  href?: string
  onClick?: () => void
}) {
  const content = (
    <div className="h-full rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--accent-primary)] hover:bg-[var(--card-hover)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">{eyebrow}</p>
          <h3 className="mt-1 text-base font-bold text-[var(--text-primary)]">{title}</h3>
        </div>
        <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--accent-ai)]">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M9 7h8v8" />
          </svg>
        </span>
      </div>
      <p className="mt-2 text-sm leading-5 text-[var(--text-secondary)]">{description}</p>
    </div>
  )

  if (href) {
    return <Link href={href} className="block h-full">{content}</Link>
  }

  return (
    <button type="button" onClick={onClick} className="block h-full w-full text-left">
      {content}
    </button>
  )
}

export default function LeagueHomePage({ leagueId, leagueName, country }: LeagueHomePageProps) {
  const [data, setData] = useState<LeagueHomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'standings' | 'scorers' | 'fixtures' | 'simulator' | 'news'>('overview')
  const { asQueryParam: genderParam } = useGenderQuery()
  const isMLS = leagueId === 'usa.1' || leagueId === 'mls'
  const isCalendarYear = CALENDAR_YEAR_LEAGUE_IDS.has(leagueId)
  const seasons = isCalendarYear ? MLS_SEASONS : AVAILABLE_SEASONS
  const [selectedSeason, setSelectedSeason] = useState(isCalendarYear ? '2026' : '2025')
  const [runningSimulation, setRunningSimulation] = useState(false)
  const [expandedSimTeam, setExpandedSimTeam] = useState<string | null>(null)
  const [numSimulations, setNumSimulations] = useState(10000)
  const [simulationResults, setSimulationResults] = useState<{
    league_name: string
    n_simulations: number
    remaining_matches: number
    fixture_source?: string
    most_likely_champion: string
    champion_probability: number
    likely_top_4: string[]
    relegation_candidates: string[]
    standings: Array<{
      team_name: string
      current_points: number
      matches_played: number
      avg_final_position: number
      avg_final_points: number
      title_probability: number
      top_4_probability: number
      relegation_probability: number
      position_distribution: Record<number, number>
    }>
  } | null>(null)

  // Single source of truth for league brand: getLeagueAccent() resolves
  // ESPN-style IDs, underscore IDs, FotMob numeric IDs, and display names
  // to a unified LeagueAccent record (accent colour, flag, logo, etc.).
  const leagueAccent = getLeagueAccent(leagueId)
  const leagueLogo = leagueAccent.logoUrl

  // State-safety fix: when the user changes gender, league, or season, any
  // previously-run Monte Carlo simulation results are now stale (they
  // describe the *previous* universe). Clear them so the user re-runs
  // against the fresh context rather than seeing mismatched cards.
  useEffect(() => {
    setSimulationResults(null)
    setExpandedSimTeam(null)
  }, [leagueId, selectedSeason, genderParam])

  // Helper to get ESPN league ID
  // League ID mapping for cleaner code
  const LEAGUE_ID_MAPPING: Record<string, string> = {
    'eng': 'premier_league',
    'esp': 'la_liga',
    'ger': 'bundesliga',
    'ita': 'serie_a',
    'fra': 'ligue_1',
    'usa': 'mls',
    'ned': 'eredivisie',
    'por': 'primeira_liga',
    'sco': 'scottish_premiership',
    'bel': 'belgian_pro_league',
    'tur': 'super_lig',
    'bra': 'brasileirao',
    'arg': 'liga_profesional',
    'mex': 'liga_mx',
  }
  
  const LEAGUE_TO_ESPN_ID: Record<string, string> = {
    'premier_league': 'eng.1',
    'la_liga': 'esp.1',
    'bundesliga': 'ger.1',
    'serie_a': 'ita.1',
    'ligue_1': 'fra.1',
    'mls': 'usa.1',
    'eredivisie': 'ned.1',
    'primeira_liga': 'por.1',
    'scottish_premiership': 'sco.1',
    'belgian_pro_league': 'bel.1',
    'super_lig': 'tur.1',
    'brasileirao': 'bra.1',
    'liga_profesional': 'arg.1',
    'liga_mx': 'mex.1',
    'champions_league': 'uefa.champions',
    'europa_league': 'uefa.europa',
    'conference_league': 'uefa.europa.conf',
    'world_cup': 'fifa.world',
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
          fixture_source: simData.fixture_source,
          most_likely_champion: simData.most_likely_champion || simData.standings?.[0]?.team_name || 'Unknown',
          champion_probability: simData.champion_probability || simData.standings?.[0]?.title_probability || 0,
          likely_top_4: simData.likely_top_4 || simData.standings?.slice(0, 4).map((s: any) => s.team_name) || [],
          relegation_candidates: simData.relegation_candidates || simData.standings?.slice(-3).map((s: any) => s.team_name) || [],
          standings: (simData.standings || []).map((s: any) => ({
            team_name: s.team_name || s.team || 'Unknown',
            current_points: s.current_points || 0,
            matches_played: s.matches_played || 0,
            avg_final_position: s.avg_final_position || 0,
            avg_final_points: s.avg_final_points || s.predicted_points || 0,
            title_probability: s.title_probability || 0,
            top_4_probability: s.top_4_probability || 0,
            relegation_probability: s.relegation_probability || 0,
            position_distribution: s.position_distribution || {},
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
        const [standingsRes, newsRes] = await Promise.allSettled([
          fetch(`/api/standings?league=${leagueParam}&gender=${genderParam}`),
          fetch(`/api/news?league=${leagueParam}&gender=${genderParam}`),
        ])
        
        // Also fetch from ESPN for real-time data including top scorers
        const espnLeagueId = getEspnLeagueId()
        
        // Get date range: 10 days back + 14 days forward for recent results and upcoming
        const now = new Date()
        const pastDate = new Date(now)
        pastDate.setDate(pastDate.getDate() - 10)
        const futureDate = new Date(now)
        futureDate.setDate(futureDate.getDate() + 14)
        const fmtDate = (d: Date) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
        const scoreboardDateRange = `${fmtDate(pastDate)}-${fmtDate(futureDate)}`

        // Season param only for standings (historical); scoreboard and leaders use current
        const seasonParam = selectedSeason ? `?season=${selectedSeason}` : ''

        const espnResults = await Promise.allSettled([
          fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${espnLeagueId}/standings${seasonParam}`),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/scoreboard?dates=${scoreboardDateRange}`),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/leaders${seasonParam}`),
        ])

        const leagueData: LeagueHomeData = {
          leagueId: parseInt(leagueId) || 0,
          leagueName,
          country,
          season: seasons.find(s => s.value === selectedSeason)?.label || (isCalendarYear ? '2026' : '2025-26'),
          standings: [],
          topScorers: [],
          upcomingMatches: [],
          recentResults: [],
          news: [],
        }

        // PRIORITIZE ESPN data for accurate real-time standings
        // ESPN provides the most up-to-date standings data
        // For MLS and other leagues with multiple groups/conferences, iterate all children
        let espnStandingsLoaded = false
        if (espnResults[0].status === 'fulfilled') {
          const espnStandings = espnResults[0] as PromiseFulfilledResult<Response>
          if (espnStandings.value.ok) {
            const espnData = await espnStandings.value.json()
            const children = espnData.children || []
            const allEntries: any[] = []
            for (const child of children) {
              const entries = child?.standings?.entries || []
              allEntries.push(...entries)
            }
            if (allEntries.length > 0) {
              leagueData.standings = allEntries.map((entry: any, idx: number) => {
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
                  _rawDate: matchDate.getTime(),
                } as RecentMatch & { _rawDate: number })
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
            // Sort recent results by date descending (newest first)
            leagueData.recentResults.sort((a: any, b: any) => (b._rawDate || 0) - (a._rawDate || 0))
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
              `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/statistics${seasonParam}`,
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
          } catch {
            // Silently fail on alternative endpoint
          }
        }

        // Use the dedicated server route as the final authority for scorer rows.
        try {
          const leagueParam = leagueId.includes('.')
            ? leagueId
            : LEAGUE_TO_ESPN_ID[leagueId] || leagueId
          const scorersRes = await fetch(`/api/top-scorers/${leagueParam}?season=${selectedSeason}`)
          if (scorersRes.ok) {
            const scorersData = await scorersRes.json()
            if (scorersData.scorers && scorersData.scorers.length > 0) {
              leagueData.topScorers = scorersData.scorers.map((s: any) => ({
                rank: s.rank,
                name: s.name,
                team: s.team,
                goals: s.goals,
                assists: s.assists ?? null,
                matches: s.matches ?? null,
              }))
              leagueData.topScorerSource = scorersData.source === 'verified_fallback'
                ? 'Guardian verified fallback'
                : 'ESPN leaders'
            }
          }
        } catch {
          // Scorer route failed; keep any provider data already loaded.
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
        } catch {
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
  }, [leagueId, leagueName, country, selectedSeason, genderParam])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20" style={{ backgroundColor: 'var(--background)' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--accent-ai)]" />
      </div>
    )
  }

  return (
    <div className="flex-1" style={{ backgroundColor: 'var(--background)' }}>
      {/* Hero Header — accent-driven, with magicui Spotlight + BorderBeam polish */}
      <Spotlight
        className="relative block border-b border-white/10"
        size={620}
        color="color-mix(in srgb, var(--league-accent, #22c55e) 26%, transparent)"
      >
      <div
        className="relative overflow-hidden px-4 py-5 md:py-6"
        style={{
          // Use the league brand from leagueAccents.ts (single source of truth).
          background: `linear-gradient(135deg, ${leagueAccent.accent} 0%, #0a0e1c 78%)`,
          // Expose the accent as a CSS var for any nested CSS color-mix() callers.
          ['--league-accent' as string]: leagueAccent.accent,
        }}
      >
        <BorderBeam size={1} duration={14} borderRadius={0} colorFrom={leagueAccent.accent} colorTo="rgba(255,255,255,0.7)" />
        <div className="relative z-10 max-w-6xl mx-auto">
          <Link
            href="/matches"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            All leagues
          </Link>

          <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              {leagueLogo ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={leagueLogo}
                  alt={leagueName}
                  className="h-16 w-16 rounded-xl bg-white object-contain p-1.5 shadow-lg ring-1 ring-white/20"
                />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-white/12 text-3xl ring-1 ring-white/15">{leagueAccent.flag}</span>
              )}
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">{country} · {leagueAccent.shortName}</p>
                <h1 className="truncate text-3xl md:text-4xl font-black text-white">{leagueName}</h1>
                <p className="mt-1 text-sm text-white/75">
                  {seasons.find(s => s.value === selectedSeason)?.label || (isCalendarYear ? '2026' : '2025-26')} season
                </p>
              </div>
            </div>
            
            <div className="w-full md:w-auto">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/55">Season</label>
              <div className="relative">
                <select
                  value={selectedSeason}
                  onChange={(e) => setSelectedSeason(e.target.value)}
                  className="w-full md:w-44 appearance-none rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 pr-9 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/40"
                >
                  {seasons.map(season => (
                    <option key={season.value} value={season.value} className="bg-[var(--card-bg)] text-[var(--text-primary)]">
                      {season.label}
                    </option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9l6 6 6-6" />
                </svg>
              </div>
            </div>
          </div>
          
          {simulationResults && (
            <div className="mt-5 rounded-lg border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-warn)]">Monte Carlo Simulation ({simulationResults.n_simulations.toLocaleString()} runs)</p>
                  <p className="text-white font-bold text-lg">{simulationResults.most_likely_champion} predicted champion</p>
                  <p className="text-white/70 text-sm mt-1">
                    Top 4: {simulationResults.likely_top_4.join(', ')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-[var(--accent-warn)]">
                    {(simulationResults.champion_probability * 100).toFixed(1)}%
                  </p>
                  <p className="text-white/60 text-xs">title probability</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <LeagueFact
              label="Leader"
              value={data?.standings[0]?.teamName || 'TBD'}
              note={`${data?.standings[0]?.points || 0} points`}
            />
            <LeagueFact
              label={data?.topScorers[0] ? 'Top Scorer' : 'Best GD'}
              value={data?.topScorers[0]?.name || data?.standings[0]?.teamName || 'TBD'}
              note={data?.topScorers[0] ? `${data.topScorers[0].goals} goals · ${data.topScorerSource || 'provider data'}` : `${data?.standings[0]?.goalDiff || 0} goal diff`}
            />
            <LeagueFact
              label="Matchweek"
              value={data?.standings[0]?.played || 0}
              note="matches played"
            />
            <LeagueFact
              label="Coming Up"
              value={data?.upcomingMatches?.length || 0}
              note="fixtures scheduled"
            />
          </div>
        </div>
      </div>
      </Spotlight>

      <div className="sticky top-0 z-20 border-b border-[var(--border-color)] bg-[var(--background)]/90 backdrop-blur-md">
        <div
          role="tablist"
          aria-label="League sections"
          className="max-w-6xl mx-auto flex gap-1 overflow-x-auto px-4 py-3"
        >
          {(['overview', 'standings', 'scorers', 'fixtures', 'simulator', 'news'] as const).map((tab) => {
            const active = activeTab === tab
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab)}
                className={`relative rounded-lg px-3 py-2 text-sm font-semibold capitalize whitespace-nowrap transition-colors ${
                  active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="league-tab-pill"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="absolute inset-0 -z-[1] rounded-lg bg-[var(--card-bg)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--border-color)]"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-[1]">{TAB_LABELS[tab] || tab}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-2">
        {/* Overview Tab - Like Tournament pages */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-[var(--shadow-sm)]">
                <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">Schedule</p>
                    <h2 className="text-base font-bold text-[var(--text-primary)]">Upcoming Matches</h2>
                  </div>
                  <button
                    onClick={() => setActiveTab('fixtures')}
                    className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
                  >
                    Calendar
                  </button>
                </div>
                <div className="divide-y divide-[var(--border-color)]">
                  {data?.upcomingMatches && data.upcomingMatches.length > 0 ? (
                    data.upcomingMatches.slice(0, 5).map((match) => (
                      <MatchStrip key={match.id} match={match} mode="upcoming" />
                    ))
                  ) : (
                    <p className="p-4 text-sm text-[var(--text-tertiary)]">No upcoming matches</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-[var(--shadow-sm)]">
                <div className="border-b border-[var(--border-color)] px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">Form Check</p>
                  <h2 className="text-base font-bold text-[var(--text-primary)]">Recent Results</h2>
                </div>
                <div className="divide-y divide-[var(--border-color)]">
                  {data?.recentResults && data.recentResults.length > 0 ? (
                    data.recentResults.slice(0, 5).map((match) => (
                      <MatchStrip key={match.id} match={match} mode="result" />
                    ))
                  ) : (
                    <p className="p-4 text-sm text-[var(--text-tertiary)]">No recent results</p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3">
                <ActionCard
                  eyebrow="Projection"
                  title="Run Simulation"
                  description="Simulate the remaining season using current ESPN standings, listed fixtures when available, ELO strength, and scoreline probabilities."
                  onClick={() => setActiveTab('simulator')}
                />
                <ActionCard
                  eyebrow="Model Room"
                  title="AI Model Accuracy"
                  description="Review hit rate, Brier score, calibration, drift alerts, and league-level tuning."
                  href="/tracking"
                />
              </div>

              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-[var(--shadow-sm)]">
                <div className="border-b border-[var(--border-color)] px-4 py-3 flex justify-between items-center">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-semibold">Table</p>
                    <h2 className="text-base font-bold text-[var(--text-primary)]">Standings</h2>
                  </div>
                  <button
                    onClick={() => setActiveTab('standings')}
                    className="text-xs font-semibold text-[var(--accent-primary)] hover:underline"
                  >
                    View All
                  </button>
                </div>
                <div className="divide-y divide-[var(--border-color)]">
                  {data?.standings.slice(0, 5).map((team, idx) => (
                    <div key={team.teamName} className="flex justify-between items-center p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`w-1 h-9 rounded-full ${idx < 4 ? 'bg-[var(--accent-primary)]' : idx < 6 ? 'bg-[var(--accent-info)]' : 'bg-transparent'}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="w-5 text-center text-sm text-[var(--text-tertiary)]">{idx + 1}</span>
                            <span className="font-medium text-[var(--text-primary)] truncate">{team.teamName}</span>
                          </div>
                          <div className="flex gap-1 mt-1">
                            {(team.form || []).slice(-5).map((result, formIndex) => (
                              <span
                                key={`${team.teamName}-preview-${formIndex}`}
                                className={`w-4 h-4 rounded-md text-[9px] font-bold flex items-center justify-center ${
                                  result === 'W' ? 'bg-[var(--accent-primary)] text-white' :
                                  result === 'D' ? 'bg-[var(--accent-warn)] text-[var(--accent-on-primary)]' :
                                  'bg-[var(--accent-loss)] text-white'
                                }`}
                              >
                                {result}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-[var(--text-primary)]">{team.points}</span>
                        <div className="text-[10px] text-[var(--text-tertiary)]">pts</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Latest News */}
              {data?.news && data.news.length > 0 && (
                <div className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">Latest News</h2>
                  </div>
                  <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                    {data.news.filter(item => item.link).slice(0, 3).map((item, idx) => (
                      <a
                        key={idx}
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-4 hover:bg-[var(--muted-bg)] transition-colors group"
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
                      <div className={`p-4 border-b bg-gradient-to-r ${isEastern ? 'from-[color-mix(in_srgb,var(--accent-info)_20%,transparent)] to-[color-mix(in_srgb,var(--accent-ai)_20%,transparent)]' : 'from-[color-mix(in_srgb,var(--accent-warn)_20%,transparent)] to-[color-mix(in_srgb,var(--accent-loss)_20%,transparent)]'}`} style={{ borderColor: 'var(--border-color)' }}>
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
                              if (idx < 7) zoneClass = 'border-l-4 border-l-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)]'  // Playoff spots
                              else if (idx < 9) zoneClass = 'border-l-4 border-l-[var(--accent-warn)] bg-[color-mix(in_srgb,var(--accent-warn)_20%,transparent)]'  // Wild card

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
                                              result === 'W' ? 'bg-[var(--accent-primary)] text-white' :
                                              result === 'D' ? 'bg-[var(--text-tertiary)] text-white' :
                                              'bg-[var(--accent-loss)] text-white'
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
                        <span><span className="inline-block w-2 h-2 rounded-sm bg-[var(--accent-primary)] mr-1"></span> Playoff</span>
                        <span><span className="inline-block w-2 h-2 rounded-sm bg-[var(--accent-warn)] mr-1"></span> Wild Card</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              // Regular league standings
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                      League Standings
                    </h2>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">
                      FotMob-inspired table with qualification zones and last-five form
                    </p>
                  </div>
                  <div className="hidden md:flex items-center gap-2 text-[10px]">
                    <span className="px-2 py-1 rounded-full bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)]">UCL</span>
                    <span className="px-2 py-1 rounded-full bg-[color-mix(in_srgb,var(--accent-info)_15%,transparent)] text-[var(--accent-info)]">Europe</span>
                    <span className="px-2 py-1 rounded-full bg-[color-mix(in_srgb,var(--accent-loss)_15%,transparent)] text-[var(--accent-loss)]">Relegation</span>
                  </div>
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
                        if (idx < 4) zoneClass = 'border-l-4 border-l-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)]'
                        else if (idx >= data.standings.length - 3) zoneClass = 'border-l-4 border-l-[var(--accent-loss)] bg-[color-mix(in_srgb,var(--accent-loss)_20%,transparent)]'
                        else if (idx < 6) zoneClass = 'border-l-4 border-l-[var(--accent-info)] bg-[color-mix(in_srgb,var(--accent-info)_20%,transparent)]'

                        return (
                          <tr
                            key={team.teamName}
                            className={`border-b hover:bg-[var(--muted-bg)] transition-colors ${zoneClass}`}
                            style={{ borderColor: 'var(--border-color)' }}
                          >
                            <td className="py-3 px-4 text-[var(--text-secondary)]">{team.position}</td>
                            <td className="py-3 px-4">
                              <div className="font-medium text-[var(--text-primary)]">{team.teamName}</div>
                              <div className="text-[10px] text-[var(--text-tertiary)] mt-1">
                                {team.won}-{team.drawn}-{team.lost} record
                              </div>
                            </td>
                            <td className="py-3 px-2 text-center text-[var(--text-secondary)]">{team.played}</td>
                            <td className="py-3 px-2 text-center text-[var(--accent-primary)]">{team.won}</td>
                            <td className="py-3 px-2 text-center text-[var(--text-tertiary)]">{team.drawn}</td>
                            <td className="py-3 px-2 text-center text-[var(--accent-loss)]">{team.lost}</td>
                            <td
                              className={`py-3 px-2 text-center font-semibold tabular-nums ${
                                team.goalDiff > 0
                                  ? 'text-[var(--accent-primary)]'
                                  : team.goalDiff < 0
                                    ? 'text-[var(--accent-loss)]'
                                    : 'text-[var(--text-secondary)]'
                              }`}
                            >
                              {team.goalDiff > 0 ? `+${team.goalDiff}` : team.goalDiff}
                            </td>
                            <td className="py-3 px-4 text-center font-extrabold text-[var(--text-primary)] tabular-nums">{team.points}</td>
                            <td className="py-3 px-2 text-center hidden sm:table-cell">
                              <div className="flex justify-center gap-0.5">
                                {team.form && team.form.length > 0 ? (
                                  team.form.slice(-5).map((result, i) => (
                                    <span
                                      key={i}
                                      className={`w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded-md ${
                                        result === 'W' ? 'bg-[var(--accent-primary)] text-white' :
                                        result === 'D' ? 'bg-[var(--accent-warn)] text-[var(--accent-on-primary)]' :
                                        'bg-[var(--accent-loss)] text-white'
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
                    <div className="w-3 h-3 bg-[var(--accent-primary)] rounded" />
                    <span className="text-[var(--text-tertiary)]">Champions League</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-[var(--accent-info)] rounded" />
                    <span className="text-[var(--text-tertiary)]">Europa League</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-[var(--accent-loss)] rounded" />
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
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                {data?.season || (isCalendarYear ? '2026' : '2025-26')} · {data?.topScorerSource || 'Provider data'}
              </p>
            </div>
            {data?.topScorers && data.topScorers.length > 0 ? (
              <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {data.topScorers.map((scorer) => (
                  <div key={scorer.name} className="flex items-center justify-between p-4 hover:bg-[var(--muted-bg)]">
                    <div className="flex items-center gap-4">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                        scorer.rank <= 3 ? 'bg-[var(--accent-warn)] text-white' : 'bg-[var(--muted-bg)] text-[var(--text-secondary)]'
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
                      <p className="text-xs text-[var(--text-tertiary)]">
                        {scorer.assists === null ? 'Goals verified' : `${scorer.assists} assists`}
                      </p>
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
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] p-6">
              <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-bold text-[var(--text-primary)]">Season Simulation</h3>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Monte Carlo simulation using current standings, provider fixtures, ELO ratings, and Poisson goal distributions.
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
                    className="px-6 py-3 rounded-xl font-semibold text-[#041320] bg-gradient-to-r from-[var(--accent-ai-light)] to-[var(--accent-ai)] hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[var(--accent-ai)]/25 flex items-center gap-2"
                  >
                    {runningSimulation ? (
                      <>
                        <div className="w-5 h-5 border-2 border-[#041320] border-t-transparent rounded-full animate-spin" />
                        <span>Simulating...</span>
                      </>
                    ) : (
                      <span>Run Simulation</span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Simulation Results */}
            {simulationResults && (
              <div className="space-y-6 animate-fade-in">
                {/* Summary Card */}
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] overflow-hidden">
                  <div className="p-6 bg-gradient-to-r from-[var(--accent-ai)]/18 to-[var(--accent-primary)]/16 border-b border-[var(--border-color)]">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div>
                        <h3 className="text-2xl font-bold text-[var(--text-primary)]">{simulationResults.league_name}</h3>
                        <p className="text-[var(--text-secondary)]">
                          {simulationResults.remaining_matches} matches remaining • {simulationResults.n_simulations.toLocaleString()} simulations
                        </p>
                        {simulationResults.fixture_source && (
                          <p className="mt-1 text-xs text-[var(--text-tertiary)]">{simulationResults.fixture_source}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-[var(--text-secondary)]">Most Likely Champion</p>
                        <p className="text-xl font-bold text-[var(--accent-warn)]">{simulationResults.most_likely_champion}</p>
                        <p className="text-sm text-[var(--accent-warn)]/80">{(simulationResults.champion_probability * 100).toFixed(1)}% probability</p>
                      </div>
                    </div>
                  </div>

                  {/* Key Insights */}
                  <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                      <p className="text-sm text-[var(--text-secondary)] mb-2">Title Contenders</p>
                      <div className="space-y-1">
                        {simulationResults.standings
                          .filter(t => t.title_probability > 0.01)
                          .sort((a, b) => b.title_probability - a.title_probability)
                          .slice(0, 4)
                          .map((team) => (
                            <div key={team.team_name} className="flex justify-between text-sm">
                              <span className="text-[var(--text-primary)]">{team.team_name}</span>
                              <span className="text-[var(--accent-warn)]">{(team.title_probability * 100).toFixed(1)}%</span>
                            </div>
                          ))}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                      <p className="text-sm text-[var(--text-secondary)] mb-2">Top 4 Favorites</p>
                      <div className="space-y-1">
                        {simulationResults.likely_top_4?.slice(0, 4).map((team, idx) => (
                          <div key={team} className="flex items-center gap-2 text-sm">
                            <span className="w-5 text-center text-[var(--accent-primary)]">{idx + 1}</span>
                            <span className="text-[var(--text-primary)]">{team}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                      <p className="text-sm text-[var(--text-secondary)] mb-2">Relegation Risk</p>
                      <div className="space-y-1">
                        {simulationResults.relegation_candidates?.slice(0, 3).map((team) => (
                          <div key={team} className="flex items-center gap-2 text-sm">
                            <span className="w-5 text-center text-[var(--accent-loss)]">↓</span>
                            <span className="text-[var(--text-primary)]">{team}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Full Standings Table */}
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] overflow-hidden">
                  <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
                    <h3 className="font-semibold text-[var(--text-primary)]">Predicted Final Standings</h3>
                    <span className="text-sm text-[var(--text-secondary)]">
                      {simulationResults.remaining_matches} games remaining
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="text-xs text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
                          <th className="text-left py-3 px-4">Pos</th>
                          <th className="text-left py-3 px-4">Team</th>
                          <th className="text-center py-3 px-4">Pts</th>
                          <th className="text-center py-3 px-4">Pred Pts</th>
                          <th className="text-center py-3 px-4">Avg Pos</th>
                          <th className="text-center py-3 px-4">Title %</th>
                          <th className="text-center py-3 px-4">Top 4 %</th>
                          <th className="text-center py-3 px-4">Releg %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simulationResults.standings
                          .sort((a, b) => a.avg_final_position - b.avg_final_position)
                          .map((team, idx) => (
                            <React.Fragment key={team.team_name}>
                            <tr
                              onClick={() => setExpandedSimTeam(expandedSimTeam === team.team_name ? null : team.team_name)}
                              className={`border-b border-[var(--border-color)] hover:bg-[var(--background-secondary)] transition-colors cursor-pointer ${
                                idx < 4 ? 'border-l-2 border-l-emerald-500' : 
                                idx >= simulationResults.standings.length - 3 ? 'border-l-2 border-l-red-500' : ''
                              }`}
                            >
                              <td className="py-3 px-4 text-[var(--text-secondary)]">{idx + 1}</td>
                              <td className="py-3 px-4 text-[var(--text-primary)] font-medium">
                                {team.team_name}
                                <span className="text-xs text-[var(--text-tertiary)] ml-1">▾</span>
                              </td>
                              <td className="py-3 px-4 text-center text-[var(--text-secondary)]">{team.current_points}</td>
                              <td className="py-3 px-4 text-center text-[var(--text-primary)] font-semibold">
                                {team.avg_final_points.toFixed(0)}
                              </td>
                              <td className="py-3 px-4 text-center text-[var(--text-secondary)]">
                                {team.avg_final_position.toFixed(1)}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.title_probability > 0.01 ? (
                                  <span className="text-[var(--accent-warn)]">{(team.title_probability * 100).toFixed(1)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.top_4_probability > 0.01 ? (
                                  <span className="text-[var(--accent-primary)]">{(team.top_4_probability * 100).toFixed(0)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.relegation_probability > 0.01 ? (
                                  <span className="text-[var(--accent-loss)]">{(team.relegation_probability * 100).toFixed(0)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                            </tr>
                            {expandedSimTeam === team.team_name && team.position_distribution && (
                              <tr className="bg-[var(--background-secondary)]">
                                <td colSpan={8} className="px-4 py-3">
                                  <div className="text-xs text-[var(--text-secondary)] mb-2 font-medium">
                                    Position probability distribution
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {Object.entries(team.position_distribution)
                                      .sort(([a], [b]) => Number(a) - Number(b))
                                      .map(([pos, prob]) => {
                                        const pct = (prob as number) * 100;
                                        const bg = Number(pos) <= 4 ? 'bg-[var(--accent-primary)]' :
                                                   Number(pos) > simulationResults.standings.length - 3 ? 'bg-[var(--accent-loss)]' :
                                                   'bg-[var(--accent-ai)]';
                                        return (
                                          <div key={pos} className="text-center min-w-[36px]">
                                            <div
                                              className={`${bg} rounded-t`}
                                              style={{ height: `${Math.max(4, pct * 1.5)}px`, opacity: Math.max(0.3, pct / 50) }}
                                            />
                                            <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{pos}</div>
                                            <div className="text-[10px] text-[var(--text-secondary)]">{pct.toFixed(1)}%</div>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </td>
                              </tr>
                            )}
                            </React.Fragment>
                          ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Legend */}
                  <div className="p-4 flex gap-6 text-xs text-[var(--text-tertiary)] border-t border-[var(--border-color)]">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-[var(--accent-primary)] rounded" />
                      <span>Champions League</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-[var(--accent-loss)] rounded" />
                      <span>Relegation Zone</span>
                    </div>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="p-4 rounded-xl bg-[var(--accent-warn)]/10 border border-[var(--accent-warn)]/20">
                  <p className="text-sm text-[var(--accent-warn)] text-center">
                    <span className="font-semibold">Note:</span> Predictions are based on Monte Carlo simulations using current standings, provider fixtures when available, and team ratings.
                    Actual results may vary significantly due to injuries, transfers, and unpredictable events.
                  </p>
                </div>
              </div>
            )}

            {/* Initial state - no simulation run yet */}
            {!simulationResults && !runningSimulation && (
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] p-8 text-center">
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
              data.news.filter(item => item.link).map((item, idx) => (
                <a 
                  key={idx} 
                  href={item.link} 
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
                      <p className="text-xs text-[var(--text-tertiary)] mt-2">
                        {formatDistanceToNow(new Date(item.published), { addSuffix: true })}
                      </p>
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
