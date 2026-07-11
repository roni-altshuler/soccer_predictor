'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import { Bookmark, BookmarkCheck, CalendarDays, ChevronLeft, CircleHelp, CheckCircle2, MapPin, MessageSquareText, RefreshCw, Scale, Sparkles, Swords, Zap } from 'lucide-react'
import { EventTimeline } from '@/components/match/EventTimeline'
import { StickyScoreBar } from '@/components/match/StickyScoreBar'
import { MatchDetailSkeleton } from '@/components/skeletons'
import { FlagBadge, TeamBadge } from '@/components/primitives'
import {
  ChartContainer,
  NarrativeCard,
  OutcomeBars,
  ScorelineHeatmap,
  type NarrativeInsight,
  type OutcomeBarDatum,
  type ScorelineCell,
} from '@/components/viz'
import { ClubColorBar } from '@/components/motion'

import { cn } from '@/lib/utils'
import { springSnappy } from '@/lib/motion'
import { getLeagueAccent } from '@/lib/leagueAccents'
import FormationDisplay, { PitchBackground, SubstitutesBench } from '@/components/lineup/FormationDisplay'
import MatchWeather from '@/components/weather/MatchWeather'
import { HeadToHeadDisplay } from '@/components/match'
import KeyMatchFactors from '@/components/match/KeyMatchFactors'
import MatchMomentum from '@/components/match/MatchMomentum'
import HighlightsLink from '@/components/match/HighlightsLink'
import MatchEventHeatmap from '@/components/match/MatchEventHeatmap'
import DerivedMarkets from '@/components/match/DerivedMarkets'
import BettingIntelligence from '@/components/match/BettingIntelligence'
import { type PredictionPayload } from '@/components/prediction/PredictionResult'
import { AIPredictionTab } from '@/components/match/AIPredictionTab'
import { SplitStatBar } from '@/components/match/SplitStatBar'
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
    /** "Why this prediction" attribution — present only when the unified engine explained the pick. */
    attribution?: Array<{ feature: string; value: number; contribution: number }> | null
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
  const topScorelines = (p.derived_markets?.correct_score_top5 ?? []).map((s) => ({
    score: `${s.home}-${s.away}`,
    home_goals: s.home,
    away_goals: s.away,
    probability: s.probability,
  }))

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
    // Real committed top scorelines (when the record carries them) feed the
    // scoreline heatmap — nothing is synthesised. The mode scoreline is the
    // top entry when present; the rounded xG scoreline otherwise.
    most_likely_score: topScorelines[0] ?? {
      score: p.most_likely_score ?? `${Math.round(p.predicted_score.home)}-${Math.round(p.predicted_score.away)}`,
      home_goals: Math.round(p.predicted_score.home),
      away_goals: Math.round(p.predicted_score.away),
      probability: Math.max(norm.home, norm.draw, norm.away),
    },
    alternative_scores: topScorelines.slice(1),
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
    // Pass through real attribution only — WhyThisPrediction renders
    // nothing when it's absent.
    attribution: Array.isArray(p.attribution) && p.attribution.length > 0 ? p.attribution : null,
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

/**
 * Competitions contested by national teams — identities resolve to real
 * country flags (rule 2: no letter-avatars for known teams).
 */
const NATIONAL_TEAM_COMPETITIONS = new Set([
  'fifa.world',
  'fifa.wwc',
  'fifa.friendly',
  'fifa.friendly.w',
  'uefa.euro',
  'uefa.weuro',
  'uefa.nations',
  'conmebol.america',
  'concacaf.gold',
  'caf.nations',
  'afc.asian.cup',
])

function isNationalTeamMatch(leagueId?: string, leagueName?: string): boolean {
  if (leagueId && NATIONAL_TEAM_COMPETITIONS.has(leagueId)) return true
  const name = (leagueName || '').toLowerCase()
  return /world cup|euro(pean championship)?|copa america|nations league|gold cup|international friendl/.test(name)
}

type MatchStats = MatchDetails['stats']

