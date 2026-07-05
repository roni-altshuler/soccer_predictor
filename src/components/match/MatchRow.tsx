'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'

import { type FormEntry } from '@/components/match/TeamFormPill'
import { FlagBadge, Prob1X2 } from '@/components/primitives'
import { Badge } from '@/components/ui/badge'
import { cn, clamp } from '@/lib/utils'

/**
 * Canonical fixture row — Matchday v3 (FotMob grammar, stacked teams):
 *
 *   | time/status col | crest + Team A ... score |  1X2 boxes · pick chip |
 *   |                 | crest + Team B ... score |  (committed picks only)|
 *
 * One 56–64px unit; the whole row is the link. The AI zone renders ONLY
 * when the payload carries committed model probabilities — no fabrication
 * for uncovered fixtures. National-team fixtures (`is_national`) resolve to
 * country flags via `FlagBadge`; clubs use their crest URL.
 */

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'completed'

export interface MatchRowMatch {
  id?: string
  home_team: string
  away_team: string
  home_score?: number | null
  away_score?: number | null
  time?: string
  status: MatchStatus | string
  minute?: number | string | null
  venue?: string | null
  home_crest_url?: string | null
  away_crest_url?: string | null
  /** National-team fixture — identities resolve to country flags. */
  is_national?: boolean
  /** Optional probability lean from the unified model. 0..1 each. */
  ai_home_prob?: number | null
  ai_draw_prob?: number | null
  ai_away_prob?: number | null
  /** Optional 0..1 model confidence; if absent, derived from max probability. */
  ai_confidence?: number | null
  /** Committed predicted scoreline, e.g. "2-1". */
  predicted_scoreline?: string | null
  /** Optional recent form strings (e.g. "WDLLW") for inline pills. */
  home_form?: string | FormEntry[] | null
  away_form?: string | FormEntry[] | null
  /** Optional league accent colour for the crest fallback background. */
  league_accent?: string | null
}

function formatKickoff(timeStr?: string): string {
  if (!timeStr) return 'TBD'
  try {
    return new Date(timeStr).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return 'TBD'
  }
}

/** Fixed-width left column: kickoff time, live minute, or FT. */
function StatusColumn({ match }: { match: MatchRowMatch }) {
  const status = match.status?.toString().toLowerCase()
  if (status === 'live') {
    return (
      <div className="flex w-[52px] shrink-0 flex-col items-center justify-center">
        <span className="text-xs font-bold tabular-nums text-[var(--live-text)]">
          {match.minute ? `${match.minute}'` : 'LIVE'}
        </span>
        <span className="relative mt-1 inline-flex h-1.5 w-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-loss)]" />
        </span>
      </div>
    )
  }
  if (status === 'finished' || status === 'completed') {
    return (
      <div className="flex w-[52px] shrink-0 items-center justify-center">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          FT
        </span>
      </div>
    )
  }
  return (
    <div className="flex w-[52px] shrink-0 items-center justify-center">
      <span className="text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
        {formatKickoff(match.time)}
      </span>
    </div>
  )
}

function TeamLine({
  name,
  crestUrl,
  isNational,
  score,
  showScore,
  emphasis,
}: {
  name: string
  crestUrl?: string | null
  isNational?: boolean
  score: number | null
  showScore: boolean
  emphasis: 'winner' | 'loser' | 'neutral'
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="inline-flex shrink-0" aria-hidden="true">
        <FlagBadge
          teamName={name}
          country={isNational ? name : undefined}
          logoUrl={isNational ? undefined : crestUrl ?? undefined}
          size={20}
        />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px]',
          emphasis === 'winner' && 'font-semibold text-[var(--text-primary)]',
          emphasis === 'loser' && 'font-medium text-[var(--text-tertiary)]',
          emphasis === 'neutral' && 'font-medium text-[var(--text-primary)]'
        )}
      >
        {name}
      </span>
      {showScore && (
        <span
          className={cn(
            'shrink-0 pl-2 text-[13px] font-bold tabular-nums',
            emphasis === 'loser' ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'
          )}
        >
          {score ?? 0}
        </span>
      )}
    </div>
  )
}

export interface MatchRowProps {
  match: MatchRowMatch
  href?: string
  showFavoriteToggle?: boolean
  onToggleFavorite?: (match: MatchRowMatch) => void
  isFavorite?: boolean
  showAILean?: boolean
}

