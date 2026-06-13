'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CheckCircle2, Clock, Download, History as HistoryIcon, XCircle } from 'lucide-react'

import { BorderBeam } from '@/components/magicui/border-beam'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { Spotlight } from '@/components/magicui/spotlight'
import { FormSparkline } from '@/components/charts/FormSparkline'
import { StatCard } from '@/components/cards/StatCard'
import { TableSkeleton } from '@/components/skeletons/TableSkeleton'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { usePredictionHistory, type PredictionHistoryRow } from '@/hooks/usePredictionHistory'

type Filter = 'all' | 'correct' | 'incorrect' | 'pending'

const OUTCOME_LABELS: Record<string, string> = { H: 'Home', D: 'Draw', A: 'Away' }

function statusOf(row: PredictionHistoryRow): 'pending' | 'correct' | 'incorrect' {
  if (row.is_correct === true) return 'correct'
  if (row.is_correct === false) return 'incorrect'
  return 'pending'
}

function toCSV(rows: PredictionHistoryRow[]): string {
  const header = [
    'match_id',
    'match_date',
    'home_team',
    'away_team',
    'league',
    'predicted_outcome',
    'predicted_scoreline',
    'predicted_confidence',
    'actual_outcome',
    'actual_scoreline',
    'is_correct',
  ].join(',')
  const body = rows
    .map((r) =>
      [
        r.match_id,
        r.match_date,
        JSON.stringify(r.home_team),
        JSON.stringify(r.away_team),
        JSON.stringify(r.league ?? ''),
        r.predicted_outcome,
        JSON.stringify(r.predicted_scoreline ?? ''),
        r.predicted_confidence?.toFixed(3) ?? '',
        r.actual_outcome ?? '',
        JSON.stringify(r.actual_scoreline ?? ''),
        r.is_correct == null ? '' : r.is_correct ? '1' : '0',
      ].join(',')
    )
    .join('\n')
  return `${header}\n${body}\n`
}

