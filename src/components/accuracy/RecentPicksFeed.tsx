'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, ChevronDown, Filter, Minus, X } from 'lucide-react'

import { LeagueBadge } from '@/components/match/LeagueBadge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Recent-picks feed — last 20 settled predictions rendered as a scannable
 * row list. Each row uses a strict 3-band layout (status / matchup / verdict)
 * so the user can audit the model without parsing parenthetical asides.
 *
 *   ✓  Sporting KC  2-2 → 1-3  San Jose Earthquakes        MLS · May 22
 *      AI picked San Jose Earthquakes · 46% confidence  [████···]
 *
 * Filter chips (All / Hits / Misses) sit above the list so users can drill
 * straight into the wrong picks — the most useful audit.
 */

export interface RecentPick {
  match_id: string
  home_team: string
  away_team: string
  league: string
  match_date: string
  predicted_winner: 'home' | 'draw' | 'away'
  actual_winner?: 'home' | 'draw' | 'away' | null
  winner_correct?: boolean | null
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  predicted_scoreline?: string
  actual_home_goals?: number | null
  actual_away_goals?: number | null
  confidence: number
  gender: 'M' | 'F'
}

interface RecentPicksFeedProps {
  picks: RecentPick[]
  className?: string
}

type StatusFilter = 'all' | 'hits' | 'misses'

function pickedTeamName(p: RecentPick): string {
  if (p.predicted_winner === 'home') return p.home_team
  if (p.predicted_winner === 'away') return p.away_team
  return 'Draw'
}

function shortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function RecentPicksFeed({ picks, className }: RecentPicksFeedProps) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [showAll, setShowAll] = useState(false)

  const counts = useMemo(() => {
    let hits = 0
    let misses = 0
    let pending = 0
    for (const p of picks) {
      if (p.winner_correct === true) hits++
      else if (p.winner_correct === false) misses++
      else pending++
    }
    return { hits, misses, pending, total: picks.length }
  }, [picks])

  const filtered = useMemo(() => {
    if (filter === 'hits') return picks.filter((p) => p.winner_correct === true)
    if (filter === 'misses') return picks.filter((p) => p.winner_correct === false)
    return picks
  }, [picks, filter])

  const visible = showAll ? filtered : filtered.slice(0, 10)

  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3 md:px-5">
        <div>
          <h3 className="text-h4 font-bold text-[var(--text-primary)]">Recent picks</h3>
          <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
            {counts.total > 0 ? (
              <>
                <span className="text-[var(--accent-primary)]">{counts.hits} hits</span> ·{' '}
                <span className="text-[var(--accent-loss)]">{counts.misses} misses</span>
                {counts.pending > 0 && (
                  <>
                    {' '}·{' '}
                    <span className="text-[var(--text-tertiary)]">{counts.pending} pending</span>
                  </>
                )}
              </>
            ) : (
              <>Last settled predictions appear here as matches finish</>
            )}
          </p>
        </div>

        {/* Filter chips */}
        <div
          role="tablist"
          aria-label="Filter recent picks"
          className="inline-flex items-center gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]/70 p-0.5"
        >
          {(
            [
              { value: 'all' as const, label: 'All', count: counts.total },
              { value: 'hits' as const, label: 'Hits', count: counts.hits, tone: 'primary' as const },
              { value: 'misses' as const, label: 'Misses', count: counts.misses, tone: 'loss' as const },
            ]
          ).map((f) => (
            <button
              key={f.value}
              role="tab"
              type="button"
              aria-selected={filter === f.value}
              onClick={() => {
                setFilter(f.value)
                setShowAll(false)
              }}
              className={cn(
                'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
                filter === f.value
                  ? f.tone === 'primary'
                    ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                    : f.tone === 'loss'
                      ? 'bg-[var(--accent-loss)]/15 text-[var(--accent-loss)]'
                      : 'bg-[var(--accent-ai)]/15 text-[var(--accent-ai)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              )}
            >
              {filter === f.value && <Filter className="h-2.5 w-2.5" aria-hidden="true" />}
              {f.label}
              <span className="tabular-nums opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Rows */}
      {picks.length === 0 ? (
        <div className="flex h-32 items-center justify-center px-4 text-sm text-[var(--text-tertiary)]">
          No settled predictions to show yet.
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-24 items-center justify-center px-4 text-sm text-[var(--text-tertiary)]">
          No picks match this filter.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-color)]/60">
          {visible.map((pick, idx) => (
            <li key={pick.match_id ?? idx}>
              <PickRow pick={pick} idx={idx} />
            </li>
          ))}
        </ul>
      )}

      {/* Show more / less */}
      {filtered.length > 10 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] font-semibold text-[var(--text-tertiary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', showAll && 'rotate-180')}
            aria-hidden="true"
          />
          {showAll ? 'Show fewer' : `Show ${filtered.length - 10} more`}
        </button>
      )}
    </Card>
  )
}

function PickRow({ pick, idx }: { pick: RecentPick; idx: number }) {
  const isHit = pick.winner_correct === true
  const isMiss = pick.winner_correct === false
  const isPending = !isHit && !isMiss

  const picked = pickedTeamName(pick)
  const confidencePct = Math.round((pick.confidence ?? 0) * 100)
  const haveScore =
    typeof pick.actual_home_goals === 'number' &&
    typeof pick.actual_away_goals === 'number'

  // Score line: "(2 — 3)" coloured by hit/miss
  const scoreClass = isHit
    ? 'text-[var(--accent-primary)]'
    : isMiss
      ? 'text-[var(--accent-loss)]'
      : 'text-[var(--text-secondary)]'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: idx * 0.02, ease: [0.22, 1, 0.36, 1] }}
      className="grid grid-cols-[28px_1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 md:px-5"
    >
      {/* Status — column 1 (spans both rows) */}
      <div
        className={cn(
          'row-span-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isHit && 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/30',
          isMiss && 'bg-[var(--accent-loss)]/12 text-[var(--accent-loss)] ring-1 ring-[var(--accent-loss)]/30',
          isPending && 'bg-[var(--muted-bg)] text-[var(--text-tertiary)] ring-1 ring-[var(--border-color)]'
        )}
        aria-label={isHit ? 'Hit' : isMiss ? 'Miss' : 'Pending'}
      >
        {isHit && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        {isMiss && <X className="h-3.5 w-3.5" strokeWidth={3} />}
        {isPending && <Minus className="h-3.5 w-3.5" strokeWidth={3} />}
      </div>

      {/* Matchup — column 2 row 1 */}
      <div className="min-w-0 flex items-center gap-2 text-sm">
        <span className="truncate font-semibold text-[var(--text-primary)]">
          {pick.home_team}
        </span>
        <span className={cn('shrink-0 font-bold tabular-nums', scoreClass)}>
          {haveScore ? `${pick.actual_home_goals}–${pick.actual_away_goals}` : 'vs'}
        </span>
        <span className="truncate font-semibold text-[var(--text-primary)]">
          {pick.away_team}
        </span>
      </div>

      {/* League + date — column 3 row 1 */}
      <div className="row-span-2 flex shrink-0 flex-col items-end gap-1">
        <LeagueBadge league={pick.league} size="sm" />
        <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">
          {shortDate(pick.match_date)}
        </span>
      </div>

      {/* Pick + confidence bar — column 2 row 2 */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[11px] text-[var(--text-tertiary)]">
          Picked{' '}
          <span className={cn('font-semibold', isHit ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]')}>
            {picked}
          </span>
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)]">·</span>
        <span className="text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">
          {confidencePct}%
        </span>
        <span
          className="ml-1 hidden h-1 w-20 overflow-hidden rounded-full bg-[var(--border-color)]/60 sm:inline-block"
          aria-hidden="true"
        >
          <span
            className={cn(
              'block h-full rounded-full',
              isHit
                ? 'bg-[var(--accent-primary)]/70'
                : isMiss
                  ? 'bg-[var(--accent-loss)]/60'
                  : 'bg-[var(--accent-ai)]/60'
            )}
            style={{ width: `${confidencePct}%` }}
          />
        </span>
      </div>
    </motion.div>
  )
}
