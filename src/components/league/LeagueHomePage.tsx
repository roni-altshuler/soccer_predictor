'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import MatchCalendar from '@/components/match/MatchCalendar'
import JusticeLedger from '@/components/league/JusticeLedger'
import SeasonProjections from '@/components/league/SeasonProjections'
import SeasonSimulationResults, {
  SeasonSimulationSkeleton,
} from '@/components/simulator/SeasonSimulationResults'
import {
  UNIVERSE_SAMPLE_REQUEST,
  type UniverseFindSelection,
} from '@/components/simulator/UniverseBrowser'
import type { FixtureOverrideSelection } from '@/components/simulator/WhatIfLab'
import { fetchLeagueTeamMeta, type TeamMeta } from '@/components/simulator/shared'
import type { LeagueSimulationResult } from '@/lib/api'

import { LeagueMark, ProbBar, SectionHeader, StatusChip, TeamBadge } from '@/components/primitives'
import { EmptyState } from '@/components/EmptyState'
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
  homeTeamId?: string
  awayTeamId?: string
  date: string
  time: string
  venue?: string
}

interface RecentMatch {
  id: string
  homeTeam: string
  awayTeam: string
  homeTeamId?: string
  awayTeamId?: string
  homeScore: number
  awayScore: number
  date: string
}

/** Committed model pick for a match, keyed by provider match id. */
interface CommittedPick {
  home: number
  draw: number
  away: number
  scoreline?: string
  winnerCorrect?: boolean | null
}

/* Loose provider payload shapes — ESPN's JSON varies by league, so these
 * are intentionally permissive partial schemas covering only the fields we
 * actually read. */

interface EspnStandingEntry {
  team?: { id?: number; displayName?: string }
  stats?: Array<{ name?: string; value?: string | number }>
}

interface RawStandingRow {
  position?: number
  team?: string
  name?: string
  team_name?: string
  id?: number
  played?: number
  won?: number
  wins?: number
  drawn?: number
  draws?: number
  lost?: number
  losses?: number
  goalsFor?: number
  goalsAgainst?: number
  goalDifference?: number
  goalConDiff?: number
  points?: number
  pts?: number
  form?: string[]
}

interface EspnCompetitor {
  homeAway?: string
  score?: string
  team?: { id?: number | string; displayName?: string }
}

interface RawScorerRow {
  rank?: number
  name?: string
  team?: string
  goals?: number
  assists?: number | null
  matches?: number | null
}

