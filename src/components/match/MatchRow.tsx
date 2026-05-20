'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn, formatPct } from '@/lib/utils'

/**
 * Canonical FotMob-style match row.
 *
 * Layout (left → right):
 *   ┌────────┬─────────────────────┬───────┬─────────────────────┬────────┐
 *   │ status │  home team (right)  │ score │  away team (left)   │ extras │
 *   └────────┴─────────────────────┴───────┴─────────────────────┴────────┘
 *
 * - Status column: kickoff time, or live minute with red pulse, or "FT".
 * - Both team columns reserve room for a 24px crest; falls back to a
 *   stylised first-letter circle when no crest is supplied.
 * - The extras column hosts the AI lean bar + the user's favourite star.
 *
 * The row is fully clickable when `href` is supplied.
 */

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'completed'

export interface MatchRowMatch {
  id?: string
  home_team: string
  away_team: string
  home_score?: number | null
  away_score?: number | null
  time?: string                // ISO datetime for upcoming
  status: MatchStatus | string // tolerate unknown server values
  minute?: number | string | null
  venue?: string | null
  home_crest_url?: string | null
  away_crest_url?: string | null
  /** Optional probability lean from the unified model. 0..1 each. */
  ai_home_prob?: number | null
  ai_draw_prob?: number | null
  ai_away_prob?: number | null
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

function TeamCrest({
  url,
  name,
  align,
}: {
  url?: string | null
  name: string
  align: 'left' | 'right'
}) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={cn(
          'h-6 w-6 rounded-full bg-[var(--card-bg)] object-contain ring-1 ring-[var(--border-color)]',
          align === 'right' ? 'order-2 ml-2' : 'mr-2'
        )}
        loading="lazy"
      />
    )
  }
  const initial = name.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?'
  return (
    <span
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold',
        'bg-[var(--surface-highlight)] text-[var(--text-secondary)] ring-1 ring-[var(--border-color)]',
        align === 'right' ? 'order-2 ml-2' : 'mr-2'
      )}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}

function StatusBlock({ match }: { match: MatchRowMatch }) {
  const status = match.status?.toString().toLowerCase()
  if (status === 'live') {
    const homeScore = match.home_score ?? 0
    const awayScore = match.away_score ?? 0
    return (
      <div className="flex w-20 flex-col items-center">
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{homeScore}</span>
          <span className="text-xs text-[var(--text-tertiary)]">–</span>
          <span className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{awayScore}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-red-400">
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
      <div className="flex w-20 flex-col items-center">
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-[var(--text-secondary)]">{homeScore}</span>
          <span className="text-xs text-[var(--text-tertiary)]">–</span>
          <span className="text-lg font-bold tabular-nums text-[var(--text-secondary)]">{awayScore}</span>
        </div>
        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">FT</span>
      </div>
    )
  }
  return (
    <div className="flex w-20 flex-col items-center">
      <span className="text-sm font-semibold tabular-nums text-[var(--accent-primary)]">
        {formatKickoff(match.time)}
      </span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        Kick-off
      </span>
    </div>
  )
}

function AILeanBar({ home, draw, away }: { home: number; draw: number; away: number }) {
  const total = Math.max(1e-6, home + draw + away)
  const homePct = (home / total) * 100
  const drawPct = (draw / total) * 100
  const awayPct = (away / total) * 100
  return (
    <div
      className="mt-1.5 flex h-1 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]/30"
      title={`AI lean: home ${formatPct(home)} · draw ${formatPct(draw)} · away ${formatPct(away)}`}
    >
      <span
        className="block h-full bg-[var(--accent-primary)] transition-[width]"
        style={{ width: `${homePct}%` }}
      />
      <span
        className="block h-full bg-[var(--accent-warn)] transition-[width]"
        style={{ width: `${drawPct}%` }}
      />
      <span
        className="block h-full bg-[var(--accent-loss)] transition-[width]"
        style={{ width: `${awayPct}%` }}
      />
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

  const body = (
    <div className="flex w-full items-center gap-2">
      {/* Favourite toggle */}
      {showFavoriteToggle && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggleFavorite?.(match)
          }}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
            'text-[var(--text-tertiary)] hover:text-[var(--accent-warn)]',
            isFavorite && 'text-[var(--accent-warn)]'
          )}
          aria-label={isFavorite ? 'Unfollow match' : 'Follow match'}
        >
          <Star className="h-3.5 w-3.5" fill={isFavorite ? 'currentColor' : 'none'} strokeWidth={2} />
        </button>
      )}

      <div className="flex min-w-0 flex-1 items-center">
        {/* Home team — right-aligned text, crest on right */}
        <div className="flex min-w-0 flex-1 items-center justify-end overflow-hidden text-right">
          <span
            className={cn(
              'truncate text-sm font-medium',
              match.status === 'finished' || match.status === 'completed'
                ? 'text-[var(--text-secondary)]'
                : 'text-[var(--text-primary)]'
            )}
          >
            {match.home_team}
          </span>
          <TeamCrest url={match.home_crest_url} name={match.home_team} align="right" />
        </div>

        <StatusBlock match={match} />

        {/* Away team — left-aligned text, crest on left */}
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          <TeamCrest url={match.away_crest_url} name={match.away_team} align="left" />
          <span
            className={cn(
              'truncate text-sm font-medium',
              match.status === 'finished' || match.status === 'completed'
                ? 'text-[var(--text-secondary)]'
                : 'text-[var(--text-primary)]'
            )}
          >
            {match.away_team}
          </span>
        </div>
      </div>
    </div>
  )

  const inner = (
    <div className="w-full">
      {body}
      {hasAILean && (
        <AILeanBar
          home={match.ai_home_prob as number}
          draw={match.ai_draw_prob as number}
          away={match.ai_away_prob as number}
        />
      )}
      {match.venue && (
        <p className="mt-1 truncate text-center text-[10px] text-[var(--text-tertiary)]">{match.venue}</p>
      )}
    </div>
  )

  const className = cn(
    'group relative block w-full rounded-md px-3 py-2.5 transition-colors',
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

/**
 * Animated container that staggers rows on mount.
 * Use it when rendering a freshly-loaded list of matches.
 */
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

/**
 * Convenience pill shown above a match list — FotMob shows these as the date-strip selector.
 */
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
    live: 'border-red-500/40 bg-red-500/10 text-red-400',
    upcoming: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400',
    finished: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
    neutral: 'border-[var(--border-color)] text-[var(--text-secondary)]',
  }
  return (
    <Badge variant="outline" className={cn('font-semibold uppercase tracking-wide', toneStyles[tone])}>
      {label}
      {typeof count === 'number' && <span className="ml-1 text-[10px] opacity-80">({count})</span>}
    </Badge>
  )
}
