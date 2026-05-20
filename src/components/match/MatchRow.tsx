'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Star } from 'lucide-react'

import { ConfidenceIndicator } from '@/components/match/ConfidenceIndicator'
import { TeamFormPill, type FormEntry } from '@/components/match/TeamFormPill'
import { Badge } from '@/components/ui/badge'
import { cn, clamp, formatPct } from '@/lib/utils'

/**
 * Canonical FotMob-style match row, redesigned for visual density and
 * AI legibility:
 *
 *   ┌────┬──────────────────────┬───────────┬──────────────────────┬────┐
 *   │ ★  │ home form · TEAM 🛡  │ FT 2 - 1  │ 🛡 TEAM · away form  │    │
 *   │    │ AI lean bar (10px) ───────────────────────────────────────── │
 *   └────┴────────────────────────────────────────────────────────────────┘
 *
 * - 52px tap target on mobile (FotMob is 56px; we trim slightly so
 *   dense lists don't dominate the viewport).
 * - The AI lean bar is 10px tall — the previous 1px bar was effectively
 *   invisible and the user's #1 "looks beginner" complaint.
 * - When confidence is supplied, a chip is rendered next to the
 *   score so the model's certainty is visible without clicking through.
 * - Crest fallback is a 28×28 letterform on the league accent colour
 *   instead of the previous raw character.
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
  /** Optional probability lean from the unified model. 0..1 each. */
  ai_home_prob?: number | null
  ai_draw_prob?: number | null
  ai_away_prob?: number | null
  /** Optional 0..1 model confidence; if absent, derived from max probability. */
  ai_confidence?: number | null
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

function TeamCrest({
  url,
  name,
  align,
  leagueAccent,
}: {
  url?: string | null
  name: string
  align: 'left' | 'right'
  leagueAccent?: string | null
}) {
  const margin = align === 'right' ? 'order-2 ml-2' : 'mr-2'
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={cn(
          'h-7 w-7 rounded-full bg-[var(--card-bg)] object-contain ring-1 ring-[var(--border-color)] shrink-0',
          margin
        )}
        loading="lazy"
      />
    )
  }
  const initial = name.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?'
  return (
    <span
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold tracking-tight shrink-0',
        'ring-1 ring-[var(--border-color)]',
        margin
      )}
      style={{
        background: leagueAccent ? `${leagueAccent}1f` : 'var(--surface-highlight)',
        color: leagueAccent || 'var(--text-secondary)',
      }}
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
      <div className="flex w-24 flex-col items-center">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{homeScore}</span>
          <span className="text-xs text-[var(--text-tertiary)]">–</span>
          <span className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{awayScore}</span>
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

/**
 * Visible AI lean bar — 10px tall with embedded percentage labels at the
 * three ends. The old 1px version was invisible on mobile.
 */
function AILeanBar({
  home,
  draw,
  away,
  homeTeam,
  awayTeam,
}: {
  home: number
  draw: number
  away: number
  homeTeam: string
  awayTeam: string
}) {
  const total = Math.max(1e-6, home + draw + away)
  const homePct = (home / total) * 100
  const drawPct = (draw / total) * 100
  const awayPct = (away / total) * 100
  return (
    <div className="mt-1.5 w-full">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full ring-1 ring-[var(--border-color)]"
        title={`AI lean: ${homeTeam} ${formatPct(home)} · draw ${formatPct(draw)} · ${awayTeam} ${formatPct(away)}`}
        aria-label="AI prediction lean"
      >
        <span className="block h-full bg-[var(--accent-primary)]" style={{ width: `${homePct}%` }} />
        <span className="block h-full bg-[var(--accent-warn)]" style={{ width: `${drawPct}%` }} />
        <span className="block h-full bg-[var(--accent-loss)]" style={{ width: `${awayPct}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums">
        <span className="font-semibold text-[var(--accent-primary)]">{formatPct(home)}</span>
        <span className="font-semibold text-[var(--accent-warn)]">{formatPct(draw)}</span>
        <span className="font-semibold text-[var(--accent-loss)]">{formatPct(away)}</span>
      </div>
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
  const aiPick = hasAILean
    ? aiHome > aiAway && aiHome > aiDraw
      ? match.home_team
      : aiAway > aiDraw
      ? match.away_team
      : 'Draw'
    : null
  const confidence = match.ai_confidence ?? (hasAILean ? Math.max(aiHome, aiDraw, aiAway) : null)

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
            'text-[var(--text-tertiary)] hover:text-amber-400',
            isFavorite && 'text-amber-400'
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
          <TeamCrest
            url={match.home_crest_url}
            name={match.home_team}
            align="right"
            leagueAccent={match.league_accent}
          />
        </div>

        <StatusBlock match={match} />

        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          <TeamCrest
            url={match.away_crest_url}
            name={match.away_team}
            align="left"
            leagueAccent={match.league_accent}
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
        <AILeanBar
          home={aiHome}
          draw={aiDraw}
          away={aiAway}
          homeTeam={match.home_team}
          awayTeam={match.away_team}
        />
      )}
      {(match.venue || (confidence !== null && hasAILean)) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-tertiary)]">{match.venue}</div>
          {confidence !== null && hasAILean && aiPick && (
            <ConfidenceIndicator value={confidence} pick={aiPick} />
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
