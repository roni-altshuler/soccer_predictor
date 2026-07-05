'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowDownAZ, ArrowUpDown, Filter, TrendingDown, TrendingUp } from 'lucide-react'

import { LeagueBadge } from '@/components/match/LeagueBadge'
import { SectionHeader } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { RecentPick } from '@/components/accuracy/RecentPicksFeed'

/**
 * League-performance breakdown — answers "where is the model strong vs weak?"
 * by aggregating settled picks per league and surfacing each league's hit
 * rate alongside a horizontal sparkbar. Sister widget to CalibrationPlot
 * (which answers "is the model well-calibrated?") and ConfusionHeatmap
 * (which answers "what kinds of outcomes does the model confuse?").
 */

interface LeaguePerformanceBreakdownProps {
  picks: RecentPick[]
  className?: string
  /** Minimum settled-pick count required for a league to appear. */
  minSamples?: number
}

type SortKey = 'hitRate' | 'samples' | 'alpha'

interface LeagueRow {
  league: string
  hits: number
  misses: number
  pending: number
  total: number
  settled: number
  hitRate: number
  avgConfidence: number
}

function aggregate(picks: RecentPick[]): LeagueRow[] {
  const buckets = new Map<string, { hits: number; misses: number; pending: number; confidenceSum: number }>()
  for (const p of picks) {
    const key = p.league || 'Other'
    if (!buckets.has(key)) {
      buckets.set(key, { hits: 0, misses: 0, pending: 0, confidenceSum: 0 })
    }
    const slot = buckets.get(key)!
    if (p.winner_correct === true) slot.hits++
    else if (p.winner_correct === false) slot.misses++
    else slot.pending++
    slot.confidenceSum += p.confidence ?? 0
  }
  const rows: LeagueRow[] = []
  for (const [league, v] of buckets) {
    const total = v.hits + v.misses + v.pending
    const settled = v.hits + v.misses
    rows.push({
      league,
      hits: v.hits,
      misses: v.misses,
      pending: v.pending,
      total,
      settled,
      hitRate: settled === 0 ? 0 : v.hits / settled,
      avgConfidence: total === 0 ? 0 : v.confidenceSum / total,
    })
  }
  return rows
}

export function LeaguePerformanceBreakdown({
  picks,
  className,
  minSamples = 2,
}: LeaguePerformanceBreakdownProps) {
  const [sort, setSort] = useState<SortKey>('hitRate')
  const [showAll, setShowAll] = useState(false)

  const rows = useMemo(() => aggregate(picks), [picks])

  const filtered = useMemo(
    () => rows.filter((r) => r.settled >= minSamples),
    [rows, minSamples]
  )

  const ordered = useMemo(() => {
    const copy = [...filtered]
    if (sort === 'hitRate') copy.sort((a, b) => b.hitRate - a.hitRate || b.settled - a.settled)
    else if (sort === 'samples') copy.sort((a, b) => b.settled - a.settled)
    else copy.sort((a, b) => a.league.localeCompare(b.league))
    return copy
  }, [filtered, sort])

  const visible = showAll ? ordered : ordered.slice(0, 8)

  // Headline summary across all leagues that pass minSamples.
  const totals = useMemo(() => {
    let hits = 0
    let settled = 0
    for (const r of filtered) {
      hits += r.hits
      settled += r.settled
    }
    return {
      hits,
      settled,
      overallRate: settled === 0 ? 0 : hits / settled,
      leagueCount: filtered.length,
    }
  }, [filtered])

  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      {/* Header */}
      <div className="border-b border-[var(--border-color)] px-4 py-3 md:px-5">
        <SectionHeader
          className="flex-col items-start gap-2 sm:flex-row sm:items-end"
          kicker="League audit"
          title="Where the model wins"
          description={
            totals.leagueCount > 0
              ? `Hit rate by league · ${Math.round(totals.overallRate * 100)}% across ${totals.settled} settled picks in ${totals.leagueCount} league${totals.leagueCount === 1 ? '' : 's'}`
              : `League-by-league hit rates appear here once at least ${minSamples} matches per league have settled`
          }
          action={
            <div
              role="tablist"
              aria-label="Sort league breakdown"
              className="inline-flex items-center gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]/70 p-0.5"
            >
              {(
                [
                  { value: 'hitRate' as const, label: 'Hit rate', icon: TrendingUp },
                  { value: 'samples' as const, label: 'Sample size', icon: ArrowUpDown },
                  { value: 'alpha' as const, label: 'A→Z', icon: ArrowDownAZ },
                ]
              ).map((option) => {
                const Icon = option.icon
                const active = sort === option.value
                return (
                  <button
                    key={option.value}
                    role="tab"
                    type="button"
                    aria-selected={active}
                    onClick={() => setSort(option.value)}
                    className={cn(
                      'flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
                      active
                        ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                        : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {active && <Filter className="h-2.5 w-2.5" aria-hidden="true" />}
                    <Icon className="h-3 w-3" aria-hidden="true" />
                    {option.label}
                  </button>
                )
              })}
            </div>
          }
        />
      </div>

      {/* Body */}
      {filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center px-4 text-sm text-[var(--text-tertiary)]">
          Not enough settled predictions per league yet.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-color)]/60">
          {visible.map((row, idx) => (
            <LeagueRowItem key={row.league} row={row} idx={idx} overall={totals.overallRate} />
          ))}
        </ul>
      )}

      {/* Show more */}
      {ordered.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] font-semibold text-[var(--text-tertiary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
        >
          {showAll ? 'Show fewer' : `Show ${ordered.length - 8} more leagues`}
        </button>
      )}
    </Card>
  )
}

function LeagueRowItem({
  row,
  idx,
  overall,
}: {
  row: LeagueRow
  idx: number
  overall: number
}) {
  const rate = row.hitRate
  const pct = Math.round(rate * 100)
  const delta = rate - overall
  const isAbove = delta > 0.02
  const isBelow = delta < -0.02
  const TrendIcon = isAbove ? TrendingUp : isBelow ? TrendingDown : null
  const trendClass = isAbove
    ? 'text-[var(--accent-primary)]'
    : isBelow
      ? 'text-[var(--accent-loss)]'
      : 'text-[var(--text-tertiary)]'

  // Bar colour reflects performance relative to the overall hit rate.
  const barClass = isAbove
    ? 'bg-[var(--accent-primary)]/70'
    : isBelow
      ? 'bg-[var(--accent-loss)]/60'
      : 'bg-[var(--accent-ai)]/60'

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: idx * 0.03, ease: [0.22, 1, 0.36, 1] }}
      className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 px-4 py-3 md:px-5"
    >
      <LeagueBadge league={row.league} size="sm" />

      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {row.league}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--text-tertiary)] tabular-nums">
            {row.hits}/{row.settled}
            {row.pending > 0 && <span className="ml-1 opacity-60">· {row.pending} pending</span>}
          </span>
        </div>
        {/* Hit-rate bar */}
        <span
          className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-color)]/50"
          aria-hidden="true"
        >
          <span
            className={cn('block h-full rounded-full', barClass)}
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-h4 font-bold tabular-nums text-[var(--text-primary)]">{pct}%</span>
        {TrendIcon && <TrendIcon className={cn('h-3.5 w-3.5', trendClass)} aria-hidden="true" />}
      </div>
    </motion.li>
  )
}