function downloadCSV(rows: PredictionHistoryRow[]) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pitchwise-history-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function HistoryPage() {
  const { gender } = useGenderQuery()
  const [filter, setFilter] = useState<Filter>('all')
  const [limit] = useState(100)
  const { data, isLoading } = usePredictionHistory(limit)

  const rows = useMemo<PredictionHistoryRow[]>(() => data?.predictions ?? [], [data])
  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => statusOf(r) === filter)),
    [rows, filter]
  )

  const totals = useMemo(() => {
    const total = rows.length
    let correct = 0
    let incorrect = 0
    let pending = 0
    rows.forEach((r) => {
      const s = statusOf(r)
      if (s === 'correct') correct++
      else if (s === 'incorrect') incorrect++
      else pending++
    })
    const settled = correct + incorrect
    const accuracy = settled > 0 ? (correct / settled) * 100 : 0
    return { total, correct, incorrect, pending, accuracy }
  }, [rows])

  // Rolling accuracy sparkline — last N settled outcomes
  const sparkline = useMemo(() => {
    const settled = rows.filter((r) => r.is_correct === true || r.is_correct === false).reverse()
    if (settled.length === 0) return [] as number[]
    const window = 10
    const out: number[] = []
    settled.slice(0, 30).forEach((_, i) => {
      const denom = i + 1
      const slice = settled.slice(Math.max(0, denom - window), denom)
      const c = slice.filter((s) => s.is_correct).length
      out.push((c / slice.length) * 100)
    })
    return out
  }, [rows])

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-12">
      {/* Hero */}
      <Spotlight className="block rounded-2xl" size={460} color="color-mix(in srgb, var(--accent-primary) 14%, transparent)">
        <Card className="relative overflow-hidden p-6">
          <BorderBeam size={1} duration={11} borderRadius={16} />
          <div className="relative z-10 flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-caption font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                  Audit
                </p>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ring-1',
                    gender === 'women'
                      ? 'bg-[var(--accent-women)]/12 text-[var(--accent-women)] ring-[var(--accent-women)]/30'
                      : 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)] ring-[var(--accent-primary)]/30'
                  )}
                >
                  {gender === 'women' ? "Women's football" : "Men's football"}
                </span>
              </div>
              <h1 className="mt-1 text-display font-extrabold tracking-tight text-[var(--text-primary)]">
                Prediction history
              </h1>
              <p className="mt-2 max-w-xl text-small text-[var(--text-secondary)]">
                Every pick the model has made — green when we got it right, red when we missed.
                Honest by default.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <p className="text-caption uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                Settled accuracy
              </p>
              <NumberTicker
                value={totals.accuracy}
                decimalPlaces={1}
                suffix="%"
                className="text-display font-extrabold tabular-nums text-[var(--accent-primary)]"
              />
              {sparkline.length > 0 ? (
                <FormSparkline values={sparkline} width={140} height={32} accent="primary" />
              ) : null}
            </div>
          </div>
        </Card>
      </Spotlight>

      {/* Totals strip */}
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={totals.total} caption="all picks in window" accent="neutral" Icon={HistoryIcon} />
        <StatCard label="Correct" value={totals.correct} caption="settled" accent="primary" Icon={CheckCircle2} />
        <StatCard label="Incorrect" value={totals.incorrect} caption="settled" accent="loss" Icon={XCircle} />
        <StatCard label="Pending" value={totals.pending} caption="awaiting result" accent="warn" Icon={Clock} />
      </div>

      {/* Filter row */}
      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-3">
          {(['all', 'correct', 'incorrect', 'pending'] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilter(f)}
              className="capitalize"
            >
              {f}
              <span className="ml-1 text-[10px] opacity-75">
                ({f === 'all'
                  ? totals.total
                  : f === 'correct'
                    ? totals.correct
                    : f === 'incorrect'
                      ? totals.incorrect
                      : totals.pending})
              </span>
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={() => downloadCSV(rows)}
            disabled={rows.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </Card>

      {/* Table */}
      <div className="mt-3">
        {isLoading ? (
          <TableSkeleton rows={10} columns={6} />
        ) : filtered.length === 0 ? (
          <Card className="p-8 text-center text-small text-[var(--text-tertiary)]">
            No predictions match this filter.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-small">
                <thead>
                  <tr className="bg-[var(--muted-bg)] text-left text-caption uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Match</th>
                    <th className="px-4 py-2">League</th>
                    <th className="px-4 py-2">Pick</th>
                    <th className="px-4 py-2">Result</th>
                    <th className="px-4 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const status = statusOf(row)
                    return (
                      <tr
                        key={`${row.match_id}-${row.match_date}`}
                        className="border-t border-[var(--border-color)] transition-colors hover:bg-[var(--muted-bg)]/40"
                      >
                        <td className="px-4 py-2 font-mono text-caption text-[var(--text-tertiary)]">
                          {new Date(row.match_date).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            href={`/matches/${row.match_id}`}
                            className="text-[var(--text-primary)] hover:text-[var(--accent-primary)]"
                          >
                            {row.home_team} <span className="text-[var(--text-tertiary)]">vs</span>{' '}
                            {row.away_team}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-caption text-[var(--text-tertiary)]">
                          {row.league ?? '—'}
                        </td>
                        <td className="px-4 py-2 font-mono">
                          <span className="text-[var(--text-primary)]">
                            {OUTCOME_LABELS[row.predicted_outcome] ?? row.predicted_outcome}
                          </span>
                          {row.predicted_scoreline ? (
                            <span className="ml-1.5 text-[var(--text-tertiary)]">
                              · {row.predicted_scoreline}
                            </span>
                          ) : null}
                          {typeof row.predicted_confidence === 'number' ? (
                            <span className="ml-1.5 text-[10px] text-[var(--text-tertiary)]">
                              ({Math.round(row.predicted_confidence * 100)}%)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 font-mono text-[var(--text-secondary)]">
                          {row.actual_scoreline ?? (status === 'pending' ? '—' : row.actual_outcome ?? '—')}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-mono uppercase tracking-[0.16em] ring-1',
                              status === 'correct' && 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)] ring-[var(--accent-primary)]/30',
                              status === 'incorrect' && 'bg-[var(--accent-loss)]/12 text-[var(--accent-loss)] ring-[var(--accent-loss)]/30',
                              status === 'pending' && 'bg-[var(--accent-warn)]/12 text-[var(--accent-warn)] ring-[var(--accent-warn)]/30'
                            )}
                          >
                            {status === 'correct' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : status === 'incorrect' ? (
                              <XCircle className="h-3 w-3" />
                            ) : (
                              <Clock className="h-3 w-3" />
                            )}
                            {status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
