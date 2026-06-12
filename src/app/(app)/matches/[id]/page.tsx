'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Bookmark, BookmarkCheck, ChevronLeft, CircleHelp, CheckCircle2, Clock, MapPin, RefreshCw, Zap } from 'lucide-react'
import { EventTimeline } from '@/components/match/EventTimeline'
import { MetaChipRow } from '@/components/match/MetaChipRow'
import { StickyScoreBar } from '@/components/match/StickyScoreBar'
import { TeamBadge } from '@/components/primitives/TeamBadge'

import { cn } from '@/lib/utils'
import FormationDisplay, { PitchBackground, SubstitutesBench } from '@/components/lineup/FormationDisplay'
import MatchWeather from '@/components/weather/MatchWeather'
import { HeadToHeadDisplay } from '@/components/match'
import KeyMatchFactors from '@/components/match/KeyMatchFactors'
import MatchMomentum from '@/components/match/MatchMomentum'
import HighlightsLink from '@/components/match/HighlightsLink'
import MatchEventHeatmap from '@/components/match/MatchEventHeatmap'
import LiveProbabilityBar from '@/components/match/LiveProbabilityBar'
import DerivedMarkets from '@/components/match/DerivedMarkets'
import BettingIntelligence from '@/components/match/BettingIntelligence'
import DataSourceBadge from '@/components/DataSourceBadge'
import { type PredictionPayload } from '@/components/prediction/PredictionResult'
import { AIPredictionTab } from '@/components/match/AIPredictionTab'
import { ConfidenceIndicator } from '@/components/match/ConfidenceIndicator'
import { LeagueBadge } from '@/components/match/LeagueBadge'
import { SplitStatBar } from '@/components/match/SplitStatBar'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { WATCHLIST_STORAGE_KEY, normalizeTeamName, type WatchTeam } from '@/lib/watchlist'
import type { LiveWinProbabilityResult, ThreeWayProbabilities } from '@/lib/liveWinProbability'

interface MatchEvent {
  type: 'goal' | 'assist' | 'yellow_card' | 'red_card' | 'substitution' | 'var' | 'penalty_missed' | 'own_goal'
  minute: number
  addedTime?: number
  player: string
  team: 'home' | 'away'
  relatedPlayer?: string
  description?: string
}

interface TeamStanding {
  position: number
  played: number
  won: number
  drawn: number
  lost: number
  points: number
  teamName?: string
}

interface PlayerLineup {
  name: string
  position?: string
  jersey?: number
}

interface MatchDetails {
  id: string
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
  shotmap?: Array<{
    x: number
    y: number
    team: 'home' | 'away'
    expectedGoals?: number
    isGoal?: boolean
    minute?: number
    player?: string
  }>
  h2h: {
    homeWins: number
    draws: number
    awayWins: number
    recentMatches: { home_score: number; away_score: number; date: string; homeTeam?: string; awayTeam?: string }[]
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
  }
  liveWinProbability?: LiveWinProbabilityResult
  commentary?: { minute: number; text: string }[]
}

// AI Prediction promoted to 2nd tab so the model lean is visible
// immediately after the basic match summary, not buried at the end.
const DETAIL_TABS = ['summary', 'ai', 'stats', 'lineup', 'h2h'] as const
type DetailTab = typeof DETAIL_TABS[number]

/**
 * Convert the existing `MatchDetails.prediction` shape — populated by the
 * legacy `/api/matches/[id]` route — into the unified
 * `PredictionPayload` consumed by the showcase visualisation. When the
 * page later wires to `/api/predictions/unified-by-name` directly the
 * adapter goes away.
 */
function adaptMatchPrediction(match: MatchDetails): PredictionPayload {
  const p = match.prediction!
  const total = p.home_win + p.draw + p.away_win || 1
  const norm = {
    home: p.home_win / total,
    draw: p.draw / total,
    away: p.away_win / total,
  }
  const conf = Math.max(0, Math.min(1, (p.confidence ?? 50) / 100))
  const totalGoals = p.total_goals ?? p.predicted_score.home + p.predicted_score.away
  const over25 = p.over_2_5 ?? Math.max(0, Math.min(1, (totalGoals - 1.5) / 2))
  const over15 = Math.max(over25, Math.min(1, (totalGoals - 0.5) / 2))
  const over35 = Math.max(0, Math.min(over25, (totalGoals - 2.5) / 2))
  const btts = p.btts_yes ?? 0.5

  return {
    match_id: match.id,
    home_team: match.home_team,
    away_team: match.away_team,
    league: match.league ?? 'Match',
    outcome: { home_win: norm.home, draw: norm.draw, away_win: norm.away, confidence: conf },
    goals: {
      home_expected_goals: p.predicted_score.home,
      away_expected_goals: p.predicted_score.away,
      total_expected_goals: totalGoals,
      over_1_5: over15,
      over_2_5: over25,
      over_3_5: over35,
      btts_yes: btts,
    },
    most_likely_score: {
      score: p.most_likely_score ?? `${p.predicted_score.home}-${p.predicted_score.away}`,
      home_goals: p.predicted_score.home,
      away_goals: p.predicted_score.away,
      probability: Math.max(norm.home, norm.draw, norm.away),
    },
    alternative_scores: [],
    factors: {
      home_elo: match.homeStanding?.points
        ? 1500 + match.homeStanding.points * 5
        : 1500,
      away_elo: match.awayStanding?.points
        ? 1500 + match.awayStanding.points * 5
        : 1500,
      elo_difference: (match.homeStanding?.points ?? 0) * 5 - (match.awayStanding?.points ?? 0) * 5,
      home_form_score: 0.5,
      away_form_score: 0.5,
      home_advantage: 0.25,
      h2h_advantage:
        match.h2h.homeWins + match.h2h.awayWins > 0
          ? (match.h2h.homeWins - match.h2h.awayWins) /
            (match.h2h.homeWins + match.h2h.awayWins)
          : 0,
      injury_impact: 0,
      rest_days_diff: 0,
      importance_factor: 1.0,
    },
    confidence: {
      data_quality: 0.75,
      model_certainty: conf,
      historical_accuracy: 0.5,
      overall: conf,
    },
    model_version: p.model_version ?? 'unified-multitask',
  }
}

const DETAIL_TAB_LABELS: Record<DetailTab, string> = {
  summary: 'Summary',
  lineup: 'Lineup',
  stats: 'Stats',
  h2h: 'H2H & Form',
  ai: 'AI Prediction',
}

type MatchStats = MatchDetails['stats']

function TeamNameWithCrest({
  name,
  teamId,
  align,
}: {
  name: string
  teamId?: string
  align: 'left' | 'right'
}) {
  const content = (
    <span
      className={cn(
        'flex items-center gap-2.5 min-w-0',
        align === 'right' ? 'flex-row-reverse justify-start' : 'justify-start',
      )}
    >
      <TeamBadge teamId={teamId} name={name} size={32} className="shrink-0" />
      <span className="font-display text-[clamp(1.1rem,2.4vw,1.85rem)] font-bold leading-tight text-[var(--text-primary)] truncate">
        {name}
      </span>
    </span>
  )
  if (!teamId) return content
  return (
    <Link
      href={`/teams/${teamId}`}
      className="block transition-opacity hover:opacity-80"
      aria-label={`${name} team page`}
    >
      {content}
    </Link>
  )
}

function formatStatValue(value: number, suffix?: string, decimals = 0): string {
  const printed = decimals > 0 ? value.toFixed(decimals) : String(value)
  return `${printed}${suffix || ''}`
}

