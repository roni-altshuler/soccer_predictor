'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Minus } from 'lucide-react'

import { LeagueBadge } from '@/components/match/LeagueBadge'
import { getLeagueAccent } from '@/lib/leagueAccents'
import type { LeagueAccuracySummary } from '@/lib/types/accuracy'
import { cn } from '@/lib/utils'

import { MIN_LEAGUE_SAMPLE, count, pct0, samplePhrase, score3, signedPts } from './accuracyMetrics'

/**
 * Per-league record. Dense table grammar: 13px, tabular-nums, right-aligned
 * numerics, hairline rows, zebra-free.
 *
 * Ranking honesty — leagues under MIN_LEAGUE_SAMPLE settled picks are held
 * out of the ranking behind a disclosure rather than mixed in, because a
 * 62% rate off 21 picks otherwise tops the table and reads as the model's
 * best competition. The Δ column is suppressed when there is only one
 * league in the universe, where it is tautologically zero.
 */

type SortKey = 'accuracy' | 'settled' | 'name'

interface LeagueTableProps {
  /** Per-league rollup rows, already filtered to the active universe. */
  rows: LeagueAccuracySummary[]
  /** Universe-wide hit rate 0..1 — the Δ column baseline. */
  overallAccuracy: number
  /** Render bare, without the card chrome (used inside the deep-cuts tabs). */
  embedded?: boolean
  className?: string
}

function displayName(league: string): string {
  const accent = getLeagueAccent(league)
  return accent.competitionId === 'unknown' ? league : accent.displayName
}

function sortRows(rows: LeagueAccuracySummary[], sort: SortKey): LeagueAccuracySummary[] {
  const copy = [...rows]
  if (sort === 'accuracy') copy.sort((a, b) => b.accuracy - a.accuracy || b.total - a.total)
  else if (sort === 'settled') copy.sort((a, b) => b.total - a.total || b.accuracy - a.accuracy)
  else copy.sort((a, b) => displayName(a.league).localeCompare(displayName(b.league)))
  return copy
}

export function LeagueTable({
  rows,
  overallAccuracy,
  embedded = false,
  className,
}: LeagueTableProps) {
  const [sort, setSort] = useState<SortKey>('accuracy')
  const [showThin, setShowThin] = useState(false)

  const { ranked, thin } = useMemo(() => {
    const big = rows.filter((r) => r.total >= MIN_LEAGUE_SAMPLE)
    const small = rows.filter((r) => r.total > 0 && r.total < MIN_LEAGUE_SAMPLE)
    return { ranked: sortRows(big, sort), thin: sortRows(small, sort) }
  }, [rows, sort])

  if (ranked.length === 0 && thin.length === 0) return null

  const totalSettled = rows.reduce((s, r) => s + r.total, 0)
  // With a single league the Δ column just restates the overall rate.
  const showDelta = rows.length > 1

  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-5">
        <p className="text-[12px] text-[var(--text-tertiary)]">
          {samplePhrase(totalSettled)} across {count(rows.length)} competition
          {rows.length === 1 ? '' : 's'}
        </p>
        <div
          role="tablist"
          aria-label="Sort competitions"
          className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border-color)] p-0.5"
        >
          {(
            [
              { value: 'accuracy' as const, label: 'Hit rate' },
              { value: 'settled' as const, label: 'Sample' },
              { value: 'name' as const, label: 'A–Z' },
            ]
          ).map((option) => {
            const active = sort === option.value
            return (
              <button
                key={option.value}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setSort(option.value)}
                className={cn(
                  'flex min-h-[44px] items-center rounded-md px-2.5 text-[11px] font-semibold transition-colors sm:min-h-[36px]',
                  active
                    ? 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] border-collapse text-[13px]">
          <thead>
            <tr className="border-y border-[var(--border-color)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              <th scope="col" className="px-4 py-2 text-left font-semibold md:px-5">
                Competition
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Sample
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Hit rate
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Prob. score
              </th>
              {showDelta && (
                <th scope="col" className="px-4 py-2 text-right font-semibold md:px-5">
                  vs overall
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => (
              <LeagueRow
                key={row.league}
                row={row}
                overall={overallAccuracy}
                showDelta={showDelta}
              />
            ))}
            {showThin &&
              thin.map((row) => (
                <LeagueRow
                  key={row.league}
                  row={row}
                  overall={overallAccuracy}
                  showDelta={showDelta}
                  muted
                />
              ))}
          </tbody>
        </table>
      </div>

      {thin.length > 0 && (
        <button
          type="button"
          onClick={() => setShowThin((v) => !v)}
          aria-expanded={showThin}
          className="flex min-h-[44px] w-full items-center justify-center gap-1 border-t border-[var(--border-color)] px-4 text-[11px] font-semibold text-[var(--text-tertiary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', showThin && 'rotate-180')}
            aria-hidden="true"
          />
          {showThin
            ? 'Hide thin samples'
            : `${thin.length} competition${thin.length === 1 ? '' : 's'} under ${MIN_LEAGUE_SAMPLE} picks`}
        </button>
      )}
    </>
  )

  if (embedded) return <div className={className}>{body}</div>

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className
      )}
    >
      {body}
    </div>
  )
}

function LeagueRow({
  row,
  overall,
  showDelta,
  muted = false,
}: {
  row: LeagueAccuracySummary
  overall: number
  showDelta: boolean
  muted?: boolean
}) {
  const deltaPts = (row.accuracy - overall) * 100
  const isAbove = deltaPts > 2
  const isBelow = deltaPts < -2
  const DeltaIcon = isAbove ? ArrowUp : isBelow ? ArrowDown : Minus

  return (
    <tr
      className={cn(
        'border-b border-[var(--border-color)]/40 last:border-b-0 transition-colors hover:bg-[var(--card-hover)]',
        muted && 'opacity-55'
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
        {count(row.total)}
      </td>
      <td className="px-2 py-2.5">
        <span className="flex items-center justify-end gap-2">
          <span
            aria-hidden="true"
            className="hidden h-1 w-14 overflow-hidden rounded-full bg-[var(--border-color)] sm:block"
          >
            <span
              className="block h-full rounded-full bg-[var(--accent-primary)]/70"
              style={{ width: `${Math.min(100, row.accuracy * 100)}%` }}
            />
          </span>
          <span className="w-10 text-right font-semibold tabular-nums text-[var(--text-primary)]">
            {pct0(row.accuracy)}
          </span>
        </span>
      </td>
      <td className="px-2 py-2.5 text-right tabular-nums text-[var(--text-tertiary)]">
        {score3(row.brier_score)}
      </td>
      {showDelta && (
        <td className="px-4 py-2.5 md:px-5">
          <span
            className={cn(
              'flex items-center justify-end gap-0.5 tabular-nums',
              isAbove
                ? 'text-[var(--accent-primary)]'
                : isBelow
                  ? 'text-[var(--accent-loss)]'
                  : 'text-[var(--text-tertiary)]'
            )}
          >
            <DeltaIcon className="h-3 w-3" aria-hidden="true" />
            <span className="text-[12px] font-semibold">{signedPts(deltaPts)}</span>
          </span>
        </td>
      )}
    </tr>
  )
}
