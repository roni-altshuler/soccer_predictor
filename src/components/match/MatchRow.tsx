'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'

import { TeamFormPill, type FormEntry } from '@/components/match/TeamFormPill'
import { FlagBadge, ProbBar } from '@/components/primitives'
import { Badge } from '@/components/ui/badge'
import { cn, clamp } from '@/lib/utils'

/**
 * Canonical fixture row — the design-language anatomy applied everywhere:
 *
 *   crest/flag + team names · kickoff/status · venue (tertiary, truncates)
 *   · ProbBar when a committed prediction exists · predicted-score chip
 *   (cyan tint) when available.
 *
 * - National-team fixtures (`is_national`) resolve identities to real
 *   country flags via `FlagBadge`; clubs use their crest URL. The gray
 *   monogram is a last-resort fallback, never the default for known teams.
 * - The ProbBar renders ONLY when the payload carries committed model
 *   probabilities — no fabrication for uncovered fixtures.
 * - 52px+ tap target on mobile.
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

function TeamIdentity({
  url,
  name,
  align,
  isNational,
}: {
  url?: string | null
  name: string
  align: 'left' | 'right'
  isNational?: boolean
}) {
  const margin = align === 'right' ? 'order-2 ml-2' : 'mr-2'
  return (
    <span className={cn('inline-flex shrink-0', margin)} aria-hidden="true">
      <FlagBadge
        teamName={name}
        // National teams get real country flags; clubs get their crest.
        country={isNational ? name : undefined}
        logoUrl={isNational ? undefined : url ?? undefined}
        size={26}
      />
    </span>
  )
}

function StatusBlock({ match }: { match: MatchRowMatch }) {
  const status = match.status?.toString().toLowerCase()
  if (status === 'live') {
    const homeScore = match.home_score ?? 0
    const awayScore = match.away_score ?? 0
    return (
      <div className="flex w-24 flex-col items-center">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{homeScore}</span>
          <span className="text-xs text-[var(--text-tertiary)]">–</span>
          <span className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{awayScore}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-loss)]" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--live-text)]">
            {match.minute ? `${match.minute}'` : 'LIVE'}
          </span>
        </div>
      </div>
    )
  }
  if (status === 'finished' || status === 'completed') {
    const homeScore = match.home_score ?? 0
    const awayScore = match.away_score ?? 0
    return (
      <div className="flex w-24 flex-col items-center">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold tabular-nums text-[var(--text-secondary)]">{homeScore}</span>
          <span className="text-xs text-[var(--text-tertiary)]">–</span>
          <span className="text-xl font-bold tabular-nums text-[var(--text-secondary)]">{awayScore}</span>
        </div>
        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">FT</span>
      </div>
    )
  }
  return (
    <div className="flex w-24 flex-col items-center">
      <span className="text-base font-semibold tabular-nums text-[var(--accent-primary)]">
        {formatKickoff(match.time)}
      </span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        Kick-off
      </span>
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

  const isFinished = match.status === 'finished' || match.status === 'completed'
  const teamTextClass = isFinished ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'

  const body = (
    <div className="flex w-full items-center gap-2">
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

      <div className="flex min-w-0 flex-1 items-center">
        <div className="flex min-w-0 flex-1 items-center justify-end overflow-hidden text-right">
          {match.home_form && (
            <TeamFormPill
              form={match.home_form}
              size="xs"
              className="mr-2 hidden sm:inline-flex"
              teamName={match.home_team}
            />
          )}
          <span className={cn('truncate text-sm font-semibold', teamTextClass)}>{match.home_team}</span>
          <TeamIdentity
            url={match.home_crest_url}
            name={match.home_team}
            align="right"
            isNational={match.is_national}
          />
        </div>

        <StatusBlock match={match} />

        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          <TeamIdentity
            url={match.away_crest_url}
            name={match.away_team}
            align="left"
            isNational={match.is_national}
          />
          <span className={cn('truncate text-sm font-semibold', teamTextClass)}>{match.away_team}</span>
          {match.away_form && (
            <TeamFormPill
              form={match.away_form}
              size="xs"
              className="ml-2 hidden sm:inline-flex"
              teamName={match.away_team}
            />
          )}
        </div>
      </div>
    </div>
  )

  const inner = (
    <div className="w-full">
      {body}
      {hasAILean && (
        <div className="mt-2">
          <ProbBar home={aiHome} draw={aiDraw} away={aiAway} size="sm" showLabels />
        </div>
      )}
      {(match.venue || predictedScoreline) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-tertiary)]">
            {match.venue}
          </div>
          {predictedScoreline && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-ai)]/12 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--accent-ai)]">
              AI pick {predictedScoreline}
            </span>
          )}
        </div>
      )}
    </div>
  )

  const className = cn(
    'group relative block w-full rounded-md px-3 py-2.5 transition-colors',
    'min-h-[52px]',
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
        visible: { transition: { staggerChildren: 0.025 } },
        hidden: {},
      }}
      className={cn('divide-y divide-[var(--border-color)]/40', className)}
    >
      {Array.isArray(children)
        ? children.map((child, idx) => (
            <motion.div
              key={(child as { key?: string })?.key ?? idx}
              variants={{
                hidden: { opacity: 0, y: 6 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } },
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