function DuelStatRow({
  label,
  home,
  away,
  suffix,
  inverse = false,
  decimals = 0,
  fixedTotal,
}: {
  label: string
  home: number
  away: number
  suffix?: string
  inverse?: boolean
  decimals?: number
  fixedTotal?: number
}) {
  const total = fixedTotal ?? (home + away)
  const safeTotal = total > 0 ? total : 1
  const homeWidth = (home / safeTotal) * 100
  const awayWidth = (away / safeTotal) * 100
  const homeLeading = inverse ? home < away : home > away
  const awayLeading = inverse ? away < home : away > home

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className={`font-semibold ${homeLeading ? 'text-blue-500' : 'text-[var(--text-secondary)]'}`}>
          {formatStatValue(home, suffix, decimals)}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">{label}</span>
        <span className={`font-semibold ${awayLeading ? 'text-orange-500' : 'text-[var(--text-secondary)]'}`}>
          {formatStatValue(away, suffix, decimals)}
        </span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-[var(--muted-bg)]">
        <div
          className={`transition-all ${homeLeading ? 'bg-blue-500' : 'bg-blue-500/40'}`}
          style={{ width: `${homeWidth}%` }}
        />
        <div
          className={`transition-all ${awayLeading ? 'bg-orange-500' : 'bg-orange-500/40'}`}
          style={{ width: `${awayWidth}%` }}
        />
      </div>
    </div>
  )
}

function FotmobStatsCard({
  stats,
  homeTeam,
  awayTeam,
  compact = false,
}: {
  stats: MatchStats
  homeTeam: string
  awayTeam: string
  compact?: boolean
}) {
  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Top Stats</h3>
        <p className="text-[10px] mt-0.5 text-[var(--text-tertiary)]">Fotmob-style side-by-side match comparison</p>
      </div>

      <div className={compact ? 'p-4 space-y-4' : 'p-5 space-y-4'}>
        <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-primary)]">
          <span className="truncate pr-3">{homeTeam}</span>
          <span className="truncate pl-3 text-right">{awayTeam}</span>
        </div>

        {/* Possession + Shots-on-target render as FotMob-style split bars
            so the share is visible at a glance instead of the older
            numeric-pair DuelStatRow that hid the proportion. */}
        <SplitStatBar
          label="Possession"
          homeValue={stats.possession[0]}
          awayValue={stats.possession[1]}
          format={(v) => `${Math.round(v)}%`}
        />
        <SplitStatBar
          label="Shots on target"
          homeValue={stats.shotsOnTarget[0]}
          awayValue={stats.shotsOnTarget[1]}
        />

        <DuelStatRow label="Total Shots" home={stats.shots[0]} away={stats.shots[1]} />
        <DuelStatRow label="Corners" home={stats.corners[0]} away={stats.corners[1]} />
        <DuelStatRow label="Fouls" home={stats.fouls[0]} away={stats.fouls[1]} inverse />
      </div>
    </div>
  )
}

type PredictionDriverTone = 'positive' | 'neutral' | 'risk'

type PredictionDriver = {
  label: string
  detail: string
  tone: PredictionDriverTone
}