function TeamNameWithCrest({
  name,
  teamId,
  align,
  isNational,
  accent,
}: {
  name: string
  teamId?: string
  align: 'left' | 'right'
  isNational?: boolean
  /** Club identity tint — renders a flat colour sliver under the name. */
  accent?: string
}) {
  const content = (
    <span className="block min-w-0">
      <span
        className={cn(
          'flex items-center gap-2.5 min-w-0',
          align === 'right' ? 'flex-row-reverse justify-start' : 'justify-start',
        )}
      >
        {isNational ? (
          <FlagBadge country={name} teamName={name} size={32} />
        ) : (
          <TeamBadge teamId={teamId} name={name} size={32} className="shrink-0" />
        )}
        <span className="font-display text-[clamp(1.1rem,2.4vw,1.85rem)] font-bold leading-tight text-[var(--text-primary)] truncate">
          {name}
        </span>
      </span>
      {accent && (
        <span
          className={cn(
            'mt-1.5 flex',
            align === 'right' ? 'justify-end pr-[42px]' : 'justify-start pl-[42px]',
          )}
        >
          <ClubColorBar
            color={accent}
            team={name}
            orientation="horizontal"
            size="sm"
            animate="draw"
            style={{ width: 44, height: 3 }}
          />
        </span>
      )}
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
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Top stats</h3>
      </div>

      <div className={compact ? 'p-4 space-y-4' : 'p-5 space-y-4'}>
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-[var(--text-primary)]">
          <span className="flex min-w-0 items-center gap-1.5">
            <ClubColorBar color="var(--team-tint-home, var(--accent-primary))" team={homeTeam} size="sm" />
            <span className="truncate">{homeTeam}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-right">{awayTeam}</span>
            <ClubColorBar color="var(--team-tint-away, var(--accent-info))" team={awayTeam} size="sm" />
          </span>
        </div>

        {/* Every row uses the FotMob centred dual-bar grammar — home value,
            label, away value, with proportional bars meeting in the middle. */}
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
        <SplitStatBar label="Total shots" homeValue={stats.shots[0]} awayValue={stats.shots[1]} />
        <SplitStatBar label="Corners" homeValue={stats.corners[0]} awayValue={stats.corners[1]} />
        <SplitStatBar label="Fouls" homeValue={stats.fouls[0]} awayValue={stats.fouls[1]} lowerIsBetter />
      </div>
    </div>
  )
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
      <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
        <div className="p-4 border-b flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: 'var(--border-color)' }}>
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-[var(--accent-ai)]">Live Probability</p>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Awaiting complete live data</h3>
          </div>
          <span className="rounded-full border border-[color-mix(in_srgb,var(--accent-warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-warn)_10%,transparent)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent-warn)]">
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
    { key: 'home_win' as const, label: match.home_team, shortLabel: 'Home', color: 'var(--accent-primary)' },
    { key: 'draw' as const, label: 'Draw', shortLabel: 'Draw', color: 'var(--accent-warn)' },
    { key: 'away_win' as const, label: match.away_team, shortLabel: 'Away', color: 'var(--accent-info)' },
  ]

  return (
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
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
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
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
                    <p className={`text-[10px] font-bold ${value >= prior[outcome.key] ? 'text-[var(--accent-primary)]' : 'text-[var(--accent-loss)]'}`}>
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

/**
 * "What the model sees" — a small pure rule engine that turns the fields the
 * page already holds (win probabilities, table positions, head-to-head record,
 * goal expectancy) into 2–4 tone-tagged football insights for `NarrativeCard`.
 * Every rule checks its underlying field first; when nothing fires the card
 * renders nothing (no fabricated angles).
 */
function buildModelInsights(match: MatchDetails): NarrativeInsight[] {
  const insights: NarrativeInsight[] = []
  const p = match.prediction
  if (!p) return insights

  // 1) Pick clarity — clear lean is an edge, a coin-flip is a risk.
  const ranked = getPredictionRank(match)
  const leader = ranked[0]
  const runnerUp = ranked[1]
  if (leader && runnerUp) {
    const margin = Math.round((leader.value - runnerUp.value) * 100)
    if (margin >= 12) {
      insights.push({
        tone: 'edge',
        title: `Clear lean: ${leader.label}`,
        detail: `${formatProbability(leader.value)} win probability, ${margin} points clear of the next most likely result.`,
      })
    } else if (margin < 7) {
      insights.push({
        tone: 'risk',
        title: 'Tight call',
        detail: `Only ${margin} point${margin === 1 ? '' : 's'} separate ${leader.shortLabel.toLowerCase()} and ${runnerUp.shortLabel.toLowerCase()} — this one could swing either way.`,
      })
    }
  }

  // 2) League table gap — only when both teams sit in the same table.
  if (match.homeStanding && match.awayStanding) {
    const posGap = match.awayStanding.position - match.homeStanding.position
    const ptsGap = match.homeStanding.points - match.awayStanding.points
    if (Math.abs(posGap) >= 5) {
      const stronger = posGap > 0 ? match.home_team : match.away_team
      insights.push({
        tone: 'edge',
        title: `${stronger} arrive as the form side`,
        detail: `#${match.homeStanding.position} vs #${match.awayStanding.position} in the table${
          Math.abs(ptsGap) > 0 ? `, a ${Math.abs(ptsGap)}-point gap` : ''
        }.`,
      })
    } else if (Math.abs(posGap) <= 1) {
      insights.push({
        tone: 'note',
        title: 'Little between them',
        detail: `The sides sit #${match.homeStanding.position} and #${match.awayStanding.position} — a genuine peer matchup.`,
      })
    }
  }

  // 3) Head-to-head history — needs a real sample.
  const h2hTotal = match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins
  if (h2hTotal >= 4) {
    const homeShare = match.h2h.homeWins / h2hTotal
    const awayShare = match.h2h.awayWins / h2hTotal
    const record = `${match.h2h.homeWins}–${match.h2h.draws}–${match.h2h.awayWins}`
    if (homeShare >= 0.6 || awayShare >= 0.6) {
      const owner = homeShare >= 0.6 ? match.home_team : match.away_team
      insights.push({
        tone: 'watch',
        title: `${owner} own this fixture`,
        detail: `${homeShare >= 0.6 ? match.h2h.homeWins : match.h2h.awayWins} wins in the last ${h2hTotal} meetings (${record}).`,
      })
    } else if (match.h2h.draws / h2hTotal >= 0.4) {
      insights.push({
        tone: 'watch',
        title: 'Draw-heavy history',
        detail: `${match.h2h.draws} of the last ${h2hTotal} meetings ended level (${record}).`,
      })
    }
  }

  // 4) Goal expectancy.
  const totalGoals = p.total_goals ?? p.predicted_score.home + p.predicted_score.away
  if (Number.isFinite(totalGoals)) {
    const overText =
      p.over_2_5 !== undefined ? ` Over 2.5 goals is priced at ${formatProbability(p.over_2_5)}.` : ''
    if (totalGoals >= 3.0) {
      insights.push({
        tone: 'watch',
        title: 'Goals expected',
        detail: `Expected total of ${totalGoals.toFixed(1)} goals.${overText}`,
      })
    } else if (totalGoals <= 2.0) {
      insights.push({
        tone: 'note',
        title: 'Low-scoring profile',
        detail: `Expected total of just ${totalGoals.toFixed(1)} goals.${overText}`,
      })
    }
  }

  // 5) Both ends threatened.
  if (p.btts_yes !== undefined && p.btts_yes >= 0.62) {
    insights.push({
      tone: 'watch',
      title: 'Both ends threatened',
      detail: `Both teams to score is priced at ${formatProbability(p.btts_yes)}.`,
    })
  }

  return insights.slice(0, 4)
}

export default function MatchDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const matchId = params.id as string
  const leagueId = searchParams.get('league') || ''
  
  const { asQueryParam: genderParam } = useGenderQuery()
  const reduceMotion = useReducedMotion()
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
  }, [matchId, leagueId, retryCount, genderParam]) // retryCount triggers refetch when incremented

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
      <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }} aria-busy="true">
        <MatchDetailSkeleton />
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
              className="px-6 py-3 rounded-xl bg-[var(--accent-primary)] text-[var(--accent-on-primary)] font-semibold hover:opacity-90 transition-opacity"
            >
              Browse matches
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

  // Live minute label for the StickyScoreBar — falls back to match.status.
  const liveMinuteLabel = isLive ? (match.minute ?? match.status) : null

  // National-team fixtures resolve identities to country flags (rule 2).
  const isNational = isNationalTeamMatch(match.leagueId, match.league)

  const leagueAccent = getLeagueAccent(match.leagueId ?? match.league)

  return (
    <div
      className="min-h-screen"
      style={{
        // Team tint tokens consumed by H2H bars, lineups and standings
        // highlights further down the page (green home / league-brand away).
        ['--team-tint-home' as string]: 'var(--accent-primary)',
        ['--team-tint-away' as string]: leagueAccent?.accent || 'var(--accent-info)',
      }}
    >
      <StickyScoreBar
        heroRef={heroRef}
        homeName={match.home_team}
        awayName={match.away_team}
        homeCountry={isNational ? match.home_team : undefined}
        awayCountry={isNational ? match.away_team : undefined}
        homeTeamId={match.home_team_id}
        awayTeamId={match.away_team_id}
        homeScore={match.home_score}
        awayScore={match.away_score}
        isLive={isLive}
        liveMinute={liveMinuteLabel}
        statusLabel={isFinished ? 'FT' : isScheduled ? 'Scheduled' : match.status}
      />
      {/* Scoreboard header — flat card, ESPN grammar: league line, teams +
          score (or kickoff), status, venue. No gradients, no glows. */}
      <section ref={heroRef} className="border-b border-[var(--border-color)] bg-[var(--card-bg)]">
        <div className="mx-auto w-full max-w-5xl px-4 pb-5 pt-2 md:px-8">
          {/* Back link */}
          <button
            onClick={handleBack}
            className="group mb-2 -ml-2 inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to {match.league || 'matches'}</span>
          </button>

          {/* League line */}
          <div className="mb-4 flex items-center justify-center gap-2">
            {leagueAccent?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={leagueAccent.logoUrl} alt="" className="h-4 w-4 object-contain" aria-hidden="true" />
            )}
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              {leagueAccent && leagueAccent.competitionId !== 'unknown'
                ? leagueAccent.displayName
                : match.league}
            </span>
          </div>

          {/* Score block — three columns */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-6">
            {/* Home team */}
            <div className="min-w-0 text-right">
              <TeamNameWithCrest
                name={match.home_team}
                teamId={match.home_team_id}
                align="right"
                isNational={isNational}
                accent="var(--team-tint-home, var(--accent-primary))"
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

            {/* Score / kickoff */}
            <div className="flex-shrink-0 px-2 text-center">
              {isScheduled ? (
                <div>
                  <p className="font-numeric text-[clamp(1.4rem,3.4vw,2rem)] font-bold leading-none tabular-nums text-[var(--text-primary)]">
                    {(() => {
                      try {
                        return new Date(match.date).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: false,
                        })
                      } catch {
                        return 'TBD'
                      }
                    })()}
                  </p>
                </div>
              ) : (
                <motion.div
                  className="flex items-center gap-3 md:gap-4"
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <span className="font-numeric text-[clamp(2rem,5vw,3rem)] font-extrabold leading-none tabular-nums text-[var(--text-primary)]">
                    {match.home_score}
                  </span>
                  <span className="text-[clamp(1.2rem,3vw,1.8rem)] font-bold leading-none text-[var(--text-tertiary)]">
                    –
                  </span>
                  <span className="font-numeric text-[clamp(2rem,5vw,3rem)] font-extrabold leading-none tabular-nums text-[var(--text-primary)]">
                    {match.away_score}
                  </span>
                </motion.div>
              )}

              {/* Status line */}
              <div className="mt-1.5">
                {isLive && !isHalftime && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold tabular-nums text-[var(--live-text)]">
                    <span className="relative inline-flex h-1.5 w-1.5">
                      <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-loss)]" />
                    </span>
                    {match.minute != null ? `${match.minute}'` : 'Live'}
                  </span>
                )}
                {isHalftime && (
                  <span className="text-xs font-bold text-[var(--accent-warn)]">
                    HT{halftimeCountdown ? ` · ${halftimeCountdown}` : ''}
                  </span>
                )}
                {isFinished && (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                    FT
                  </span>
                )}
                {isScheduled && (
                  <span className="text-[11px] font-medium text-[var(--text-tertiary)]">
                    {(() => {
                      try {
                        return new Date(match.date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })
                      } catch {
                        return ''
                      }
                    })()}
                  </span>
                )}
              </div>
            </div>

            {/* Away team */}
            <div className="min-w-0 text-left">
              <TeamNameWithCrest
                name={match.away_team}
                teamId={match.away_team_id}
                align="left"
                isNational={isNational}
                accent="var(--team-tint-away, var(--accent-info))"
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

          {/* Venue + date line — small, quiet */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
            <span>{formatDate(match.date)}</span>
            {match.venue && (
              <>
                <span aria-hidden="true">·</span>
                <span>{match.venue}</span>
              </>
            )}
          </div>

          {/* Follow buttons + provenance — one quiet row */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {[match.home_team, match.away_team].map((teamName) => {
              const tracked = isTeamTracked(teamName)
              return (
                <button
                  key={teamName}
                  onClick={() => trackTeam(teamName)}
                  disabled={tracked}
                  className={cn(
                    'inline-flex min-h-[36px] max-w-[220px] items-center gap-1.5 truncate rounded-full px-3 text-xs font-semibold transition-colors',
                    tracked
                      ? 'cursor-default text-[var(--accent-primary)]'
                      : 'text-[var(--text-tertiary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-secondary)]'
                  )}
                >
                  {tracked ? (
                    <>
                      <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Following {teamName}
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                      Follow {teamName}
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Tab row — underline grammar (green bar on active), same as DateStrip */}
      <div className="sticky top-[var(--shell-topbar-h)] z-10 border-b border-[var(--nav-border)] bg-[var(--nav-bg)] backdrop-blur-md">
        <div
          className="mx-auto flex w-full max-w-4xl items-stretch overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Match sections"
        >
          {DETAIL_TABS.map((tab) => {
            const active = activeTab === tab
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'relative flex min-h-[44px] items-center justify-center whitespace-nowrap px-4 text-xs font-semibold transition-colors',
                  active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                )}
              >
                {DETAIL_TAB_LABELS[tab]}
                {active && (
                  <motion.span
                    {...(reduceMotion ? {} : { layoutId: 'matchdetail-tab-active', transition: springSnappy })}
                    className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-[var(--accent-primary)]"
                    aria-hidden
                  />
                )}
              </button>
            )
          })}
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

            {/* ── AI pick card — club-coloured OutcomeBars + scoreline heatmap ── */}
            {match.prediction && (() => {
              const p = match.prediction
              const crest = (teamId?: string) =>
                !isNational && teamId
                  ? `https://a.espncdn.com/i/teamlogos/soccer/500/${teamId}.png`
                  : undefined
              const outcomeRows: OutcomeBarDatum[] = [
                {
                  label: match.home_team,
                  probability: p.home_win,
                  color: 'var(--team-tint-home, var(--accent-primary))',
                  crestUrl: crest(match.home_team_id),
                  sublabel: 'Home',
                },
                { label: 'Draw', probability: p.draw, color: 'var(--accent-warn)' },
                {
                  label: match.away_team,
                  probability: p.away_win,
                  color: 'var(--team-tint-away, var(--accent-info))',
                  crestUrl: crest(match.away_team_id),
                  sublabel: 'Away',
                },
              ]
              const scorelineCells: ScorelineCell[] = (p.derived_markets?.correct_score_top5 ?? [])
                .filter((s) => Number.isFinite(s.probability) && s.probability > 0)
                .map((s) => ({ home: s.home, away: s.away, probability: s.probability }))
              const totalGoals = p.total_goals ?? p.predicted_score.home + p.predicted_score.away
              const quickMarkets: Array<{ label: string; value: string }> = [
                ...(Number.isFinite(totalGoals)
                  ? [{ label: 'Total goals', value: totalGoals.toFixed(1) }]
                  : []),
                ...(p.over_2_5 !== undefined
                  ? [{ label: 'Over 2.5', value: `${Math.round(p.over_2_5 * 100)}%` }]
                  : []),
                ...(p.btts_yes !== undefined
                  ? [{ label: 'BTTS', value: `${Math.round(p.btts_yes * 100)}%` }]
                  : []),
              ]
              return (
                <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
                  <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
                    <Sparkles className="h-4 w-4 text-[var(--accent-ai)]" aria-hidden />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI pick</h3>
                    {/* Confidence as a quiet chip — no gauges. */}
                    <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">
                      <span className="tabular-nums text-[var(--text-primary)]">{p.confidence}%</span>
                      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                        {p.confidence_band ?? 'Medium'} confidence
                      </span>
                    </span>
                  </div>

                  <div className="p-4">
                    <div
                      className={cn(
                        'grid grid-cols-1 gap-6',
                        scorelineCells.length >= 3 && 'md:grid-cols-[minmax(0,1fr)_minmax(0,300px)]'
                      )}
                    >
                      <div className="min-w-0">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                          Win probability
                        </p>
                        <OutcomeBars data={outcomeRows} sorted={false} />
                        {quickMarkets.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {quickMarkets.map((m) => (
                              <span
                                key={m.label}
                                className="inline-flex items-baseline gap-1.5 rounded border border-[var(--border-color)] bg-[var(--muted-bg)] px-2 py-1 text-[11px]"
                              >
                                <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                                  {m.label}
                                </span>
                                <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                                  {m.value}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Scoreline probability grid — only from committed top
                          scorelines; predicted (peak) cell outlined. */}
                      {scorelineCells.length >= 3 && (
                        <div className="min-w-0">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                            Scoreline probabilities
                          </p>
                          {/* Heatmap height ≈ width (square grid + 48px axes);
                              cap the width so the reserved box never clips. */}
                          <ChartContainer height={300} label="Loading scoreline probabilities">
                            <div style={{ maxWidth: 296 }}>
                              <ScorelineHeatmap cells={scorelineCells} maxGoals={4} />
                            </div>
                          </ChartContainer>
                        </div>
                      )}
                    </div>

                    {isFinished && match.home_score !== null && match.away_score !== null && (() => {
                      const accuracy = getPredictionAccuracy()
                      return accuracy.message ? (
                        <div className="mt-4 border-t border-[var(--border-color)] pt-3">
                          <p className={`inline-flex w-full items-center justify-center gap-1.5 text-center text-xs font-semibold ${
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
              )
            })()}

            <LiveWinProbabilityPanel match={match} />

            {/* ── What the model sees — rule-engine narrative angles ── */}
            {match.prediction && (
              <NarrativeCard heading="What the model sees" insights={buildModelInsights(match)} />
            )}

            {/* ── Events Timeline ── */}
            {match.events.length > 0 && (
              <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
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
            <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
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
                                className="h-full rounded-full bg-[var(--accent-primary)]"
                                style={{ width: `${Math.min(100, (match.attendance / match.capacity) * 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-medium text-[var(--accent-primary)]">
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
                  <CalendarDays className="h-5 w-5 text-[var(--text-secondary)]" aria-hidden />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formatDate(match.date)}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{match.league}</p>
                  </div>
                </div>
                {/* Referee */}
                {match.referee && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Scale className="h-5 w-5 text-[var(--text-secondary)]" aria-hidden />
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
              <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
                    <Swords className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden /> Head-to-Head &amp; Form
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
                        <div className="flex h-6 rounded-lg overflow-hidden text-xs font-bold tabular-nums text-[var(--accent-on-primary)]">
                          {homePct > 0 && (
                            <div className="bg-[var(--team-tint-home)] flex items-center justify-center" style={{ width: `${homePct}%` }}>
                              {match.h2h.homeWins}W
                            </div>
                          )}
                          {drawPct > 0 && (
                            <div className="bg-[var(--accent-warn)] flex items-center justify-center" style={{ width: `${drawPct}%` }}>
                              {match.h2h.draws}D
                            </div>
                          )}
                          {awayPct > 0 && (
                            <div className="bg-[var(--team-tint-away)] flex items-center justify-center" style={{ width: `${awayPct}%` }}>
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
                              <span className={`flex-1 text-right pr-2 ${homeWon ? 'font-semibold text-[var(--team-tint-home)]' : 'text-[var(--text-secondary)]'}`}>
                                {m.homeTeam || match.home_team}
                              </span>
                              <span className="font-bold text-[var(--text-primary)] px-2">
                                {m.home_score} - {m.away_score}
                              </span>
                              <span className={`flex-1 text-left pl-2 ${awayWon ? 'font-semibold text-[var(--team-tint-away)]' : 'text-[var(--text-secondary)]'}`}>
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
                              <span className="w-2 h-2 rounded-full bg-[var(--team-tint-home)]" />
                              <span className="text-sm font-medium text-[var(--text-primary)]">{match.home_team}</span>
                              <span className="text-xs text-[var(--text-tertiary)] ml-auto">#{match.homeStanding.position}</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 text-center text-xs">
                              <div><p className="text-[var(--text-tertiary)]">P</p><p className="font-medium text-[var(--text-primary)]">{match.homeStanding.played}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">W</p><p className="font-medium text-[var(--accent-primary)]">{match.homeStanding.won}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">D</p><p className="font-medium text-[var(--accent-warn)]">{match.homeStanding.drawn}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">L</p><p className="font-medium text-[var(--accent-loss)]">{match.homeStanding.lost}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">Pts</p><p className="font-bold text-[var(--text-primary)]">{match.homeStanding.points}</p></div>
                            </div>
                          </div>
                        )}
                        {match.awayStanding && (
                          <div className="bg-[var(--muted-bg)] rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="w-2 h-2 rounded-full bg-[var(--team-tint-away)]" />
                              <span className="text-sm font-medium text-[var(--text-primary)]">{match.away_team}</span>
                              <span className="text-xs text-[var(--text-tertiary)] ml-auto">#{match.awayStanding.position}</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 text-center text-xs">
                              <div><p className="text-[var(--text-tertiary)]">P</p><p className="font-medium text-[var(--text-primary)]">{match.awayStanding.played}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">W</p><p className="font-medium text-[var(--accent-primary)]">{match.awayStanding.won}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">D</p><p className="font-medium text-[var(--accent-warn)]">{match.awayStanding.drawn}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">L</p><p className="font-medium text-[var(--accent-loss)]">{match.awayStanding.lost}</p></div>
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
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <MessageSquareText className="h-4 w-4" aria-hidden /> Commentary
                </h3>
                <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
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
              <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)]">{match.home_team}</h3>
                  {match.lineups.homeFormation && (
                    <span className="text-sm font-mono px-3 py-1 rounded-full bg-[var(--team-tint-home)]/20 text-[var(--team-tint-home)]">
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
                          <span className="w-5 h-5 rounded-full bg-[var(--team-tint-home)] text-[var(--accent-on-primary)] text-xs tabular-nums flex items-center justify-center">{player.jersey || idx + 1}</span>
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
              <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)]">{match.away_team}</h3>
                  {match.lineups.awayFormation && (
                    <span className="text-sm font-mono px-3 py-1 rounded-full bg-[var(--team-tint-away)]/20 text-[var(--team-tint-away)]">
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
                          <span className="w-5 h-5 rounded-full bg-[var(--team-tint-away)] text-[var(--accent-on-primary)] text-xs tabular-nums flex items-center justify-center">{player.jersey || idx + 1}</span>
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
            
            {/* Full League Standings Table — hidden entirely when the league
                has no table (missing data renders nothing). */}
            {match.fullStandings && match.fullStandings.length > 0 && (
            <div className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-md font-medium text-[var(--text-primary)]">{match.league} Standings</h4>
              </div>
              {(
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
                                    ? 'bg-[var(--team-tint-home)]/20 border-l-4 border-l-[var(--team-tint-home)]' 
                                    : 'bg-[var(--team-tint-away)]/20 border-l-4 border-l-[var(--team-tint-away)]'
                                  : 'hover:bg-[var(--muted-bg)]'
                              }`}
                              style={{ borderColor: 'var(--border-color)' }}
                            >
                              <td className={`py-2 px-3 ${isHighlighted ? 'font-bold' : ''}`} style={{ color: 'var(--text-secondary)' }}>
                                {team.position}
                              </td>
                              <td className={`py-2 px-3 ${isHighlighted ? 'font-bold text-[var(--team-tint-home)]' : 'font-medium'} ${isAwayTeam ? 'text-[var(--team-tint-away)]' : ''}`} style={{ color: isHighlighted ? undefined : 'var(--text-primary)' }}>
                                {team.teamName}
                                {isHighlighted && (
                                  <span className="ml-2 text-xs">
                                    {isHomeTeam ? '(H)' : '(A)'}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center" style={{ color: 'var(--text-secondary)' }}>{team.played}</td>
                              <td className="py-2 px-3 text-center text-[var(--accent-primary)]">{team.won}</td>
                              <td className="py-2 px-3 text-center" style={{ color: 'var(--text-tertiary)' }}>{team.drawn}</td>
                              <td className="py-2 px-3 text-center text-[var(--accent-loss)]">{team.lost}</td>
                              <td className={`py-2 px-3 text-center font-bold ${isHomeTeam ? 'text-[var(--team-tint-home)]' : ''} ${isAwayTeam ? 'text-[var(--team-tint-away)]' : ''}`} style={{ color: isHighlighted ? undefined : 'var(--text-primary)' }}>
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
                      <div className="w-3 h-3 bg-[var(--team-tint-home)]/20 border-l-2 border-l-[var(--team-tint-home)]" />
                      <span>{match.home_team}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-[var(--team-tint-away)]/20 border-l-2 border-l-[var(--team-tint-away)]" />
                      <span>{match.away_team}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            )}
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
