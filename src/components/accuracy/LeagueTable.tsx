'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowDownAZ, ArrowUp, ArrowUpDown, ChevronDown, Minus, TrendingUp } from 'lucide-react'

import { LeagueBadge } from '@/components/match/LeagueBadge'
import { SectionHeader } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { getLeagueAccent } from '@/lib/leagueAccents'
import type { LeagueAccuracySummary } from '@/lib/types/accuracy'
import { cn } from '@/lib/utils'

/**
 * League accuracy table — built on the tracker's real per-league rollup
 * (settled counts, hit rate, Brier score), not a client-side re-aggregation
 * of a 30-item feed. Dense FotMob table grammar: 13px, tabular-nums,
 * right-aligned numerics, hairline rows, zebra-free.
 *
 * Leagues with fewer than MIN_SAMPLE settled picks collapse into a
 * "low sample" group so noisy 2-match rates never lead the table.
 */

/** Settled picks needed before a league's hit rate is worth ranking. */
const MIN_SAMPLE = 5

type SortKey = 'accuracy' | 'settled' | 'name'

interface LeagueTableProps {
  /** Per-league rollup rows, already filtered to the active universe. */
  rows: LeagueAccuracySummary[]
  /** Universe-wide hit rate 0..1 — the Δ column baseline. */
  overallAccuracy: number
  className?: string
}

function sortRows(rows: LeagueAccuracySummary[], sort: SortKey): LeagueAccuracySummary[] {
  const copy = [...rows]
  if (sort === 'accuracy') copy.sort((a, b) => b.accuracy - a.accuracy || b.total - a.total)
  else if (sort === 'settled') copy.sort((a, b) => b.total - a.total || b.accuracy - a.accuracy)
  else copy.sort((a, b) => displayName(a.league).localeCompare(displayName(b.league)))
  return copy
}

function displayName(league: string): string {
  const accent = getLeagueAccent(league)
  return accent.competitionId === 'unknown' ? league : accent.displayName
}

export function LeagueTable({ rows, overallAccuracy, className }: LeagueTableProps) {
  const [sort, setSort] = useState<SortKey>('accuracy')
  const [showLowSample, setShowLowSample] = useState(false)

  const { ranked, lowSample } = useMemo(() => {
    const settled = rows.filter((r) => r.total >= MIN_SAMPLE)
    const low = rows.filter((r) => r.total > 0 && r.total < MIN_SAMPLE)
    return { ranked: sortRows(settled, sort), lowSample: sortRows(low, sort) }
  }, [rows, sort])

  if (ranked.length === 0 && lowSample.length === 0) return null

  const totalSettled = rows.reduce((s, r) => s + r.total, 0)

  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      <div className="border-b border-[var(--border-color)] px-4 py-3 md:px-5">
        <SectionHeader
          className="flex-col items-start gap-2 sm:flex-row sm:items-end"
          kicker="League audit"
          title="Hit rate by league"
          description={`${totalSettled.toLocaleString()} settled picks across ${rows.length} league${rows.length === 1 ? '' : 's'}.`}
          action={
            <div
              role="tablist"
              aria-label="Sort league table"
              className="inline-flex items-center gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]/70 p-0.5"
            >
              {(
                [
                  { value: 'accuracy' as const, label: 'Hit rate', icon: TrendingUp },
                  { value: 'settled' as const, label: 'Settled', icon: ArrowUpDown },
                  { value: 'name' as const, label: 'A–Z', icon: ArrowDownAZ },
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
                    <Icon className="h-3 w-3" aria-hidden="true" />
                    {option.label}
                  </button>
                )
              })}
            </div>
          }
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[540px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border-color)]/60 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              <th scope="col" className="px-4 py-2 text-left font-semibold md:px-5">
                League
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Settled
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Hit rate
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Brier
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold md:px-5">
                Δ overall
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => (
              <LeagueRow key={row.league} row={row} overall={overallAccuracy} />
            ))}
            {showLowSample &&
              lowSample.map((row) => (
                <LeagueRow key={row.league} row={row} overall={overallAccuracy} muted />
              ))}
          </tbody>
        </table>
      </div>

      {lowSample.length > 0 && (
        <button
          type="button"
          onClick={() => setShowLowSample((v) => !v)}
          aria-expanded={showLowSample}
          className="flex min-h-[44px] w-full items-center justify-center gap-1 border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] font-semibold text-[var(--text-tertiary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', showLowSample && 'rotate-180')}
            aria-hidden="true"
          />
          {showLowSample
            ? 'Hide low-sample leagues'
            : `Low sample — ${lowSample.length} league${lowSample.length === 1 ? '' : 's'} under ${MIN_SAMPLE} settled picks`}
        </button>
      )}
    </Card>
  )
}

function LeagueRow({
  row,
  overall,
  muted = false,
}: {
  row: LeagueAccuracySummary
  overall: number
  muted?: boolean
}) {
  const pct = Math.round(row.accuracy * 100)
  const deltaPts = (row.accuracy - overall) * 100
  const isAbove = deltaPts > 2
  const isBelow = deltaPts < -2
  const DeltaIcon = isAbove ? ArrowUp : isBelow ? ArrowDown : Minus
  const deltaClass = isAbove
    ? 'text-[var(--accent-primary)]'
    : isBelow
      ? 'text-[var(--accent-loss)]'
      : 'text-[var(--text-tertiary)]'

  return (
    <tr
      className={cn(
        'border-b border-[var(--border-color)]/40 last:border-b-0 transition-colors hover:bg-[var(--card-hover)]',
        muted && 'opacity-60'
      )}
    >
      <td className="px-4 py-2.5 md:px-5">
        <span className="flex min-w-0 items-center gap-2">
          <LeagueBadge league={row.league} size="sm" className="shrink-0" />
          <span className="truncate font-medium text-[var(--text-primary)]">
            {displayName(row.league)}
          </span>
        </span>
      </td>
      <td className="px-2 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
        {row.total.toLocaleString()}
      </td>
      <td className="px-2 py-2.5">
        <span className="flex items-center justify-end gap-2">
          <span
            aria-hidden="true"
            className="hidden h-1 w-16 overflow-hidden rounded-full bg-[var(--border-color)]/50 sm:block"
          >
            <span
              className="block h-full rounded-full bg-[var(--accent-primary)]/70"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </span>
          <span className="w-9 text-right font-semibold tabular-nums text-[var(--text-primary)]">
            {pct}%
          </span>
        </span>
      </td>
      <td className="px-2 py-2.5 text-right tabular-nums text-[var(--text-tertiary)]">
        {row.brier_score.toFixed(3)}
      </td>
      <td className="px-4 py-2.5 md:px-5">
        <span className={cn('flex items-center justify-end gap-0.5 tabular-nums', deltaClass)}>
          <DeltaIcon className="h-3 w-3" aria-hidden="true" />
          <span className="text-[12px] font-semibold">
            {deltaPts > 0 ? '+' : ''}
            {deltaPts.toFixed(1)}
          </span>
        </span>
      </td>
    </tr>
  )
}