interface RawNewsItem {
  headline?: string
  title?: string
  description?: string
  summary?: string
  links?: { web?: { href?: string } }
  url?: string
  images?: Array<{ url?: string }>
  image?: string
  published?: string
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

function MatchStrip({
  match,
  mode,
  pick,
}: {
  match: UpcomingMatch | RecentMatch
  mode: 'upcoming' | 'result'
  pick?: CommittedPick
}) {
  const isResult = mode === 'result'
  const result = match as RecentMatch
  const upcoming = match as UpcomingMatch
  const homeWon = isResult && result.homeScore > result.awayScore
  const awayWon = isResult && result.awayScore > result.homeScore

  return (
    <Link
      href={`/matches/${match.id}`}
      className="block min-h-[44px] px-4 py-3 transition-colors hover:bg-[var(--card-hover)]"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex min-w-0 items-center justify-end gap-2 text-right">
          <p className={`truncate text-sm font-semibold ${homeWon ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
            {match.homeTeam}
          </p>
          <TeamBadge teamId={match.homeTeamId} name={match.homeTeam} size={20} />
        </div>
        <div className="min-w-[84px] text-center">
          {isResult ? (
            <>
              <p className="font-mono text-lg font-black tabular-nums text-[var(--text-primary)]">
                {result.homeScore}-{result.awayScore}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">FT</p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold tabular-nums text-[var(--accent-ai)]">{upcoming.time || 'TBD'}</p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{formatShortDate(upcoming.date)}</p>
            </>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-left">
          <TeamBadge teamId={match.awayTeamId} name={match.awayTeam} size={20} />
          <p className={`truncate text-sm font-semibold ${awayWon ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
            {match.awayTeam}
          </p>
        </div>
      </div>
      {(pick || (!isResult && upcoming.venue)) && (
        <div className="mt-2 flex items-center gap-3">
          {pick && <ProbBar home={pick.home} draw={pick.draw} away={pick.away} size="sm" className="max-w-[220px]" />}
          {pick?.scoreline && !isResult && (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
              style={{
                color: 'var(--accent-ai)',
                backgroundColor: 'color-mix(in srgb, var(--accent-ai) 12%, transparent)',
              }}
            >
              AI {pick.scoreline}
            </span>
          )}
          {pick && isResult && typeof pick.winnerCorrect === 'boolean' && (
            <StatusChip status={pick.winnerCorrect ? 'correct' : 'incorrect'} />
          )}
          {!isResult && upcoming.venue && (
            <span className="min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">{upcoming.venue}</span>
          )}
        </div>
      )}
    </Link>
  )
}

/** Last-five form pip — token colours via color-mix (light-mode safe). */
function FormPip({ result }: { result: string }) {
  const accent =
    result === 'W'
      ? 'var(--accent-primary)'
      : result === 'D'
        ? 'var(--accent-warn)'
        : result === 'L'
          ? 'var(--accent-loss)'
          : 'var(--text-tertiary)'
  return (
    <span
      className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold"
      style={{
        color: accent,
        backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)`,
      }}
    >
      {result}
    </span>
  )
}

/** Standings-zone marker: a small token-coloured dot before the position. */
function ZoneDot({ color }: { color?: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? 'transparent' }}
    />
  )
}

export default function LeagueHomePage({ leagueId, leagueName, country }: LeagueHomePageProps) {
  const [data, setData] = useState<LeagueHomeData | null>(null)
  const [picks, setPicks] = useState<Record<string, CommittedPick>>({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'standings' | 'scorers' | 'fixtures' | 'simulator' | 'news'>('overview')
  const { asQueryParam: genderParam } = useGenderQuery()
  const isMLS = leagueId === 'usa.1' || leagueId === 'mls'
  const isCalendarYear = CALENDAR_YEAR_LEAGUE_IDS.has(leagueId)
  const seasons = isCalendarYear ? MLS_SEASONS : AVAILABLE_SEASONS
  const [selectedSeason, setSelectedSeason] = useState(isCalendarYear ? '2026' : '2025')
  const [runningSimulation, setRunningSimulation] = useState(false)
  const [numSimulations, setNumSimulations] = useState(10000)
  const [simulationResults, setSimulationResults] = useState<LeagueSimulationResult | null>(null)
  const [simBaseline, setSimBaseline] = useState<LeagueSimulationResult | null>(null)
  const [simOverride, setSimOverride] = useState<FixtureOverrideSelection | null>(null)
  const [simFind, setSimFind] = useState<UniverseFindSelection | null>(null)
  const [simError, setSimError] = useState<string | null>(null)
  const [simTeamMeta, setSimTeamMeta] = useState<Record<string, TeamMeta>>({})
  const [simRunToken, setSimRunToken] = useState(0)

  // Single source of truth for league brand: getLeagueAccent() resolves
  // ESPN-style IDs, underscore IDs, FotMob numeric IDs, and display names
  // to a unified LeagueAccent record (accent colour, flag, logo, etc.).
  const leagueAccent = getLeagueAccent(leagueId)
  const leagueLogo = leagueAccent.logoUrl

  // State-safety fix: when the user changes gender, league, or season, any
  // previously-run simulation results are now stale (they describe the
  // *previous* universe). Clear them so the auto-run below refetches against
  // the fresh context rather than showing mismatched cards.
  useEffect(() => {
    setSimulationResults(null)
    setSimBaseline(null)
    setSimOverride(null)
    setSimFind(null)
    setSimError(null)
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

  // Numeric simulation id must be a real mapping — no fallback. Leagues
  // outside the map (e.g. women's competitions) get an honest empty state
  // in the Simulator tab instead of silently simulating the wrong league.
  const numericLeagueId: number | undefined = LEAGUE_NUMERIC_ID_MAP[leagueId]

  // Crest ids + brand colours for the simulator views — same ESPN standings
  // feed the simulation route parses, so team names line up exactly.
  useEffect(() => {
    if (!numericLeagueId) return
    const controller = new AbortController()
    setSimTeamMeta({})
    fetchLeagueTeamMeta(getEspnLeagueId(), controller.signal).then(setSimTeamMeta)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, numericLeagueId])

  // Season simulation auto-run — fires on mount, league/season/universe
  // change, run-depth change, what-if override, and manual re-run. The
  // Overview tab's projections and the Simulator tab both read the result.
  // Effect-triggered (never state-triggered), so a failed run can't loop.
  const autoSimKey = `${leagueId}:${selectedSeason}:${genderParam}`
  useEffect(() => {
    if (!numericLeagueId) return
    const controller = new AbortController()
    let cancelled = false

    async function run() {
      setRunningSimulation(true)
      setSimError(null)
      try {
        const params = new URLSearchParams({
          n_simulations: String(numSimulations),
          universes: String(UNIVERSE_SAMPLE_REQUEST),
        })
        if (simOverride) {
          params.set('what_if_fixture', simOverride.fixtureKey)
          params.set('what_if_outcome', simOverride.outcome)
        }
        if (simFind) {
          params.set('find_team', simFind.team)
          params.set('find_outcome', simFind.outcome)
        }
        const res = await fetch(`/api/simulation/${numericLeagueId}?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('The simulation is unavailable right now')
        const data = (await res.json()) as LeagueSimulationResult
        if (cancelled) return
        if (!Array.isArray(data.standings) || data.standings.length === 0) {
          throw new Error('The simulation returned no standings')
        }
        setSimulationResults(data)
        // Runs without an override are the delta baseline for the what-if lab.
        if (!simOverride) setSimBaseline(data)
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        setSimError(
          err instanceof Error ? err.message : 'The simulation is unavailable right now',
        )
      } finally {
        if (!cancelled) setRunningSimulation(false)
      }
    }

    run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [autoSimKey, numericLeagueId, numSimulations, simOverride, simFind, simRunToken])

  const changeSimCount = (n: number) => {
    setNumSimulations(n)
    // A different run depth is a different baseline — clear any override.
    setSimBaseline(null)
    setSimOverride(null)
    setSimFind(null)
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

        // Leaders goes through our own /api/leagues/leaders proxy: ESPN's
        // leaders endpoint has no CORS headers, so a browser fetch dies.
        const espnResults = await Promise.allSettled([
          fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${espnLeagueId}/standings${seasonParam}`),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/scoreboard?dates=${scoreboardDateRange}`),
          fetch(`/api/leagues/leaders?league=${encodeURIComponent(espnLeagueId)}${selectedSeason ? `&season=${encodeURIComponent(selectedSeason)}` : ''}`),
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
            const allEntries: EspnStandingEntry[] = []
            for (const child of children) {
              const entries = child?.standings?.entries || []
              allEntries.push(...entries)
            }
            if (allEntries.length > 0) {
              leagueData.standings = allEntries.map((entry: EspnStandingEntry, idx: number) => {
                const getStatVal = (name: string) => {
                  const stat = entry.stats?.find((s) => s.name === name)
                  return parseInt(String(stat?.value ?? '0'), 10)
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
          leagueData.standings = (standingsJson.standings || []).map((s: RawStandingRow, idx: number) => ({
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
              
              const homeTeam = competition.competitors?.find((c: EspnCompetitor) => c.homeAway === 'home')
              const awayTeam = competition.competitors?.find((c: EspnCompetitor) => c.homeAway === 'away')
              const matchDate = new Date(event.date)
              const statusType = competition.status?.type?.name || ''
              
              const isFinished = statusType.includes('FINAL') || statusType.includes('FULL_TIME')
              
              if (isFinished) {
                leagueData.recentResults.push({
                  id: String(event.id),
                  homeTeam: homeTeam?.team?.displayName || 'Home',
                  awayTeam: awayTeam?.team?.displayName || 'Away',
                  homeTeamId: homeTeam?.team?.id ? String(homeTeam.team.id) : undefined,
                  awayTeamId: awayTeam?.team?.id ? String(awayTeam.team.id) : undefined,
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
                  homeTeamId: homeTeam?.team?.id ? String(homeTeam.team.id) : undefined,
                  awayTeamId: awayTeam?.team?.id ? String(awayTeam.team.id) : undefined,
                  date: matchDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                  time: matchDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                  venue: competition.venue?.fullName,
                })
              }
            }
            // Sort recent results by date descending (newest first)
            leagueData.recentResults.sort(
              (a, b) =>
                ((b as RecentMatch & { _rawDate?: number })._rawDate || 0) -
                ((a as RecentMatch & { _rawDate?: number })._rawDate || 0)
            )
          }
        }

        // Top scorers now come from our same-origin /api/leagues/leaders
        // proxy (which handles ESPN's leaders + statistics fallbacks
        // server-side, where CORS doesn't apply).
        if (espnResults[2].status === 'fulfilled') {
          const leadersProxy = espnResults[2] as PromiseFulfilledResult<Response>
          if (leadersProxy.value.ok) {
            const leadersData = await leadersProxy.value.json()
            const scorers = Array.isArray(leadersData?.scorers) ? leadersData.scorers : []
            if (scorers.length > 0) {
              leagueData.topScorers = scorers.map((s: RawScorerRow, idx: number) => ({
                rank: s.rank ?? idx + 1,
                name: s.name ?? 'Unknown',
                team: s.team ?? '',
                goals: s.goals ?? 0,
                assists: s.assists ?? null,
                matches: s.matches ?? null,
              }))
              leagueData.topScorerSource = 'ESPN leaders'
            }
          }
        }

        // Fallback only: when the live leaders proxy came back empty, the
        // dedicated top-scorers route (which can serve a verified curated
        // list) fills the gap. Live provider data always wins over curated.
        if (leagueData.topScorers.length === 0) {
          try {
            const leagueParam = leagueId.includes('.')
              ? leagueId
              : LEAGUE_TO_ESPN_ID[leagueId] || leagueId
            const scorersRes = await fetch(`/api/top-scorers/${leagueParam}?season=${selectedSeason}`)
            if (scorersRes.ok) {
              const scorersData = await scorersRes.json()
              if (scorersData.scorers && scorersData.scorers.length > 0) {
                leagueData.topScorers = scorersData.scorers.map((s: RawScorerRow, idx: number) => ({
                  rank: s.rank ?? idx + 1,
                  name: s.name ?? 'Unknown',
                  team: s.team ?? '',
                  goals: s.goals ?? 0,
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
        }

        // Process league-specific news from ESPN
        try {
          const espnNewsRes = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/news`,
            { next: { revalidate: 300 } }
          )
          if (espnNewsRes.ok) {
            const espnNewsData = await espnNewsRes.json()
            leagueData.news = (espnNewsData.articles || []).slice(0, 8).map((n: RawNewsItem) => ({
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
            leagueData.news = (newsJson.articles || newsJson.news || []).slice(0, 5).map((n: RawNewsItem) => ({
              headline: n.headline || n.title || '',
              description: n.description || n.summary || '',
              link: n.links?.web?.href || n.url || '',
              image: n.images?.[0]?.url || n.image || '',
              published: n.published || '',
            }))
          }
        }

        // Committed model picks for this league (from the tracked prediction
        // JSON) — keyed by provider match id so fixture rows can render the
        // signature ProbBar + AI scoreline chip / correct-incorrect chip.
        try {
          const picksRes = await fetch(
            `/api/v1/tracking/recent?league=${encodeURIComponent(leagueName)}&limit=200`
          )
          if (picksRes.ok) {
            const picksJson = await picksRes.json()
            const map: Record<string, CommittedPick> = {}
            for (const p of picksJson.predictions || []) {
              if (!p?.match_id) continue
              map[String(p.match_id)] = {
                home: p.predicted_home_win ?? 0,
                draw: p.predicted_draw ?? 0,
                away: p.predicted_away_win ?? 0,
                scoreline: p.predicted_scoreline || undefined,
                winnerCorrect: p.winner_correct ?? null,
              }
            }
            setPicks(map)
          } else {
            setPicks({})
          }
        } catch {
          setPicks({})
        }

        setData(leagueData)
      } catch (error) {
        console.error('Error fetching league data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchLeagueData()
    // getEspnLeagueId / seasons / isCalendarYear are all derived from
    // leagueId, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, leagueName, country, selectedSeason, genderParam])

  if (loading) {
    return (
      <div className="flex-1" style={{ backgroundColor: 'var(--background)' }} aria-busy="true">
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
          <div className="h-44 animate-pulse rounded-xl bg-[var(--muted-bg)]" />
          <div className="h-10 w-2/3 animate-pulse rounded-lg bg-[var(--muted-bg)]" />
          <div className="h-72 animate-pulse rounded-xl bg-[var(--muted-bg)]" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1" style={{ backgroundColor: 'var(--background)' }}>
      {/* Flat league header — crest, name, country line, season picker. */}
      <div className="border-b border-[var(--border-color)] bg-[var(--card-bg)]">
        <div className="mx-auto max-w-6xl px-4 pb-3">
          <Link
            href="/matches"
            className="inline-flex min-h-[40px] items-center gap-1 text-[12px] font-semibold text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            All leagues
          </Link>

          <div className="flex items-center gap-3">
            {leagueLogo ? (
              <LeagueMark league={leagueAccent.competitionId} size="lg" />
            ) : (
              <span
                aria-hidden
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg font-bold"
                style={{
                  color: leagueAccent.accent,
                  backgroundColor: `color-mix(in srgb, ${leagueAccent.accent} 14%, transparent)`,
                }}
              >
                {leagueName.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold tracking-tight text-[var(--text-primary)]">
                {leagueName}
              </h1>
              <p className="text-[12px] text-[var(--text-tertiary)]">
                {country} · {leagueAccent.shortName} ·{' '}
                {seasons.find(s => s.value === selectedSeason)?.label || (isCalendarYear ? '2026' : '2025-26')}
              </p>
            </div>

            <label className="shrink-0">
              <span className="sr-only">Season</span>
              <select
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(e.target.value)}
                className="h-11 appearance-none rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 pr-8 text-[13px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)] focus:border-[var(--accent-primary)] focus:outline-none"
                style={{
                  backgroundImage:
                    'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23888\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 0.6rem center',
                }}
              >
                {seasons.map(season => (
                  <option key={season.value} value={season.value} className="bg-[var(--card-bg)] text-[var(--text-primary)]">
                    {season.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Underline tabs (tab grammar, not pill grammar) */}
        <div
          role="tablist"
          aria-label="League sections"
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {(['overview', 'standings', 'scorers', 'fixtures', 'simulator', 'news'] as const).map((tab) => {
            const active = activeTab === tab
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab)}
                className={`relative min-h-[44px] whitespace-nowrap px-3 text-[13px] font-semibold capitalize transition-colors ${
                  active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {TAB_LABELS[tab] || tab}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--accent-primary)]"
                  />
                )}
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
              {simulationResults && simulationResults.standings.length > 0 ? (
                <SeasonProjections
                  teams={simulationResults.standings}
                  nSimulations={simulationResults.n_simulations}
                />
              ) : runningSimulation ? (
                <div className="flex items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-5 text-sm text-[var(--text-secondary)]">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent-primary)] border-t-transparent" />
                  Simulating the rest of the season…
                </div>
              ) : null}

              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
                <SectionHeader
                  kicker="Schedule"
                  title="Upcoming Matches"
                  className="border-b border-[var(--border-color)] px-4 py-3"
                  action={
                    <button
                      onClick={() => setActiveTab('fixtures')}
                      className="min-h-[40px] rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
                    >
                      Calendar
                    </button>
                  }
                />
                <div className="divide-y divide-[var(--border-color)]">
                  {data?.upcomingMatches && data.upcomingMatches.length > 0 ? (
                    data.upcomingMatches.slice(0, 5).map((match) => (
                      <MatchStrip key={match.id} match={match} mode="upcoming" pick={picks[match.id]} />
                    ))
                  ) : (
                    <EmptyState
                      title="No upcoming matches"
                      description="Nothing is scheduled in the next two weeks — check the fixtures calendar for the full season."
                      className="py-8"
                    />
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
                <SectionHeader
                  kicker="Form Check"
                  title="Recent Results"
                  className="border-b border-[var(--border-color)] px-4 py-3"
                />
                <div className="divide-y divide-[var(--border-color)]">
                  {data?.recentResults && data.recentResults.length > 0 ? (
                    data.recentResults.slice(0, 5).map((match) => (
                      <MatchStrip key={match.id} match={match} mode="result" pick={picks[match.id]} />
                    ))
                  ) : (
                    <EmptyState
                      title="No recent results"
                      description="No matches finished in the last ten days."
                      className="py-8"
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
                <SectionHeader
                  kicker="Table"
                  title="Standings"
                  className="border-b border-[var(--border-color)] px-4 py-3"
                  action={
                    <button
                      onClick={() => setActiveTab('standings')}
                      className="min-h-[40px] px-1 text-xs font-semibold text-[var(--accent-primary)] hover:underline"
                    >
                      View All
                    </button>
                  }
                />
                <div className="divide-y divide-[var(--border-color)]/40">
                  {data?.standings.slice(0, 5).map((team, idx) => (
                    <div key={team.teamName} className="flex min-h-[44px] items-center gap-2 px-3 py-2">
                      <ZoneDot
                        color={
                          idx < 4
                            ? 'var(--accent-primary)'
                            : idx < 6
                              ? 'var(--accent-info)'
                              : undefined
                        }
                      />
                      <span className="w-4 text-center text-[13px] tabular-nums text-[var(--text-tertiary)]">{idx + 1}</span>
                      <TeamBadge teamId={team.teamId} name={team.teamName} size={18} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-primary)]">{team.teamName}</span>
                      {team.form && team.form.length > 0 ? (
                        <span className="hidden items-center gap-0.5 sm:flex">
                          {team.form.slice(-5).map((result, formIndex) => (
                            <FormPip key={`${team.teamName}-preview-${formIndex}`} result={result} />
                          ))}
                        </span>
                      ) : null}
                      <span className="w-8 text-right text-[13px] font-bold tabular-nums text-[var(--text-primary)]">{team.points}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Latest News */}
              {data?.news && data.news.length > 0 && (
                <div className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  <SectionHeader
                    kicker="Coverage"
                    title="Latest News"
                    className="p-4 border-b border-[var(--border-color)]"
                  />
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
                          /* eslint-disable-next-line @next/next/no-img-element -- remote ESPN news art, host not whitelisted for next/image */
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
                    <div key={conference} className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                      <div className="border-b border-[var(--border-color)]/40 bg-[var(--background-secondary)]/60 px-3 py-2">
                        <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{conference}</h2>
                      </div>
                      <div className="max-h-[560px] overflow-auto">
                        <table className="w-full text-[13px] tabular-nums">
                          <thead className="sticky top-0 z-10 bg-[var(--card-bg)]">
                            <tr className="border-b border-[var(--border-color)] text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                              <th className="text-left py-2 pl-3 pr-1 font-semibold">#</th>
                              <th className="text-left py-2 px-2 font-semibold">Team</th>
                              <th className="text-right py-2 px-2 font-semibold">P</th>
                              <th className="text-right py-2 px-3 font-semibold">Pts</th>
                              <th className="text-center py-2 px-2 font-semibold hidden sm:table-cell">Form</th>
                            </tr>
                          </thead>
                          <tbody>
                            {conferenceTeams.length > 0 ? conferenceTeams.map((team, idx) => {
                              const zoneColor =
                                idx < 7
                                  ? 'var(--accent-primary)' // Playoff spots
                                  : idx < 9
                                    ? 'var(--accent-warn)' // Wild card
                                    : undefined

                              return (
                                <tr key={team.teamName} className="border-b border-[var(--border-color)]/40 last:border-b-0 hover:bg-[var(--card-hover)]">
                                  <td className="py-2 pl-3 pr-1 text-[var(--text-secondary)]">
                                    <span className="flex items-center gap-1.5">
                                      <ZoneDot color={zoneColor} />
                                      {idx + 1}
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 font-medium text-[var(--text-primary)]">
                                    <span className="flex items-center gap-2">
                                      <TeamBadge teamId={team.teamId} name={team.teamName} size={18} />
                                      <span className="truncate">{team.teamName}</span>
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{team.played}</td>
                                  <td className="py-2 px-3 text-right font-bold text-[var(--text-primary)]">{team.points}</td>
                                  <td className="py-2 px-2 hidden sm:table-cell">
                                    <div className="flex justify-center gap-0.5">
                                      {team.form && team.form.length > 0 ? (
                                        team.form.slice(-5).map((result, i) => (
                                          <FormPip key={i} result={result} />
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
                      <div className="p-3 border-t text-xs text-[var(--text-tertiary)] flex items-center gap-4" style={{ borderColor: 'var(--border-color)' }}>
                        <span className="inline-flex items-center gap-1.5"><ZoneDot color="var(--accent-primary)" /> Playoff</span>
                        <span className="inline-flex items-center gap-1.5"><ZoneDot color="var(--accent-warn)" /> Wild card</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              // Regular league standings
              <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <SectionHeader
                  kicker="Table"
                  title="League Standings"
                  description="Qualification zones and last-five form."
                  className="p-4 border-b border-[var(--border-color)]"
                  action={
                    <div className="hidden md:flex items-center gap-2 text-[10px]">
                      <span className="px-2 py-1 rounded-full bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)]">UCL</span>
                      <span className="px-2 py-1 rounded-full bg-[color-mix(in_srgb,var(--accent-info)_15%,transparent)] text-[var(--accent-info)]">Europe</span>
                      <span className="px-2 py-1 rounded-full bg-[color-mix(in_srgb,var(--accent-loss)_15%,transparent)] text-[var(--accent-loss)]">Relegation</span>
                    </div>
                  }
                />
                <div className="max-h-[640px] overflow-auto">
                  <table className="w-full text-[13px] tabular-nums">
                    <thead className="sticky top-0 z-10 bg-[var(--card-bg)]">
                      <tr className="border-b border-[var(--border-color)] text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                        <th className="text-left py-2 pl-3 pr-1 font-semibold">#</th>
                        <th className="text-left py-2 px-2 font-semibold">Team</th>
                        <th className="text-right py-2 px-2 font-semibold">P</th>
                        <th className="text-right py-2 px-2 font-semibold">W</th>
                        <th className="text-right py-2 px-2 font-semibold">D</th>
                        <th className="text-right py-2 px-2 font-semibold">L</th>
                        <th className="text-right py-2 px-2 font-semibold">GD</th>
                        <th className="text-right py-2 px-3 font-semibold">Pts</th>
                        <th className="text-center py-2 px-2 font-semibold hidden sm:table-cell">Form</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.standings.map((team, idx) => {
                        // Qualification zones read as a small coloured dot by
                        // the position — no rails, no zebra (v3 table rules).
                        const zoneColor =
                          idx < 4
                            ? 'var(--accent-primary)'
                            : idx >= data.standings.length - 3
                              ? 'var(--accent-loss)'
                              : idx < 6
                                ? 'var(--accent-info)'
                                : undefined

                        return (
                          <tr
                            key={team.teamName}
                            className="border-b border-[var(--border-color)]/40 transition-colors last:border-b-0 hover:bg-[var(--card-hover)]"
                          >
                            <td className="py-2 pl-3 pr-1 text-[var(--text-secondary)]">
                              <span className="flex items-center gap-1.5">
                                <ZoneDot color={zoneColor} />
                                {team.position}
                              </span>
                            </td>
                            <td className="py-2 px-2">
                              {team.teamId ? (
                                <Link
                                  href={`/teams/${team.teamId}`}
                                  className="flex items-center gap-2 font-medium text-[var(--text-primary)] hover:text-[var(--accent-primary)]"
                                >
                                  <TeamBadge teamId={team.teamId} name={team.teamName} size={18} />
                                  <span className="truncate">{team.teamName}</span>
                                </Link>
                              ) : (
                                <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                                  <TeamBadge name={team.teamName} size={18} />
                                  <span className="truncate">{team.teamName}</span>
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{team.played}</td>
                            <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{team.won}</td>
                            <td className="py-2 px-2 text-right text-[var(--text-tertiary)]">{team.drawn}</td>
                            <td className="py-2 px-2 text-right text-[var(--text-tertiary)]">{team.lost}</td>
                            <td
                              className={`py-2 px-2 text-right ${
                                team.goalDiff > 0
                                  ? 'text-[var(--accent-primary)]'
                                  : team.goalDiff < 0
                                    ? 'text-[var(--accent-loss)]'
                                    : 'text-[var(--text-secondary)]'
                              }`}
                            >
                              {team.goalDiff > 0 ? `+${team.goalDiff}` : team.goalDiff}
                            </td>
                            <td className="py-2 px-3 text-right font-bold text-[var(--text-primary)]">{team.points}</td>
                            <td className="py-2 px-2 hidden sm:table-cell">
                              <div className="flex justify-center gap-0.5">
                                {team.form && team.form.length > 0 ? (
                                  team.form.slice(-5).map((result, i) => (
                                    <FormPip key={i} result={result} />
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
                <div className="p-3 border-t flex flex-wrap items-center gap-4 text-xs text-[var(--text-tertiary)]" style={{ borderColor: 'var(--border-color)' }}>
                  <span className="inline-flex items-center gap-1.5"><ZoneDot color="var(--accent-primary)" /> Champions League</span>
                  <span className="inline-flex items-center gap-1.5"><ZoneDot color="var(--accent-info)" /> Europa League</span>
                  <span className="inline-flex items-center gap-1.5"><ZoneDot color="var(--accent-loss)" /> Relegation</span>
                </div>
              </div>
            )}

            {/* Justice ledger — luck-adjusted table; renders nothing unless
                this competition-season cleared the xG coverage gates. */}
            <JusticeLedger
              competition={genderParam === 'F' ? `${leagueId}.w` : leagueId}
              season={selectedSeason}
            />
          </div>
        )}

        {activeTab === 'scorers' && (
          <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
            <SectionHeader
              kicker="Golden Boot"
              title="Top Scorers"
              description={data?.season || (isCalendarYear ? '2026' : '2025-26')}
              className="p-4 border-b border-[var(--border-color)]"
            />
            {data?.topScorers && data.topScorers.length > 0 ? (
              <div className="divide-y divide-[var(--border-color)]/40">
                {data.topScorers.map((scorer) => (
                  <div key={scorer.name} className="flex min-h-[48px] items-center gap-3 px-3 py-2 hover:bg-[var(--card-hover)]">
                    <span className="w-5 shrink-0 text-center text-[12px] tabular-nums text-[var(--text-tertiary)]">
                      {scorer.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{scorer.name}</p>
                      <p className="truncate text-[11px] text-[var(--text-tertiary)]">{scorer.team}</p>
                    </div>
                    {scorer.assists != null ? (
                      <span className="hidden shrink-0 text-[12px] tabular-nums text-[var(--text-tertiary)] sm:inline">
                        {scorer.assists} A
                      </span>
                    ) : null}
                    <span className="w-10 shrink-0 text-right text-[13px] font-bold tabular-nums text-[var(--text-primary)]">
                      {scorer.goals}
                      <span className="ml-1 text-[10px] font-semibold text-[var(--text-tertiary)]">G</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No scorer data yet"
                description="The provider hasn't published goal leaders for this season — check back once matches are underway."
                className="py-10"
              />
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
          <div className="space-y-5">
            {/* Controls — the league is fixed by the page; the simulation runs itself. */}
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <SectionHeader
                  kicker="Simulator"
                  title="Season simulation"
                  description={`Every remaining ${leagueName} fixture, played out thousands of times from today's table.`}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    htmlFor="league-page-n-simulations"
                    className="text-[12px] text-[var(--text-secondary)]"
                  >
                    Season runs
                  </label>
                  <select
                    id="league-page-n-simulations"
                    value={numSimulations}
                    onChange={(e) => changeSimCount(Number(e.target.value))}
                    className="min-h-[44px] rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 text-[13px] tabular-nums text-[var(--text-primary)]"
                  >
                    <option value={1000}>1,000</option>
                    <option value={5000}>5,000</option>
                    <option value={10000}>10,000</option>
                    <option value={25000}>25,000</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setSimRunToken((t) => t + 1)}
                    disabled={runningSimulation || !numericLeagueId}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw
                      className={`h-3.5 w-3.5 ${runningSimulation ? 'motion-safe:animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    Re-run
                  </button>
                  {runningSimulation && simulationResults && (
                    <span className="text-[12px] text-[var(--text-tertiary)]" aria-live="polite">
                      Updating…
                    </span>
                  )}
                </div>
              </div>
            </div>

            {!numericLeagueId && (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
                <EmptyState
                  illustration="searching"
                  title="Simulation not available"
                  description="Season simulation doesn't cover this competition yet."
                />
              </div>
            )}

            {/* Inline error over stale results; full empty state when nothing to show. */}
            {numericLeagueId && simError && simulationResults && (
              <div
                role="alert"
                className="rounded-xl border border-[color-mix(in_srgb,var(--accent-loss)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-loss)_10%,transparent)] p-3.5 text-[13px] text-[var(--accent-loss)]"
              >
                {simError} — showing the last completed run.
              </div>
            )}
            {numericLeagueId && simError && !simulationResults && !runningSimulation && (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
                <EmptyState
                  illustration="data-error"
                  title="Simulation unavailable"
                  description={`${leagueName} standings could not be loaded. Nothing is shown rather than made-up numbers.`}
                  action={
                    <button
                      type="button"
                      onClick={() => setSimRunToken((t) => t + 1)}
                      className="min-h-[44px] rounded-lg border border-[var(--border-color)] px-4 text-[13px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)]"
                    >
                      Try again
                    </button>
                  }
                />
              </div>
            )}

            {numericLeagueId && runningSimulation && !simulationResults && (
              <SeasonSimulationSkeleton />
            )}

            {numericLeagueId && simulationResults && (
              <SeasonSimulationResults
                key={simulationResults.league_id}
                result={simulationResults}
                baseline={simBaseline}
                override={simOverride}
                onOverrideChange={setSimOverride}
                loading={runningSimulation}
                teamMeta={simTeamMeta}
                onFindUniverse={(team, outcome) => setSimFind({ team, outcome })}
              />
            )}
          </div>
        )}

        {activeTab === 'news' && (
          data?.news && data.news.filter(item => item.link).length > 0 ? (
            <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
              <ul className="divide-y divide-[var(--border-color)]/40">
                {data.news.filter(item => item.link).map((item, idx) => (
                  <li key={idx}>
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex min-h-[64px] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--card-hover)]"
                    >
                      {item.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element -- remote ESPN news art, host not whitelisted for next/image */
                        <img
                          src={item.image}
                          alt=""
                          loading="lazy"
                          className="aspect-video w-24 flex-shrink-0 rounded-md object-cover sm:w-28"
                        />
                      ) : (
                        <span className="aspect-video w-24 flex-shrink-0 rounded-md bg-[var(--muted-bg)] sm:w-28" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-[var(--text-primary)] group-hover:text-[var(--accent-primary)]">
                          {item.headline}
                        </span>
                        {item.published && (
                          <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                            {formatDistanceToNow(new Date(item.published), { addSuffix: true })}
                          </span>
                        )}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="bg-[var(--card-bg)] border rounded-xl p-8 text-center" style={{ borderColor: 'var(--border-color)' }}>
              <p className="text-[var(--text-tertiary)]">No news available</p>
            </div>
          )
        )}
      </div>
    </div>
  )
}
