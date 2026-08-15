import type { RecordedForecast } from '@/lib/server/recordedForecast'
import type { MatchCard } from '@/lib/server/tieFixtures'

import type { LiveWinProbabilityResult } from '@/lib/liveWinProbability'

/**
 * Shared types for the match-detail surface. The page fetches `/api/match/[id]`
 * and threads a single `MatchDetails` object into the tab components under
 * `src/components/match/detail/`.
 */

export interface MatchEvent {
  type:
    | 'goal'
    | 'assist'
    | 'yellow_card'
    | 'red_card'
    | 'substitution'
    | 'var'
    | 'penalty_missed'
    | 'own_goal'
  minute: number
  addedTime?: number
  player: string
  team: 'home' | 'away'
  relatedPlayer?: string
  description?: string
}

export interface TeamStanding {
  position: number
  played: number
  won: number
  drawn: number
  lost: number
  points: number
  teamName?: string
  /** ESPN team id — powers crests in the Table tab. */
  teamId?: string
  goalsFor?: number
  goalsAgainst?: number
  goalDiff?: number
  /** Last-5 form string ("WDLWW") when the standings feed publishes one. */
  form?: string
  /** Qualification/relegation zone note from the standings feed. */
  note?: { color?: string; description?: string }
}

export interface PlayerLineup {
  name: string
  position?: string
  jersey?: number
  /** Provider player id — powers headshots. */
  id?: string
  captain?: boolean
  /** Provider-published match rating (0–10). */
  rating?: number
}

export interface ExtendedStat {
  key: string
  label: string
  home: number
  away: number
  group: string
  percent?: boolean
}

export interface MomentumPoint {
  minute: number
  value: number
}

export interface ShotmapShot {
  x: number
  y: number
  team: 'home' | 'away'
  expectedGoals?: number
  isGoal?: boolean
  minute?: number
  player?: string
}

export interface MatchDetails {
  id: string
  /** The card `/season/fixture` and `/tournaments/tie` render, unchanged. */
  card?: MatchCard | null
  /** The forecast on file for this fixture, and how it scored. */
  recorded?: RecordedForecast | null
  source?: 'espn' | 'fotmob'
  sourceDetail?: string
  generatedAt?: string
  home_team: string
  away_team: string
  /** ESPN team ids — absent for FotMob-sourced matches (different id namespace). */
  home_team_id?: string
  away_team_id?: string
  home_score: number | null
  away_score: number | null
  status: string
  minute?: number
  addedTime?: number
  venue?: string
  attendance?: number
  capacity?: number
  date: string
  league: string
  leagueId?: string
  referee?: string
  refereeCountry?: string
  events: MatchEvent[]
  lineups: {
    home: PlayerLineup[]
    away: PlayerLineup[]
    homeBench?: PlayerLineup[]
    awayBench?: PlayerLineup[]
    homeCoach?: string
    awayCoach?: string
    homeFormation?: string
    awayFormation?: string
  }
  stats: {
    possession: [number, number]
    shots: [number, number]
    shotsOnTarget: [number, number]
    corners: [number, number]
    fouls: [number, number]
  }
  statsExtended?: ExtendedStat[]
  momentum?: MomentumPoint[]
  shotmap?: ShotmapShot[]
  h2h: {
    homeWins: number
    draws: number
    awayWins: number
    homeGoals?: number
    awayGoals?: number
    recentMatches: {
      home_score: number
      away_score: number
      date: string
      homeTeam?: string
      awayTeam?: string
    }[]
  }
  homeStanding?: TeamStanding
  awayStanding?: TeamStanding
  fullStandings?: TeamStanding[]
  nextResumeTime?: Date
  prediction?: {
    home_win: number
    draw: number
    away_win: number
    predicted_score: { home: number; away: number }
    confidence: number
    total_goals?: number
    over_2_5?: number
    btts_yes?: number
    most_likely_score?: string
    model_version?: string
    confidence_band?: 'Low' | 'Medium' | 'High'
    derived_markets?: {
      over_under?: Record<string, { over: number; under: number }>
      btts?: { yes: number; no: number }
      correct_score_top5?: Array<{ home: number; away: number; probability: number }>
    } | null
    /** "Why this prediction" attribution — present only when the engine explained the pick. */
    attribution?: Array<{ feature: string; value: number; contribution: number }> | null
  }
  liveWinProbability?: LiveWinProbabilityResult
  commentary?: { minute: number; text: string }[]
}

/** Match-detail tabs — FotMob grammar. */
export const DETAIL_TABS = ['overview', 'prediction', 'lineups', 'stats', 'h2h', 'table'] as const
export type DetailTab = (typeof DETAIL_TABS)[number]

export const DETAIL_TAB_LABELS: Record<DetailTab, string> = {
  overview: 'Overview',
  prediction: 'Prediction',
  lineups: 'Lineups',
  stats: 'Stats',
  h2h: 'H2H',
  table: 'Table',
}

/** Legacy deep-link values (?tab=summary|ai|lineup) map onto the new tabs. */
export function normalizeDetailTab(raw: string | null | undefined): DetailTab {
  switch ((raw || '').toLowerCase()) {
    case 'overview':
    case 'summary':
      return 'overview'
    case 'prediction':
    case 'ai':
      return 'prediction'
    case 'lineups':
    case 'lineup':
      return 'lineups'
    case 'stats':
      return 'stats'
    case 'h2h':
      return 'h2h'
    case 'table':
      return 'table'
    default:
      return 'overview'
  }
}

export function formatMatchDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}