function formatProbability(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatProbabilityDelta(current: number, prior: number): string {
  const delta = Math.round((current - prior) * 100)
  if (delta > 0) return `+${delta} pts`
  if (delta < 0) return `${delta} pts`
  return '0 pts'
}

function probabilityPath(prior: number, current: number): string {
  const toY = (value: number) => Math.min(92, Math.max(8, 96 - value * 88))
  return `M 4 ${toY(prior).toFixed(1)} L 96 ${toY(current).toFixed(1)}`
}

function LiveWinProbabilityPanel({ match }: { match: MatchDetails }) {
  const isCurrentlyLive =
    match.status.includes('IN_PROGRESS') ||
    match.status.includes('HALF') ||
    match.status.includes('LIVE')
  const liveProbability = match.liveWinProbability

  if (!isCurrentlyLive && !liveProbability?.available) return null

  if (!liveProbability?.available || !liveProbability.probabilities || !match.prediction) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
        <div className="p-4 border-b flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: 'var(--border-color)' }}>
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-[var(--accent-ai)]">Live Probability</p>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Awaiting complete live data</h3>
          </div>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-500">
            Guarded
          </span>
        </div>
        <div className="p-4">
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            {liveProbability?.note || 'The app withholds in-match probabilities until score, clock, pre-match prediction, and provider live stats are complete.'}
          </p>
          {liveProbability?.inputs && liveProbability.inputs.length > 0 && (
            <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Inputs ready: {liveProbability.inputs.join(', ')}
            </p>
          )}
        </div>
      </div>
    )
  }

  const prior: ThreeWayProbabilities = {
    home_win: match.prediction.home_win,
    draw: match.prediction.draw,
    away_win: match.prediction.away_win,
  }
  const current = liveProbability.probabilities
  const outcomes = [
    { key: 'home_win' as const, label: match.home_team, shortLabel: 'Home', color: '#10b981' },
    { key: 'draw' as const, label: 'Draw', shortLabel: 'Draw', color: '#f59e0b' },
    { key: 'away_win' as const, label: match.away_team, shortLabel: 'Away', color: '#38bdf8' },
  ]

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-4 border-b flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: 'var(--border-color)' }}>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-[var(--accent-ai)]">Live Probability</p>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">Win-probability shift</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            {liveProbability.minute ?? match.minute ?? 'Live'}&apos;
          </span>
          <span className="rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            {liveProbability.confidence} confidence
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            <span>Pre-match</span>
            <span>Live</span>
          </div>
          <svg viewBox="0 0 100 100" className="h-36 w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Live win probability shift">
            {[25, 50, 75].map((line) => (
              <line key={line} x1="0" x2="100" y1={line} y2={line} stroke="currentColor" strokeOpacity="0.12" vectorEffect="non-scaling-stroke" />
            ))}
            {outcomes.map((outcome) => (
              <path
                key={outcome.key}
                d={probabilityPath(prior[outcome.key], current[outcome.key])}
                fill="none"
                stroke={outcome.color}
                strokeWidth="3"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>

        <div className="mt-4 grid gap-2">
          {outcomes.map((outcome) => {
            const value = current[outcome.key]
            return (
              <div key={outcome.key} className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[var(--text-primary)]">{outcome.label}</p>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{outcome.shortLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-[var(--text-primary)]">{formatProbability(value)}</p>
                    <p className={`text-[10px] font-bold ${value >= prior[outcome.key] ? 'text-emerald-500' : 'text-red-400'}`}>
                      {formatProbabilityDelta(value, prior[outcome.key])}
                    </p>
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--background-secondary)]">
                  <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, backgroundColor: outcome.color }} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">{liveProbability.note}</p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            Inputs: {liveProbability.inputs.join(', ')}
          </p>
        </div>
      </div>
    </div>
  )
}

function getPredictionRank(match: MatchDetails) {
  if (!match.prediction) return []
  return [
    { key: 'home' as const, label: match.home_team, shortLabel: 'Home', value: match.prediction.home_win },
    { key: 'draw' as const, label: 'Draw', shortLabel: 'Draw', value: match.prediction.draw },
    { key: 'away' as const, label: match.away_team, shortLabel: 'Away', value: match.prediction.away_win },
  ].sort((a, b) => b.value - a.value)
}

function buildPredictionDrivers(match: MatchDetails): PredictionDriver[] {
  if (!match.prediction) return []

  const ranked = getPredictionRank(match)
  const leader = ranked[0]
  const runnerUp = ranked[1]
  const margin = leader && runnerUp ? Math.round((leader.value - runnerUp.value) * 100) : 0
  const drivers: PredictionDriver[] = []

  if (leader) {
    drivers.push({
      label: 'Primary lean',
      detail: `${leader.label} leads the market-style outcome grid at ${formatProbability(leader.value)}${runnerUp ? `, ${margin} points above ${runnerUp.shortLabel.toLowerCase()}` : ''}.`,
      tone: margin >= 10 ? 'positive' : 'neutral',
    })
  }

  if (match.homeStanding && match.awayStanding) {
    const positionGap = match.awayStanding.position - match.homeStanding.position
    const pointsGap = match.homeStanding.points - match.awayStanding.points
    const strongerTeam = positionGap > 0 ? match.home_team : positionGap < 0 ? match.away_team : null

    if (strongerTeam) {
      drivers.push({
        label: 'Table context',
        detail: `${strongerTeam} is ${Math.abs(positionGap)} places above the opponent with a ${Math.abs(pointsGap)} point table gap.`,
        tone: Math.abs(positionGap) >= 4 || Math.abs(pointsGap) >= 8 ? 'positive' : 'neutral',
      })
    } else {
      drivers.push({
        label: 'Table context',
        detail: `Both teams are adjacent in the table, so the model does not treat league position as a major separator.`,
        tone: 'neutral',
      })
    }
  }

  const h2hTotal = match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins
  if (h2hTotal > 0) {
    const h2hLeader = [
      { label: match.home_team, wins: match.h2h.homeWins },
      { label: 'Draws', wins: match.h2h.draws },
      { label: match.away_team, wins: match.h2h.awayWins },
    ].sort((a, b) => b.wins - a.wins)[0]

    drivers.push({
      label: 'Head-to-head sample',
      detail: `${h2hLeader.label} has the strongest recent H2H count: ${match.h2h.homeWins}-${match.h2h.draws}-${match.h2h.awayWins} across ${h2hTotal} recorded meetings.`,
      tone: h2hLeader.wins / h2hTotal >= 0.5 ? 'positive' : 'neutral',
    })
  }

  const totalGoals = match.prediction.total_goals ?? (match.prediction.predicted_score.home + match.prediction.predicted_score.away)
  if (Number.isFinite(totalGoals)) {
    const overText = match.prediction.over_2_5 !== undefined
      ? ` Over 2.5 is priced by the model at ${formatProbability(match.prediction.over_2_5)}.`
      : ''
    drivers.push({
      label: 'Goal profile',
      detail: `Projected total is ${totalGoals.toFixed(1)} goals with a ${match.prediction.predicted_score.home}-${match.prediction.predicted_score.away} model scoreline.${overText}`,
      tone: totalGoals >= 2.8 ? 'positive' : totalGoals <= 1.8 ? 'risk' : 'neutral',
    })
  }

  if (match.prediction.confidence_band || Number.isFinite(match.prediction.confidence)) {
    drivers.push({
      label: 'Confidence calibration',
      detail: `${match.prediction.confidence_band || 'Medium'} confidence at ${match.prediction.confidence}% means the model sees a ${margin >= 12 ? 'clearer' : 'competitive'} outcome distribution.`,
      tone: match.prediction.confidence >= 70 ? 'positive' : match.prediction.confidence < 55 ? 'risk' : 'neutral',
    })
  }

  const isScheduled = match.status.toLowerCase().includes('scheduled') || match.status.toLowerCase().includes('pre')
  if (!isScheduled && match.stats.shots[0] + match.stats.shots[1] > 0) {
    const shotLeader = match.stats.shots[0] > match.stats.shots[1]
      ? match.home_team
      : match.stats.shots[1] > match.stats.shots[0]
        ? match.away_team
        : null

    drivers.push({
      label: 'In-match evidence',
      detail: shotLeader
        ? `${shotLeader} leads total shots ${match.stats.shots[0]}-${match.stats.shots[1]} in the current match data feed.`
        : `Shot volume is level at ${match.stats.shots[0]}-${match.stats.shots[1]} in the current match data feed.`,
      tone: shotLeader ? 'positive' : 'neutral',
    })
  }

  return drivers.slice(0, 5)
}

function PredictionInsightPanel({ match }: { match: MatchDetails }) {
  if (!match.prediction) return null

  const ranked = getPredictionRank(match)
  const leader = ranked[0]
  const runnerUp = ranked[1]
  const separation = leader && runnerUp ? Math.round((leader.value - runnerUp.value) * 100) : 0
  const drivers = buildPredictionDrivers(match)
  const toneClass: Record<PredictionDriverTone, string> = {
    positive: 'border-emerald-500/25 bg-emerald-500/10',
    neutral: 'border-sky-500/20 bg-sky-500/10',
    risk: 'border-amber-500/25 bg-amber-500/10',
  }

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-4 border-b flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: 'var(--border-color)' }}>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-[var(--accent-ai)]">Prediction Explainability</p>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">Why the model leans this way</h3>
        </div>
        <DataSourceBadge provider="model" detail={match.prediction.model_version || 'Unified neural ensemble'} />
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="rounded-xl bg-[var(--muted-bg)] p-3">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Top outcome</p>
            <p className="text-sm font-bold text-[var(--text-primary)] mt-1">{leader?.label || 'Unavailable'}</p>
            <p className="text-xs text-[var(--text-secondary)]">{leader ? formatProbability(leader.value) : 'N/A'}</p>
          </div>
          <div className="rounded-xl bg-[var(--muted-bg)] p-3">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Separation</p>
            <p className="text-sm font-bold text-[var(--text-primary)] mt-1">{separation} points</p>
            <p className="text-xs text-[var(--text-secondary)]">vs next outcome</p>
          </div>
          <div className="rounded-xl bg-[var(--muted-bg)] p-3">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Scoreline</p>
            <p className="text-sm font-bold text-[var(--text-primary)] mt-1">
              {match.prediction.predicted_score.home}-{match.prediction.predicted_score.away}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              {match.prediction.most_likely_score ? `Mode: ${match.prediction.most_likely_score}` : 'Expected goals output'}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {drivers.map((driver) => (
            <div key={driver.label} className={`rounded-xl border p-3 ${toneClass[driver.tone]}`}>
              <p className="text-xs font-bold text-[var(--text-primary)]">{driver.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{driver.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            Model output is probabilistic and uses available provider data, standings context, H2H samples, and calibrated scoring features.
          </p>
          {match.source && (
            <DataSourceBadge
              provider={match.source}
              detail={match.sourceDetail}
              refreshedAt={match.generatedAt}
              compact
              className="flex-shrink-0"
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function MatchDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const matchId = params.id as string
  const leagueId = searchParams.get('league') || ''
  
  const { asQueryParam: genderParam } = useGenderQuery()
  const [match, setMatch] = useState<MatchDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<DetailTab>('summary')
  const [halftimeCountdown, setHalftimeCountdown] = useState<string>('')
  const [retryCount, setRetryCount] = useState(0) // Used to trigger refetch
  const [trackedTeams, setTrackedTeams] = useState<WatchTeam[]>([])

  // Derived state for live status - compute before hooks that depend on it
  const isLive = match?.status?.includes('IN_PROGRESS') || match?.status?.includes('HALF') || match?.status?.includes('LIVE') || false
  const isHalftime = match?.status?.toLowerCase().includes('half') && !match?.status?.toLowerCase().includes('first') && !match?.status?.toLowerCase().includes('second') || false
  // Ref to the match hero <section>. StickyScoreBar uses an IntersectionObserver
  // on this to know when to slide down into view.
  const heroRef = useRef<HTMLElement | null>(null)
  const trackedNameSet = useMemo(
    () => new Set(trackedTeams.map((team) => normalizeTeamName(team.name))),
    [trackedTeams]
  )

  // Halftime countdown effect - must be before early returns
  useEffect(() => {
    if (!isHalftime) {
      setHalftimeCountdown('')
      return
    }
    
    const estimatedResumeTime = new Date()
    estimatedResumeTime.setMinutes(estimatedResumeTime.getMinutes() + 10)
    
    const updateCountdown = () => {
      const now = new Date()
      const diff = estimatedResumeTime.getTime() - now.getTime()
      
      if (diff <= 0) {
        setHalftimeCountdown('Resuming soon...')
        return
      }
      
      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)
      setHalftimeCountdown(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }
    
    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [isHalftime])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return
      setTrackedTeams(
        parsed
          .filter((item): item is WatchTeam => {
            if (!item || typeof item !== 'object') return false
            const entry = item as Partial<WatchTeam>
            return typeof entry.name === 'string' && typeof entry.league === 'string'
          })
          .map((item) => ({ name: item.name.trim(), league: item.league.trim() }))
          .filter((item) => item.name.length > 0 && item.league.length > 0)
      )
    } catch (error) {
      console.error('Failed to load match watchlist:', error)
    }
  }, [])

  useEffect(() => {
    const fetchMatchDetails = async () => {
      try {
        // Use our server-side API proxy to fetch match details
        // This avoids CORS issues and handles fallbacks between ESPN and FotMob
        const baseUrl = `/api/match/${matchId}${leagueId ? `?league=${leagueId}` : ''}`
        const sep = baseUrl.includes('?') ? '&' : '?'
        const url = `${baseUrl}${sep}gender=${genderParam}`
        const res = await fetch(url, { cache: 'no-store' })
        
        if (!res.ok) {
          console.error('Match not found:', res.status)
          setMatch(null)
          setLoading(false)
          return
        }
        
        const data = await res.json()
        
        // Map the API response to MatchDetails format
        const matchDetails: MatchDetails = {
          id: data.id,
          source: data.source,
          sourceDetail: data.sourceDetail,
          generatedAt: data.generatedAt,
          home_team: data.home_team,
          away_team: data.away_team,
          home_score: data.home_score,
          away_score: data.away_score,
          status: data.status === 'finished' ? 'STATUS_FINAL' : 
                  data.status === 'live' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED',
          minute: data.minute,
          venue: data.venue,
          attendance: data.attendance,
          capacity: data.capacity,
          date: data.date,
          league: data.league,
          leagueId: data.leagueId,
          referee: data.referee,
          refereeCountry: data.refereeCountry,
          events: (data.events || []).map((e: { type: string; minute: number; addedTime?: number; player: string; team: string; relatedPlayer?: string }) => ({
            type: e.type as MatchEvent['type'],
            minute: e.minute,
            addedTime: e.addedTime,
            player: e.player,
            team: e.team as 'home' | 'away',
            relatedPlayer: e.relatedPlayer,
          })),
          lineups: {
            home: data.lineups?.home || [],
            away: data.lineups?.away || [],
            homeFormation: data.lineups?.homeFormation,
            awayFormation: data.lineups?.awayFormation,
          },
          stats: data.stats || {
            possession: [50, 50],
            shots: [0, 0],
            shotsOnTarget: [0, 0],
            corners: [0, 0],
            fouls: [0, 0],
          },
          shotmap: data.shotmap || [],
          h2h: {
            homeWins: data.h2h?.homeWins ?? 0,
            draws: data.h2h?.draws ?? 0,
            awayWins: data.h2h?.awayWins ?? 0,
            recentMatches: (data.h2h?.recentMatches || []).map((m: {
              date?: string
              homeTeam?: string
              awayTeam?: string
              home_score?: number
              away_score?: number
              homeScore?: number
              awayScore?: number
            }) => ({
              date: m.date || '',
              homeTeam: m.homeTeam,
              awayTeam: m.awayTeam,
              home_score: Number(m.home_score ?? m.homeScore ?? 0),
              away_score: Number(m.away_score ?? m.awayScore ?? 0),
            })),
          },
          prediction: data.prediction,
          liveWinProbability: data.liveWinProbability,
          commentary: data.commentary || [],
        }
        
        // Try to fetch standings for team positions
        if (data.leagueId) {
          try {
            const standingsRes = await fetch(
              `https://site.api.espn.com/apis/v2/sports/soccer/${data.leagueId}/standings`
            )
            if (standingsRes.ok) {
              const standingsData = await standingsRes.json()
              const entries = standingsData.children?.[0]?.standings?.entries || []
              
              const normalizeName = (name: string) =>
                name
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .toLowerCase()

              const homeTeamName = normalizeName(matchDetails.home_team)
              const awayTeamName = normalizeName(matchDetails.away_team)
              
              const fullStandings: TeamStanding[] = []
              let matchedHomeStanding: TeamStanding | undefined
              let matchedAwayStanding: TeamStanding | undefined
              
              for (let i = 0; i < entries.length; i++) {
                const entry = entries[i]
                const teamDisplayName = entry.team?.displayName || 'Unknown'
                const teamName = normalizeName(teamDisplayName)
                
                const getStatVal = (name: string) => {
                  const stat = entry.stats?.find((s: { name: string }) => s.name === name)
                  return parseInt(stat?.value || '0', 10)
                }
                
                const standing: TeamStanding = {
                  position: i + 1,
                  played: getStatVal('gamesPlayed'),
                  won: getStatVal('wins'),
                  drawn: getStatVal('ties'),
                  lost: getStatVal('losses'),
                  points: getStatVal('points'),
                  teamName: teamDisplayName,
                }
                
                fullStandings.push(standing)
                
                if (teamName.includes(homeTeamName) || homeTeamName.includes(teamName)) {
                  matchedHomeStanding = standing
                }
                if (teamName.includes(awayTeamName) || awayTeamName.includes(teamName)) {
                  matchedAwayStanding = standing
                }
              }

              // Only show table context when both teams can be located in the same standings set.
              if (matchedHomeStanding && matchedAwayStanding) {
                matchDetails.homeStanding = matchedHomeStanding
                matchDetails.awayStanding = matchedAwayStanding
                matchDetails.fullStandings = fullStandings
              } else {
                matchDetails.homeStanding = undefined
                matchDetails.awayStanding = undefined
                matchDetails.fullStandings = undefined
              }
            }
          } catch {
            // Standings not available, continue without them
          }
        }
        
        setMatch(matchDetails)
      } catch (e) {
        console.error('Error fetching match details:', e)
        setMatch(null)
      } finally {
        setLoading(false)
      }
    }

    if (matchId) {
      fetchMatchDetails()
    }
  }, [matchId, leagueId, retryCount]) // retryCount triggers refetch when incremented

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    } catch {
      return dateStr
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--background)' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--accent-ai)]" />
      </div>
    )
  }

  if (!match) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--background)' }}>
        <div className="text-center max-w-md mx-auto px-4">
          <CircleHelp className="mx-auto mb-4 h-12 w-12 text-[var(--text-tertiary)]" aria-hidden />
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Match Not Available</h2>
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            We couldn&apos;t load details for this match. This might be because:
          </p>
          <ul className="text-left mb-6 space-y-2" style={{ color: 'var(--text-tertiary)' }}>
            <li className="flex items-start gap-2">
              <span>•</span>
              <span>The match hasn&apos;t started yet and detailed data isn&apos;t available</span>
            </li>
            <li className="flex items-start gap-2">
              <span>•</span>
              <span>The match ID has changed or is from a different data source</span>
            </li>
            <li className="flex items-start gap-2">
              <span>•</span>
              <span>Our data providers are temporarily unavailable</span>
            </li>
          </ul>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link 
              href="/matches" 
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-[var(--accent-ai)] to-[var(--accent-primary)] text-[#04120a] font-semibold hover:opacity-95 transition-colors"
            >
              ← Browse Leagues
            </Link>
            <button
              onClick={() => {
                setLoading(true)
                setRetryCount(prev => prev + 1) // Trigger refetch without full page reload
              }}
              className="px-6 py-3 rounded-xl border font-semibold transition-colors hover:bg-[var(--muted-bg)] inline-flex items-center justify-center gap-2"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Additional derived state (isLive and isHalftime already computed above before hooks)
  const isScheduled = match.status.toLowerCase().includes('scheduled') || match.status.toLowerCase().includes('pre')
  const isFinished = match.status.includes('FINAL') || match.status.toLowerCase().includes('finished') || match.status.toLowerCase().includes('ft')

  // Helper function to evaluate prediction accuracy
  const getPredictionAccuracy = (): { type: 'exact' | 'close' | 'miss'; message: string } => {
    if (!match.prediction || match.home_score === null || match.away_score === null) {
      return { type: 'miss', message: '' }
    }
    
    const predictedHome = match.prediction.predicted_score.home
    const predictedAway = match.prediction.predicted_score.away
    const actualHome = match.home_score
    const actualAway = match.away_score
    
    // Exact score match
    if (predictedHome === actualHome && predictedAway === actualAway) {
      return { type: 'exact', message: 'Exact prediction' }
    }

    // Close prediction: goal difference within 1
    const predictedDiff = predictedHome - predictedAway
    const actualDiff = actualHome - actualAway
    if (Math.abs(predictedDiff - actualDiff) <= 1) {
      return { type: 'close', message: 'Close prediction' }
    }
    
    return { type: 'miss', message: `Actual: ${actualHome} - ${actualAway}` }
  }

  // Navigate back to the league page - go directly to full league page
  const handleBack = () => {
    if (leagueId) {
      router.push(`/leagues/${leagueId}`)
    } else {
      router.back()
    }
  }

  const trackTeam = (teamName: string) => {
    const normalized = normalizeTeamName(teamName)
    if (!normalized || trackedNameSet.has(normalized)) return

    setTrackedTeams((current) => {
      const next = [...current, { name: teamName, league: match.league || 'Unknown' }]
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const isTeamTracked = (teamName: string) => trackedNameSet.has(normalizeTeamName(teamName))

  const aiPick: 'home' | 'draw' | 'away' | null = match.prediction
    ? (match.prediction.home_win ?? 0) >= (match.prediction.draw ?? 0) &&
      (match.prediction.home_win ?? 0) >= (match.prediction.away_win ?? 0)
      ? 'home'
      : (match.prediction.away_win ?? 0) >= (match.prediction.draw ?? 0)
        ? 'away'
        : 'draw'
    : null
  const aiPickLabel = aiPick === 'home' ? match.home_team : aiPick === 'away' ? match.away_team : 'Draw'

  // Live minute label for the StickyScoreBar — falls back to match.status.
  const liveMinuteLabel = isLive ? (match.minute ?? match.status) : null

  return (
    <div className="min-h-screen">
      <StickyScoreBar
        heroRef={heroRef}
        homeName={match.home_team}
        awayName={match.away_team}
        homeTeamId={match.home_team_id}
        awayTeamId={match.away_team_id}
        homeScore={match.home_score}
        awayScore={match.away_score}
        isLive={isLive}
        liveMinute={liveMinuteLabel}
        statusLabel={isFinished ? 'FT' : isScheduled ? 'Scheduled' : match.status}
      />
      {/* Hero header — gradient backdrop, glass chips, refined typography */}
      <section
        ref={heroRef}
        className="relative isolate overflow-hidden border-b border-[var(--border-color)]"
      >
        {/* Ambient gradient */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(60%_55%_at_15%_20%,color-mix(in_srgb,var(--accent-ai)_22%,transparent),transparent_60%),radial-gradient(50%_50%_at_88%_25%,color-mix(in_srgb,var(--accent-primary)_22%,transparent),transparent_60%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-ai)]/40 to-transparent"
        />

        <div className="mx-auto w-full max-w-5xl px-4 pt-5 pb-6 md:px-8 md:pt-6 md:pb-8">
          {/* Back link */}
          <button
            onClick={handleBack}
            className="group mb-5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
            <span>Back to {match.league || 'leagues'}</span>
          </button>

          {/* Top chip row — league + status + (AI lean if available) */}
          <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
            <LeagueBadge league={match.leagueId ?? match.league} size="md" />
            {isLive && !isHalftime && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-loss)]/35 bg-[var(--accent-loss)]/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent-loss)]">
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-70" />
                  <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-loss)]" />
                </span>
                Live · {match.minute}&apos;
              </span>
            )}
            {isHalftime && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-warn)]/35 bg-[var(--accent-warn)]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent-warn)]">
                Half time
                {halftimeCountdown && (
                  <span className="font-mono normal-case text-[10px] text-[var(--accent-warn)]/80">{halftimeCountdown}</span>
                )}
              </span>
            )}
            {isFinished && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)]/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Full time
              </span>
            )}
            {isScheduled && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)]/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                <Clock className="h-3 w-3" aria-hidden="true" />
                Upcoming
              </span>
            )}
            {match.prediction && aiPick && (
              <ConfidenceIndicator
                value={Math.max(
                  Number(match.prediction.home_win) || 0,
                  Number(match.prediction.draw) || 0,
                  Number(match.prediction.away_win) || 0,
                )}
                pick={aiPickLabel}
              />
            )}
          </div>

          {/* Score block — three columns */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-6">
            {/* Home team */}
            <div className="min-w-0 text-right">
              <TeamNameWithCrest
                name={match.home_team}
                teamId={match.home_team_id}
                align="right"
              />
              {match.events.filter(e => e.team === 'home' && (e.type === 'goal' || e.type === 'own_goal')).length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {match.events
                    .filter(e => e.team === 'home' && (e.type === 'goal' || e.type === 'own_goal'))
                    .map((e, i) => (
                      <p key={i} className="text-[11px] text-[var(--text-tertiary)] truncate">
                        {e.player} {e.minute}&apos;{e.addedTime ? `+${e.addedTime}` : ''}{e.type === 'own_goal' ? ' (OG)' : ''}
                      </p>
                    ))}
                </div>
              )}
            </div>

            {/* Score */}
            <div className="flex-shrink-0 text-center px-2">
              {isScheduled ? (
                <p className="font-display text-[clamp(1.5rem,3vw,2rem)] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
                  vs
                </p>
              ) : (
                <div className="flex items-center gap-3 md:gap-5">
                  <span className="font-display text-[clamp(2.4rem,6vw,4rem)] font-extrabold leading-none tabular-nums text-[var(--text-primary)]">
                    {match.home_score}
                  </span>
                  <span className="font-display text-[clamp(1.6rem,4vw,2.4rem)] font-bold leading-none text-[var(--text-tertiary)]">
                    –
                  </span>
                  <span className="font-display text-[clamp(2.4rem,6vw,4rem)] font-extrabold leading-none tabular-nums text-[var(--text-primary)]">
                    {match.away_score}
                  </span>
                </div>
              )}
            </div>

            {/* Away team */}
            <div className="min-w-0 text-left">
              <TeamNameWithCrest
                name={match.away_team}
                teamId={match.away_team_id}
                align="left"
              />
              {match.events.filter(e => e.team === 'away' && (e.type === 'goal' || e.type === 'own_goal')).length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {match.events
                    .filter(e => e.team === 'away' && (e.type === 'goal' || e.type === 'own_goal'))
                    .map((e, i) => (
                      <p key={i} className="text-[11px] text-[var(--text-tertiary)] truncate">
                        {e.player} {e.minute}&apos;{e.addedTime ? `+${e.addedTime}` : ''}{e.type === 'own_goal' ? ' (OG)' : ''}
                      </p>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Meta row — FotMob-style chips + provenance badge */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <MetaChipRow
              dateLabel={formatDate(match.date)}
              venue={match.venue}
              attendance={match.attendance ?? null}
              capacity={match.capacity ?? null}
            />
            <DataSourceBadge
              provider={match.source || 'none'}
              detail={match.sourceDetail || 'Match detail feed'}
              refreshedAt={match.generatedAt}
              compact
            />
          </div>

          {/* Track buttons — refined */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {[match.home_team, match.away_team].map((teamName) => {
              const tracked = isTeamTracked(teamName)
              return (
                <button
                  key={teamName}
                  onClick={() => trackTeam(teamName)}
                  disabled={tracked}
                  className={cn(
                    'inline-flex max-w-[220px] items-center gap-1.5 truncate rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all',
                    tracked
                      ? 'border-[var(--accent-primary)]/35 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] cursor-default'
                      : 'border-[var(--border-color)] bg-[var(--card-bg)]/60 text-[var(--text-secondary)] hover:-translate-y-0.5 hover:border-[var(--accent-primary)]/50 hover:bg-[var(--card-bg)] hover:text-[var(--accent-primary)]'
                  )}
                >
                  {tracked ? (
                    <>
                      <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Tracking {teamName}
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                      Track {teamName}
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Tabs — shadcn primitives for consistent styling with the rest of the app */}
      <div
        className="sticky top-16 z-10 border-b bg-[var(--background-secondary)]/95 backdrop-blur-sm"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="mx-auto max-w-4xl px-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DetailTab)}>
            <TabsList className="h-12 w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
              {DETAIL_TABS.map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="relative h-12 rounded-none border-b-2 border-transparent px-3 text-sm font-semibold capitalize text-[var(--text-secondary)] hover:text-[var(--text-primary)] data-[state=active]:border-[var(--accent-primary)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--accent-primary)] data-[state=active]:shadow-none"
                >
                  {DETAIL_TAB_LABELS[tab]}
                  {tab === 'ai' && (
                    <span
                      aria-hidden="true"
                      className="ml-1.5 rounded-full bg-[var(--accent-ai)]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--accent-ai)]"
                    >
                      AI
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {activeTab === 'summary' && (
          <div className="space-y-6">
            {/* ── Momentum Chart (FotMob-style) ── */}
            {match.events.length > 0 && (
              <MatchMomentum
                events={match.events}
                homeTeam={match.home_team}
                awayTeam={match.away_team}
                status={match.status}
                possession={match.stats.possession}
              />
            )}

            {/* ── Top Stats (compact, FotMob-style) ── */}
            {!isScheduled && (
              <FotmobStatsCard stats={match.stats} homeTeam={match.home_team} awayTeam={match.away_team} compact />
            )}

            {/* ── Event Heatmap (always render; component handles empty-data fallback) ── */}
            <MatchEventHeatmap
              events={match.events}
              homeTeam={match.home_team}
              awayTeam={match.away_team}
              shotmap={match.shotmap || []}
            />

            {/* ── AI Prediction Card ── */}
            {match.prediction && (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-ai) 16%, transparent), color-mix(in srgb, var(--accent-primary) 16%, transparent))', border: '1px solid color-mix(in srgb, var(--accent-ai) 36%, transparent)' }}>
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🤖</span>
                    <span className="text-sm font-semibold text-[var(--accent-ai)]">AI Prediction</span>
                    <span className="text-xs bg-[var(--accent-ai)]/20 text-[var(--accent-ai)] px-2 py-0.5 rounded-full ml-auto">
                      {match.prediction.confidence}% confidence
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-6">
                    <div className="text-center">
                      <p className="text-xs text-[var(--text-tertiary)] mb-1">Predicted Score</p>
                      <p className="text-2xl font-bold text-[var(--accent-ai)]">
                        {match.prediction.predicted_score.home} - {match.prediction.predicted_score.away}
                      </p>
                    </div>
                    <div className="h-10 w-px bg-[var(--accent-ai)]/20" />
                    <div className="flex gap-3">
                      <div className="text-center">
                        <p className="text-xs text-[var(--text-tertiary)] mb-1">Home</p>
                        <p className={`text-lg font-bold ${match.prediction.home_win > match.prediction.away_win ? 'text-green-500' : 'text-[var(--text-secondary)]'}`}>
                          {Math.round(match.prediction.home_win * 100)}%
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-[var(--text-tertiary)] mb-1">Draw</p>
                        <p className="text-lg font-bold text-[var(--text-secondary)]">
                          {Math.round(match.prediction.draw * 100)}%
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-[var(--text-tertiary)] mb-1">Away</p>
                        <p className={`text-lg font-bold ${match.prediction.away_win > match.prediction.home_win ? 'text-green-500' : 'text-[var(--text-secondary)]'}`}>
                          {Math.round(match.prediction.away_win * 100)}%
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                    <div className="rounded-xl bg-white/5 p-2.5 text-center">
                      <p className="text-[10px] text-[var(--text-tertiary)]">Total Goals</p>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{(match.prediction.total_goals ?? (match.prediction.predicted_score.home + match.prediction.predicted_score.away)).toFixed(1)}</p>
                    </div>
                    <div className="rounded-xl bg-white/5 p-2.5 text-center">
                      <p className="text-[10px] text-[var(--text-tertiary)]">Over 2.5</p>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{match.prediction.over_2_5 !== undefined ? `${Math.round(match.prediction.over_2_5 * 100)}%` : 'N/A'}</p>
                    </div>
                    <div className="rounded-xl bg-white/5 p-2.5 text-center">
                      <p className="text-[10px] text-[var(--text-tertiary)]">BTTS</p>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{match.prediction.btts_yes !== undefined ? `${Math.round(match.prediction.btts_yes * 100)}%` : 'N/A'}</p>
                    </div>
                    <div className="rounded-xl bg-white/5 p-2.5 text-center">
                      <p className="text-[10px] text-[var(--text-tertiary)]">Confidence Band</p>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{match.prediction.confidence_band || 'Medium'}</p>
                    </div>
                  </div>
                  {(match.prediction.model_version || match.prediction.most_likely_score) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {match.prediction.most_likely_score && (
                        <span className="text-[10px] bg-[var(--muted-bg)] text-[var(--text-secondary)] px-2 py-1 rounded-full">
                          Likeliest scoreline: {match.prediction.most_likely_score}
                        </span>
                      )}
                      {match.prediction.model_version && (
                        <span className="text-[10px] bg-[var(--muted-bg)] text-[var(--text-secondary)] px-2 py-1 rounded-full">
                          {match.prediction.model_version}
                        </span>
                      )}
                    </div>
                  )}
                  {isFinished && match.home_score !== null && match.away_score !== null && (() => {
                    const accuracy = getPredictionAccuracy()
                    return accuracy.message ? (
                      <div className="mt-3 pt-3 border-t border-[var(--accent-ai)]/20">
                        <p className={`text-center text-xs font-semibold inline-flex items-center justify-center gap-1.5 w-full ${
                          accuracy.type === 'exact' ? 'text-[var(--accent-primary)]' :
                          accuracy.type === 'close' ? 'text-[var(--accent-warn)]' :
                          'text-[var(--text-tertiary)]'
                        }`}>
                          {accuracy.type === 'exact' && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                          {accuracy.type === 'close' && <Zap className="h-3.5 w-3.5" aria-hidden />}
                          {accuracy.message}
                        </p>
                      </div>
                    ) : null
                  })()}
                </div>
              </div>
            )}

            <LiveWinProbabilityPanel match={match} />

            <PredictionInsightPanel match={match} />

            {/* ── Events Timeline ── */}
            {match.events.length > 0 && (
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)]">Events</h3>
                </div>
                <EventTimeline
                  events={match.events.filter((e) => e.type !== 'substitution')}
                  homeName={match.home_team}
                  awayName={match.away_team}
                  className="rounded-none border-0"
                />
                {isFinished && match.home_score !== null && match.away_score !== null && (
                  <div className="flex items-center px-4 py-2" style={{ background: 'var(--muted-bg)' }}>
                    <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
                    <span className="px-3 text-meta font-semibold text-[var(--text-secondary)] font-numeric tabular-nums">
                      FT {match.home_score} - {match.away_score}
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
                  </div>
                )}
              </div>
            )}

            {/* ── YouTube Highlights ── */}
            <HighlightsLink
              homeTeam={match.home_team}
              awayTeam={match.away_team}
              homeScore={match.home_score}
              awayScore={match.away_score}
              date={match.date}
              league={match.league}
              status={match.status}
            />

            {/* ── Match Info (FotMob-style) ── */}
            <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
              <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                <h3 className="font-semibold text-[var(--text-primary)]">Match Info</h3>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {/* Venue with Google Maps link */}
                {match.venue && (
                  <a
                    href={`https://www.google.com/maps/search/${encodeURIComponent(match.venue)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--muted-bg)] transition-colors"
                  >
                    <MapPin className="h-5 w-5 text-[var(--text-secondary)]" aria-hidden />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{match.venue}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>View on map →</p>
                    </div>
                    {/* Attendance / Capacity */}
                    {(match.attendance || match.capacity) && (
                      <div className="text-right flex-shrink-0">
                        {match.attendance && (
                          <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            {match.attendance.toLocaleString()}
                            {match.capacity ? ` / ${match.capacity.toLocaleString()}` : ''}
                          </p>
                        )}
                        {match.capacity && match.attendance && (
                          <div className="flex items-center gap-1.5 mt-0.5 justify-end">
                            <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--muted-bg)' }}>
                              <div
                                className="h-full rounded-full bg-green-500"
                                style={{ width: `${Math.min(100, (match.attendance / match.capacity) * 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-medium text-green-500">
                              {Math.round((match.attendance / match.capacity) * 100)}%
                            </span>
                          </div>
                        )}
                        {!match.attendance && match.capacity && (
                          <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                            Capacity: {match.capacity.toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}
                  </a>
                )}
                {/* Date & Time */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xl">📅</span>
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formatDate(match.date)}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{match.league}</p>
                  </div>
                </div>
                {/* Data source */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] text-[10px] font-black text-[var(--text-secondary)]">
                    DS
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Match data source</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      Provider-backed details are used when available; unavailable fields stay blank.
                    </p>
                  </div>
                  <DataSourceBadge
                    provider={match.source || 'none'}
                    detail={match.sourceDetail}
                    refreshedAt={match.generatedAt}
                    compact
                    className="flex-shrink-0"
                  />
                </div>
                {/* Referee */}
                {match.referee && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="text-xl">⚖️</span>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{match.referee}</p>
                      {match.refereeCountry && (
                        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{match.refereeCountry}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Key Match Factors ── */}
            <KeyMatchFactors
              homeTeam={match.home_team}
              awayTeam={match.away_team}
              leagueId={match.leagueId}
              matchDate={match.date}
            />

            {/* ── Derived Markets (Over/Under, BTTS, Correct Score Top 5) ── */}
            {match.prediction?.derived_markets && (
              <DerivedMarkets
                data={match.prediction.derived_markets}
                homeTeam={match.home_team}
                awayTeam={match.away_team}
              />
            )}

            {/* ── Betting Intelligence (model vs market) ── */}
            {match.prediction && !isFinished && (
              <BettingIntelligence
                matchId={match.id}
                leagueId={match.leagueId}
                modelProbs={{
                  homeWin: match.prediction.home_win,
                  draw: match.prediction.draw,
                  awayWin: match.prediction.away_win,
                }}
                kickoff={match.date}
                status={match.status}
              />
            )}

            {/* ── H2H & Team Form Summary ── */}
            {(match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins > 0 || match.homeStanding || match.awayStanding) && (
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
                    <span>⚔️</span> Head-to-Head &amp; Form
                  </h3>
                </div>
                <div className="p-4 space-y-4">
                  {/* H2H Record Bar */}
                  {(match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins) > 0 && (() => {
                    const totalH2H = match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins
                    const homePct = (match.h2h.homeWins / totalH2H) * 100
                    const drawPct = (match.h2h.draws / totalH2H) * 100
                    const awayPct = (match.h2h.awayWins / totalH2H) * 100
                    return (
                      <div>
                        <div className="flex items-center justify-between text-sm mb-2">
                          <span className="text-[var(--text-primary)] font-medium">{match.home_team}</span>
                          <span className="text-[var(--text-tertiary)] text-xs">{totalH2H} meetings</span>
                          <span className="text-[var(--text-primary)] font-medium">{match.away_team}</span>
                        </div>
                        <div className="flex h-6 rounded-lg overflow-hidden text-xs font-bold text-white">
                          {homePct > 0 && (
                            <div className="bg-blue-500 flex items-center justify-center" style={{ width: `${homePct}%` }}>
                              {match.h2h.homeWins}W
                            </div>
                          )}
                          {drawPct > 0 && (
                            <div className="bg-gray-400 flex items-center justify-center" style={{ width: `${drawPct}%` }}>
                              {match.h2h.draws}D
                            </div>
                          )}
                          {awayPct > 0 && (
                            <div className="bg-orange-500 flex items-center justify-center" style={{ width: `${awayPct}%` }}>
                              {match.h2h.awayWins}W
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Recent H2H Matches */}
                  {match.h2h.recentMatches.length > 0 && (
                    <div>
                      <p className="text-xs text-[var(--text-tertiary)] mb-2 font-medium uppercase tracking-wide">Recent Meetings</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {match.h2h.recentMatches.slice(0, 4).map((m, idx) => {
                          const homeWon = m.home_score > m.away_score
                          const awayWon = m.away_score > m.home_score
                          return (
                            <div key={idx} className="flex items-center justify-between px-3 py-2 bg-[var(--muted-bg)] rounded-lg text-sm">
                              <span className={`flex-1 text-right pr-2 ${homeWon ? 'font-semibold text-blue-500' : 'text-[var(--text-secondary)]'}`}>
                                {m.homeTeam || match.home_team}
                              </span>
                              <span className="font-bold text-[var(--text-primary)] px-2">
                                {m.home_score} - {m.away_score}
                              </span>
                              <span className={`flex-1 text-left pl-2 ${awayWon ? 'font-semibold text-orange-500' : 'text-[var(--text-secondary)]'}`}>
                                {m.awayTeam || match.away_team}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Team Form (Standing-based) */}
                  {(match.homeStanding || match.awayStanding) && (
                    <div>
                      <p className="text-xs text-[var(--text-tertiary)] mb-2 font-medium uppercase tracking-wide">Season Form</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {match.homeStanding && (
                          <div className="bg-[var(--muted-bg)] rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="w-2 h-2 rounded-full bg-blue-500" />
                              <span className="text-sm font-medium text-[var(--text-primary)]">{match.home_team}</span>
                              <span className="text-xs text-[var(--text-tertiary)] ml-auto">#{match.homeStanding.position}</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 text-center text-xs">
                              <div><p className="text-[var(--text-tertiary)]">P</p><p className="font-medium text-[var(--text-primary)]">{match.homeStanding.played}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">W</p><p className="font-medium text-green-500">{match.homeStanding.won}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">D</p><p className="font-medium text-amber-500">{match.homeStanding.drawn}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">L</p><p className="font-medium text-red-400">{match.homeStanding.lost}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">Pts</p><p className="font-bold text-[var(--text-primary)]">{match.homeStanding.points}</p></div>
                            </div>
                          </div>
                        )}
                        {match.awayStanding && (
                          <div className="bg-[var(--muted-bg)] rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="w-2 h-2 rounded-full bg-orange-500" />
                              <span className="text-sm font-medium text-[var(--text-primary)]">{match.away_team}</span>
                              <span className="text-xs text-[var(--text-tertiary)] ml-auto">#{match.awayStanding.position}</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 text-center text-xs">
                              <div><p className="text-[var(--text-tertiary)]">P</p><p className="font-medium text-[var(--text-primary)]">{match.awayStanding.played}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">W</p><p className="font-medium text-green-500">{match.awayStanding.won}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">D</p><p className="font-medium text-amber-500">{match.awayStanding.drawn}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">L</p><p className="font-medium text-red-400">{match.awayStanding.lost}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">Pts</p><p className="font-bold text-[var(--text-primary)]">{match.awayStanding.points}</p></div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => setActiveTab('h2h')}
                    className="w-full text-center text-sm text-[var(--accent-primary)] hover:opacity-80 transition-opacity font-medium py-1"
                  >
                    View full H2H &amp; form details →
                  </button>
                </div>
              </div>
            )}

            {/* ── Weather ── */}
            <MatchWeather 
              matchId={matchId}
              venue={match.venue}
              homeTeam={match.home_team}
              awayTeam={match.away_team}
            />

            {/* ── Commentary ── */}
            {match.commentary && match.commentary.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>📝 Commentary</h3>
                <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="max-h-[400px] overflow-y-auto divide-y" style={{ borderColor: 'var(--border-color)' }}>
                    {match.commentary
                      .sort((a, b) => b.minute - a.minute)
                      .map((item, idx) => (
                        <div key={idx} className="flex gap-3 p-3 hover:bg-[var(--muted-bg)] transition-colors">
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] font-bold text-[10px] flex-shrink-0">
                            {item.minute}&apos;
                          </span>
                          <p className="text-xs text-[var(--text-primary)] leading-relaxed">{item.text}</p>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'lineup' && (
          <div className="space-y-6">
            {/* Formation display - Lineup tab only shows formations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Home Team Formation */}
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)]">{match.home_team}</h3>
                  {match.lineups.homeFormation && (
                    <span className="text-sm font-mono px-3 py-1 rounded-full bg-blue-500/20 text-blue-500">
                      {match.lineups.homeFormation}
                    </span>
                  )}
                </div>
                
                {/* Pitch visualization with improved component */}
                <PitchBackground>
                  <FormationDisplay
                    players={match.lineups.home}
                    formation={match.lineups.homeFormation}
                    teamName={match.home_team}
                    teamColor="blue"
                  />
                </PitchBackground>
                
                {/* Substitutes */}
                {match.lineups.home.length > 11 && (
                  <SubstitutesBench players={match.lineups.home.slice(11)} />
                )}
                
                {/* Player list */}
                <div className="p-4 max-h-[200px] overflow-y-auto border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">Starting XI</p>
                  <div className="space-y-1">
                    {match.lineups.home.slice(0, 11).map((player, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">{player.jersey || idx + 1}</span>
                          <span className="text-[var(--text-primary)]">{player.name}</span>
                        </div>
                        {player.position && (
                          <span className="text-xs text-[var(--text-tertiary)] bg-[var(--muted-bg)] px-2 py-0.5 rounded">{player.position}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Away Team Formation */}
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)]">{match.away_team}</h3>
                  {match.lineups.awayFormation && (
                    <span className="text-sm font-mono px-3 py-1 rounded-full bg-orange-500/20 text-orange-500">
                      {match.lineups.awayFormation}
                    </span>
                  )}
                </div>
                
                {/* Pitch visualization with improved component */}
                <PitchBackground>
                  <FormationDisplay
                    players={match.lineups.away}
                    formation={match.lineups.awayFormation}
                    teamName={match.away_team}
                    teamColor="orange"
                  />
                </PitchBackground>
                
                {/* Substitutes */}
                {match.lineups.away.length > 11 && (
                  <SubstitutesBench players={match.lineups.away.slice(11)} />
                )}
                
                {/* Player list */}
                <div className="p-4 max-h-[200px] overflow-y-auto border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">Starting XI</p>
                  <div className="space-y-1">
                    {match.lineups.away.slice(0, 11).map((player, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center">{player.jersey || idx + 1}</span>
                          <span className="text-[var(--text-primary)]">{player.name}</span>
                        </div>
                        {player.position && (
                          <span className="text-xs text-[var(--text-tertiary)] bg-[var(--muted-bg)] px-2 py-0.5 rounded">{player.position}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Match Statistics</h3>

            <FotmobStatsCard stats={match.stats} homeTeam={match.home_team} awayTeam={match.away_team} />
            
            {/* Full League Standings Table */}
            <div className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-md font-medium text-[var(--text-primary)]">{match.league} Standings</h4>
                {!match.fullStandings?.length && (
                  <span className="text-xs text-[var(--text-tertiary)]">Data unavailable</span>
                )}
              </div>
              
              {match.fullStandings && match.fullStandings.length > 0 ? (
                <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-[var(--muted-bg)]">
                        <tr className="text-xs text-[var(--text-tertiary)] border-b" style={{ borderColor: 'var(--border-color)' }}>
                          <th className="text-left py-2 px-3 font-medium">#</th>
                          <th className="text-left py-2 px-3 font-medium">Team</th>
                          <th className="text-center py-2 px-3 font-medium">P</th>
                          <th className="text-center py-2 px-3 font-medium">W</th>
                          <th className="text-center py-2 px-3 font-medium">D</th>
                          <th className="text-center py-2 px-3 font-medium">L</th>
                          <th className="text-center py-2 px-3 font-medium">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {match.fullStandings.map((team) => {
                          // Compare by team name for reliable identification
                          const teamNameLower = (team.teamName || '').toLowerCase()
                          const homeTeamLower = match.home_team.toLowerCase()
                          const awayTeamLower = match.away_team.toLowerCase()
                          const isHomeTeam = teamNameLower.includes(homeTeamLower) || homeTeamLower.includes(teamNameLower)
                          const isAwayTeam = teamNameLower.includes(awayTeamLower) || awayTeamLower.includes(teamNameLower)
                          const isHighlighted = isHomeTeam || isAwayTeam
                          
                          return (
                            <tr
                              key={team.position}
                              className={`border-b text-sm transition-colors ${
                                isHighlighted 
                                  ? isHomeTeam 
                                    ? 'bg-blue-500/20 border-l-4 border-l-blue-500' 
                                    : 'bg-orange-500/20 border-l-4 border-l-orange-500'
                                  : 'hover:bg-[var(--muted-bg)]'
                              }`}
                              style={{ borderColor: 'var(--border-color)' }}
                            >
                              <td className={`py-2 px-3 ${isHighlighted ? 'font-bold' : ''}`} style={{ color: 'var(--text-secondary)' }}>
                                {team.position}
                              </td>
                              <td className={`py-2 px-3 ${isHighlighted ? 'font-bold text-blue-500' : 'font-medium'} ${isAwayTeam ? 'text-orange-500' : ''}`} style={{ color: isHighlighted ? undefined : 'var(--text-primary)' }}>
                                {team.teamName}
                                {isHighlighted && (
                                  <span className="ml-2 text-xs">
                                    {isHomeTeam ? '(H)' : '(A)'}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center" style={{ color: 'var(--text-secondary)' }}>{team.played}</td>
                              <td className="py-2 px-3 text-center text-green-500">{team.won}</td>
                              <td className="py-2 px-3 text-center" style={{ color: 'var(--text-tertiary)' }}>{team.drawn}</td>
                              <td className="py-2 px-3 text-center text-red-400">{team.lost}</td>
                              <td className={`py-2 px-3 text-center font-bold ${isHomeTeam ? 'text-blue-500' : ''} ${isAwayTeam ? 'text-orange-500' : ''}`} style={{ color: isHighlighted ? undefined : 'var(--text-primary)' }}>
                                {team.points}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Legend */}
                  <div className="p-3 border-t flex gap-4 text-xs" style={{ borderColor: 'var(--border-color)', color: 'var(--text-tertiary)' }}>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-blue-500/20 border-l-2 border-l-blue-500" />
                      <span>{match.home_team}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-orange-500/20 border-l-2 border-l-orange-500" />
                      <span>{match.away_team}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 bg-[var(--muted-bg)] rounded-xl">
                  <CircleHelp className="mx-auto mb-3 h-8 w-8 text-[var(--text-tertiary)]" aria-hidden />
                  <p className="text-[var(--text-secondary)]">League standings not available</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'h2h' && (
          <div className="space-y-6">
            {/* Use the new HeadToHeadDisplay component */}
            <HeadToHeadDisplay
              homeTeam={match.home_team}
              awayTeam={match.away_team}
              matchId={matchId}
              leagueId={match.leagueId}
              initialData={match.h2h.recentMatches.length > 0 ? {
                totalMatches: match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins,
                team1: {
                  name: match.home_team,
                  wins: match.h2h.homeWins,
                  goals: 0,
                  cleanSheets: 0,
                  homeWins: 0,
                  awayWins: 0,
                },
                team2: {
                  name: match.away_team,
                  wins: match.h2h.awayWins,
                  goals: 0,
                  cleanSheets: 0,
                  homeWins: 0,
                  awayWins: 0,
                },
                draws: match.h2h.draws,
                avgGoalsPerMatch: 0,
                recentForm: [],
                recentMatches: match.h2h.recentMatches.map((m, idx) => ({
                  id: `h2h-${idx}`,
                  date: m.date,
                  competition: '',
                  homeTeam: m.homeTeam || match.home_team,
                  awayTeam: m.awayTeam || match.away_team,
                  homeScore: m.home_score,
                  awayScore: m.away_score,
                  winner: m.home_score > m.away_score ? 'home' : m.away_score > m.home_score ? 'away' : 'draw',
                })),
                streaks: {
                  longestWinStreak: { team: match.home_team, count: 0 },
                },
              } : undefined}
            />
          </div>
        )}

        {activeTab === 'ai' && (
          <AIPredictionTab
            prediction={match.prediction ? adaptMatchPrediction(match) : null}
            matchState={isFinished ? 'finished' : isLive ? 'live' : 'upcoming'}
            retrospectiveContext={{
              home_team: match.home_team,
              away_team: match.away_team,
              league: match.league,
              leagueId: match.leagueId,
              home_score: match.home_score,
              away_score: match.away_score,
            }}
          />
        )}
      </div>
    </div>
  )
}