export function MatchRow({
  match,
  href,
  showFavoriteToggle = false,
  onToggleFavorite,
  isFavorite = false,
  showAILean = true,
}: MatchRowProps) {
  const hasAILean =
    showAILean &&
    typeof match.ai_home_prob === 'number' &&
    typeof match.ai_draw_prob === 'number' &&
    typeof match.ai_away_prob === 'number'
  const aiHome = clamp(match.ai_home_prob ?? 0)
  const aiDraw = clamp(match.ai_draw_prob ?? 0)
  const aiAway = clamp(match.ai_away_prob ?? 0)
  const predictedScoreline =
    hasAILean && typeof match.predicted_scoreline === 'string' && match.predicted_scoreline.length > 0
      ? match.predicted_scoreline
      : null

  const status = match.status?.toString().toLowerCase()
  const isFinished = status === 'finished' || status === 'completed'
  const isLive = status === 'live'
  const showScore = isFinished || isLive
  const homeScore = match.home_score ?? null
  const awayScore = match.away_score ?? null

  // Finished matches dim the loser (FotMob grammar); live/scheduled stay neutral.
  let homeEmphasis: 'winner' | 'loser' | 'neutral' = 'neutral'
  let awayEmphasis: 'winner' | 'loser' | 'neutral' = 'neutral'
  if (isFinished && homeScore !== null && awayScore !== null && homeScore !== awayScore) {
    homeEmphasis = homeScore > awayScore ? 'winner' : 'loser'
    awayEmphasis = awayScore > homeScore ? 'winner' : 'loser'
  }

  const inner = (
    <div className="flex w-full items-center">
      {showFavoriteToggle && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggleFavorite?.(match)
          }}
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            'text-[var(--text-tertiary)] hover:text-[var(--accent-warn)]',
            isFavorite && 'text-[var(--accent-warn)]'
          )}
          aria-label={isFavorite ? 'Unfollow match' : 'Follow match'}
        >
          <Star className="h-4 w-4" fill={isFavorite ? 'currentColor' : 'none'} strokeWidth={2} />
        </button>
      )}

      <StatusColumn match={match} />

      <div className="min-w-0 flex-1 space-y-1.5 border-l border-[var(--border-color)]/60 py-2 pl-3">
        <TeamLine
          name={match.home_team}
          crestUrl={match.home_crest_url}
          isNational={match.is_national}
          score={homeScore}
          showScore={showScore}
          emphasis={homeEmphasis}
        />
        <TeamLine
          name={match.away_team}
          crestUrl={match.away_crest_url}
          isNational={match.is_national}
          score={awayScore}
          showScore={showScore}
          emphasis={awayEmphasis}
        />
      </div>

      {hasAILean && (
        <div className="ml-3 flex shrink-0 items-center gap-2 pr-1">
          <Prob1X2 home={aiHome} draw={aiDraw} away={aiAway} className="hidden sm:flex" />
          <Prob1X2 home={aiHome} draw={aiDraw} away={aiAway} compact className="sm:hidden" />
          {predictedScoreline && (
            <span className="hidden shrink-0 items-center rounded-md bg-[var(--accent-ai)]/10 px-1.5 py-1 text-[10px] font-semibold tabular-nums text-[var(--accent-ai)] lg:inline-flex">
              AI {predictedScoreline}
            </span>
          )}
        </div>
      )}
    </div>
  )

  const className = cn(
    'group relative block w-full px-3 transition-colors',
    'min-h-[56px]',
    'hover:bg-[var(--card-hover)] focus-visible:bg-[var(--card-hover)] focus-visible:outline-none'
  )

  if (!href) {
    return <div className={className}>{inner}</div>
  }
  return (
    <Link href={href} className={className} prefetch={false}>
      {inner}
    </Link>
  )
}

/** Animated container that staggers rows on mount. */
export function MatchRowList({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.02 } },
        hidden: {},
      }}
      className={cn('divide-y divide-[var(--border-color)]/40', className)}
    >
      {Array.isArray(children)
        ? children.map((child, idx) => (
            <motion.div
              key={(child as { key?: string })?.key ?? idx}
              variants={{
                hidden: { opacity: 0 },
                visible: { opacity: 1, transition: { duration: 0.2 } },
              }}
            >
              {child}
            </motion.div>
          ))
        : children}
    </motion.div>
  )
}

export function StatusPill({
  label,
  count,
  tone = 'neutral',
}: {
  label: string
  count?: number
  tone?: 'live' | 'upcoming' | 'finished' | 'neutral'
}) {
  const toneStyles: Record<string, string> = {
    live: 'border-[var(--live-border)] bg-[var(--live-bg)] text-[var(--live-text)]',
    upcoming: 'border-[color-mix(in_srgb,var(--accent-ai)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-ai)_10%,transparent)] text-[var(--accent-ai)]',
    finished: 'border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]',
    neutral: 'border-[var(--border-color)] text-[var(--text-secondary)]',
  }
  return (
    <Badge variant="outline" className={cn('font-semibold uppercase tracking-wide', toneStyles[tone])}>
      {label}
      {typeof count === 'number' && <span className="ml-1 text-[10px] opacity-80">({count})</span>}
    </Badge>
  )
}
