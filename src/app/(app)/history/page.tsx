'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Check, ChevronDown, Download } from 'lucide-react'

import {
  AsyncSection,
  FlagBadge,
  LeagueChip,
  ProbBar,
  SectionHeader,
  StatCard,
  StatusChip,
} from '@/components/primitives'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'
import { useGenderQuery } from '@/hooks/useGenderQuery'

/**
 * Shape of a PredictionRecord as served by /api/v1/tracking/recent (the Node
 * route streams the committed backend JSON through unmodified, so newer
 * fields like `top_scorelines` arrive when present).
 */
interface HistoryRecord {
  match_id: string | number
  home_team: string
  away_team: string
  league: string
  match_date: string
  gender?: 'M' | 'F' | null
  predicted_winner?: 'home' | 'draw' | 'away' | null
  predicted_scoreline?: string | null
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  confidence?: number | null
  venue?: string | null
  actual_winner: 'home' | 'draw' | 'away' | null
  actual_home_goals: number | null
  actual_away_goals: number | null
  winner_correct: boolean | null
  scoreline_correct: boolean | null
  top_scorelines?: { score: string; probability: number }[] | null
  scoreline_in_top5?: boolean | null
}

interface RecentResponse {
  count: number
  predictions: HistoryRecord[]
}

type StatusFilter = 'all' | 'correct' | 'incorrect' | 'pending'

const WINDOW_LIMIT = 200
const PAGE_SIZE = 25
const MIN_SAMPLE = 10

/** Competitions whose participants are national teams (flag identities). */
const NATIONAL_COMPETITIONS = new Set([
  'fifa.world',
  'fifa.world.w',
  'uefa.euro',
  'uefa.euro.w',
  'conmebol.america',
])

async function fetcher(url: string): Promise<RecentResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as RecentResponse
}

function statusOf(r: HistoryRecord): 'correct' | 'incorrect' | 'pending' {
  if (r.winner_correct === true) return 'correct'
  if (r.winner_correct === false) return 'incorrect'
  return 'pending'
}

function pickLabel(r: HistoryRecord): string {
  if (r.predicted_winner === 'home') return r.home_team
  if (r.predicted_winner === 'away') return r.away_team
  return 'Draw'
}

function dayKey(r: HistoryRecord): string {
  return (r.match_date || '').slice(0, 10) || 'unknown'
}

function formatDay(key: string): string {
  if (key === 'unknown') return 'Date unknown'
  const d = new Date(`${key}T12:00:00`)
  if (Number.isNaN(d.getTime())) return key
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function toCSV(rows: HistoryRecord[]): string {
  const header = [
    'match_id',
    'match_date',
    'home_team',
    'away_team',
    'league',
    'predicted_winner',
    'predicted_scoreline',
    'predicted_home_win',
    'predicted_draw',
    'predicted_away_win',
    'confidence',
    'actual_winner',
    'actual_score',
    'winner_correct',
    'scoreline_in_top5',
  ].join(',')
  const body = rows
    .map((r) =>
      [
        r.match_id,
        r.match_date,
        JSON.stringify(r.home_team),
        JSON.stringify(r.away_team),
        JSON.stringify(r.league ?? ''),
        r.predicted_winner ?? '',
        JSON.stringify(r.predicted_scoreline ?? ''),
        r.predicted_home_win?.toFixed(4) ?? '',
        r.predicted_draw?.toFixed(4) ?? '',
        r.predicted_away_win?.toFixed(4) ?? '',
        r.confidence ?? '',
        r.actual_winner ?? '',
        r.actual_home_goals != null && r.actual_away_goals != null
          ? `${r.actual_home_goals}-${r.actual_away_goals}`
          : '',
        r.winner_correct == null ? '' : r.winner_correct ? '1' : '0',
        r.scoreline_in_top5 == null ? '' : r.scoreline_in_top5 ? '1' : '0',
      ].join(',')
    )
    .join('\n')
  return `${header}\n${body}\n`
}

function downloadCSV(rows: HistoryRecord[]) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pitchwise-history-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** One team line inside a fixture row: identity, name, goals when settled. */
function TeamLine({
  name,
  goals,
  settled,
  won,
  drew,
  national,
}: {
  name: string
  goals: number | null
  settled: boolean
  won: boolean
  drew: boolean
  national: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <FlagBadge country={national ? name : undefined} teamName={name} size={20} />
      <span
        className={cn(
          'truncate text-sm',
          settled
            ? won || drew
              ? 'font-semibold text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)]'
            : 'font-medium text-[var(--text-primary)]'
        )}
      >
        {name}
      </span>
      {settled && goals != null && (
        <span
          className={cn(
            'ml-auto pl-2 text-sm tabular-nums',
            won
              ? 'font-bold text-[var(--accent-primary)]'
              : drew
                ? 'font-semibold text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)]'
          )}
        >
          {goals}
        </span>
      )}
    </div>
  )
}

function FixtureRow({ record }: { record: HistoryRecord }) {
  const status = statusOf(record)
  const settled = status !== 'pending'
  const accent = getLeagueAccent(record.league)
  const national = NATIONAL_COMPETITIONS.has(accent.competitionId)
  const winner = record.actual_winner

  return (
    <Link
      href={`/matches/${record.match_id}`}
      className="group block px-4 py-3 transition-colors odd:bg-[var(--muted-bg)]/40 hover:bg-[var(--card-hover)]"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
        {/* Identities + league/venue meta */}
        <div className="min-w-0 flex-1 space-y-1">
          <TeamLine
            name={record.home_team}
            goals={record.actual_home_goals}
            settled={settled}
            won={winner === 'home'}
            drew={winner === 'draw'}
            national={national}
          />
          <TeamLine
            name={record.away_team}
            goals={record.actual_away_goals}
            settled={settled}
            won={winner === 'away'}
            drew={winner === 'draw'}
            national={national}
          />
          <p className="flex items-center gap-1.5 truncate text-[11px] text-[var(--text-tertiary)]">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: accent.accent }}
            />
            <span className="truncate">
              {record.league}
              {record.venue ? ` · ${record.venue}` : ''}
            </span>
          </p>
        </div>

        {/* Model probabilities */}
        <div className="w-full shrink-0 md:w-44">
          <ProbBar
            home={record.predicted_home_win}
            draw={record.predicted_draw}
            away={record.predicted_away_win}
            size="sm"
            showLabels
          />
        </div>

        {/* Predicted pick + scoreline chip (+ top-5 tick when earned) */}
        <div className="flex shrink-0 items-center gap-1.5 md:w-48 md:justify-end">
          <span
            className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded-md px-2 py-1 text-xs font-semibold tabular-nums"
            style={{
              color: 'var(--accent-ai)',
              backgroundColor: 'color-mix(in srgb, var(--accent-ai) 12%, transparent)',
            }}
          >
            <span className="truncate">{pickLabel(record)}</span>
            {record.predicted_scoreline ? <span>· {record.predicted_scoreline}</span> : null}
          </span>
          {record.scoreline_in_top5 === true && (
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
              style={{
                color: 'var(--accent-ai)',
                backgroundColor: 'color-mix(in srgb, var(--accent-ai) 14%, transparent)',
              }}
              title="Actual scoreline was in the model's top-5"
              aria-label="Actual scoreline was in the model's top-5"
            >
              <Check className="h-3 w-3" />
            </span>
          )}
        </div>

        {/* Settlement status */}
        <div className="flex shrink-0 items-center md:w-24 md:justify-end">
          <StatusChip status={status} />
        </div>
      </div>
    </Link>
  )
}

export default function HistoryPage() {
  const { gender, withParam } = useGenderQuery()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [leagueFilter, setLeagueFilter] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const { data, error, isLoading, mutate } = useSWR<RecentResponse>(
    withParam(`/api/v1/tracking/recent?limit=${WINDOW_LIMIT}`),
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 5 * 60_000 }
  )

  const rows = useMemo<HistoryRecord[]>(() => data?.predictions ?? [], [data])

  // Reset pagination whenever the view changes underneath it.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [statusFilter, leagueFilter, gender])

  const leagues = useMemo(() => {
    const counts = new Map<string, number>()
    rows.forEach((r) => {
      if (r.league) counts.set(r.league, (counts.get(r.league) ?? 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  }, [rows])

  const leagueRows = useMemo(
    () => (leagueFilter ? rows.filter((r) => r.league === leagueFilter) : rows),
    [rows, leagueFilter]
  )

  const counts = useMemo(() => {
    let correct = 0
    let incorrect = 0
    let pending = 0
    leagueRows.forEach((r) => {
      const s = statusOf(r)
      if (s === 'correct') correct++
      else if (s === 'incorrect') incorrect++
      else pending++
    })
    return { all: leagueRows.length, correct, incorrect, pending }
  }, [leagueRows])

  const filtered = useMemo(
    () =>
      statusFilter === 'all'
        ? leagueRows
        : leagueRows.filter((r) => statusOf(r) === statusFilter),
    [leagueRows, statusFilter]
  )

  // Window-level summary (honest: rates only render with n >= MIN_SAMPLE).
  const summary = useMemo(() => {
    const settled = counts.correct + counts.incorrect
    const accuracy = settled >= MIN_SAMPLE ? Math.round((counts.correct / settled) * 100) : null
    const top5Sample = leagueRows.filter((r) => typeof r.scoreline_in_top5 === 'boolean')
    const top5Hits = top5Sample.filter((r) => r.scoreline_in_top5 === true).length
    const top5Rate =
      top5Sample.length >= MIN_SAMPLE
        ? Math.round((top5Hits / top5Sample.length) * 100)
        : null
    return { settled, accuracy, top5Rate, top5Hits, top5N: top5Sample.length }
  }, [counts, leagueRows])

  const visible = filtered.slice(0, visibleCount)

  // First fetch still in flight — show honest dashes instead of zeros.
  const hydrating = isLoading && rows.length === 0

  const groups = useMemo(() => {
    const out: { key: string; records: HistoryRecord[] }[] = []
    visible.forEach((r) => {
      const key = dayKey(r)
      const last = out[out.length - 1]
      if (last && last.key === key) last.records.push(r)
      else out.push({ key, records: [r] })
    })
    return out
  }, [visible])

  const activeAccent = leagueFilter ? getLeagueAccent(leagueFilter) : null

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 pb-12 pt-6">
      {/* Hero band */}
      <section className="hero-band p-6">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
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
                {gender === 'women' ? 'Women’s football' : 'Men’s football'}
              </span>
            </div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[var(--text-primary)] md:text-4xl">
              Prediction history
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              Every pick the model has made — green when we got it right, red when we
              missed. Honest by default.
            </p>
          </div>
          <div className="shrink-0 md:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              Picks in window
            </p>
            <p className="mt-1 text-4xl font-black tabular-nums text-[var(--text-primary)]">
              {hydrating ? '—' : rows.length}
            </p>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              newest {WINDOW_LIMIT}-pick audit window
            </p>
          </div>
        </div>
      </section>

      {/* Summary stats — rates hide behind an honest dash below n=10 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Accuracy"
          value={summary.accuracy != null ? `${summary.accuracy}%` : '—'}
          sub={
            summary.accuracy != null
              ? `${counts.correct}/${summary.settled} settled in window`
              : hydrating
                ? 'loading window…'
                : `needs ${MIN_SAMPLE}+ settled picks`
          }
          accent="primary"
        />
        <StatCard
          label="Settled"
          value={hydrating ? '—' : summary.settled}
          sub="correct + incorrect"
        />
        <StatCard
          label="Pending"
          value={hydrating ? '—' : counts.pending}
          sub="awaiting result"
          accent="warn"
        />
        <StatCard
          label="Top-5 scoreline"
          value={summary.top5Rate != null ? `${summary.top5Rate}%` : '—'}
          sub={
            summary.top5Rate != null
              ? `${summary.top5Hits}/${summary.top5N} in model top-5`
              : 'awaiting settled sample'
          }
          accent="ai"
        />
      </div>

      {/* Ledger */}
      <section className="space-y-4">
        <SectionHeader
          kicker="Ledger"
          title="All picks"
          description="Grouped by matchday — filter by outcome or competition."
          action={
            <Button
              variant="outline"
              size="sm"
              className="min-h-[40px] gap-1.5"
              onClick={() => downloadCSV(filtered)}
              disabled={filtered.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          }
        />

        {/* Status segmented control */}
        <div
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)]/60 p-1"
          role="group"
          aria-label="Filter by outcome"
        >
          {(['all', 'correct', 'incorrect', 'pending'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              aria-pressed={statusFilter === f}
              className={cn(
                'min-h-[40px] rounded-lg px-3.5 text-sm font-semibold capitalize transition-colors',
                statusFilter === f
                  ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              {f}
              <span className="ml-1.5 text-xs tabular-nums text-[var(--text-tertiary)]">
                {hydrating ? '–' : counts[f]}
              </span>
            </button>
          ))}
        </div>

        {/* League filter chips */}
        {leagues.length > 1 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by league">
            <button
              type="button"
              onClick={() => setLeagueFilter(null)}
              aria-pressed={leagueFilter === null}
              className={cn(
                'inline-flex min-h-[40px] items-center rounded-full border px-3.5 text-xs font-semibold transition-colors',
                leagueFilter === null
                  ? 'border-[var(--text-secondary)] bg-[var(--card-bg)] text-[var(--text-primary)] ring-1 ring-[var(--text-secondary)]'
                  : 'border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
              )}
            >
              All leagues
            </button>
            {leagues.map((name) => {
              const acc = getLeagueAccent(name)
              return (
                <LeagueChip
                  key={name}
                  leagueId={acc.competitionId !== 'unknown' ? acc.competitionId : undefined}
                  name={name}
                  size="sm"
                  active={leagueFilter === name}
                  onClick={() => setLeagueFilter(leagueFilter === name ? null : name)}
                />
              )
            })}
          </div>
        )}

        <AsyncSection
          loading={isLoading}
          error={error as Error | undefined}
          onRetry={() => mutate()}
          section="prediction history"
          empty={filtered.length === 0}
          emptyState={
            <EmptyState
              illustration="no-predictions"
              title="No picks match this view"
              description="Try a different outcome or league filter — or check back after the next prediction run."
            />
          }
        >
          <Card
            className="overflow-hidden"
            style={
              activeAccent
                ? { borderLeft: `4px solid ${activeAccent.accent}` }
                : undefined
            }
          >
            {groups.map((group, groupIdx) => (
              <div key={group.key}>
                <div
                  className={cn(
                    'flex items-center justify-between border-y border-[var(--border-color)] bg-[var(--muted-bg)]/70 px-4 py-2',
                    groupIdx === 0 && 'border-t-0'
                  )}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    {formatDay(group.key)}
                  </p>
                  <p className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
                    {group.records.length} {group.records.length === 1 ? 'pick' : 'picks'}
                  </p>
                </div>
                <div>
                  {group.records.map((r) => (
                    <FixtureRow key={`${r.match_id}-${r.match_date}`} record={r} />
                  ))}
                </div>
              </div>
            ))}
          </Card>

          {/* Load more */}
          <div className="mt-4 flex flex-col items-center gap-1">
            <p className="text-xs tabular-nums text-[var(--text-tertiary)]">
              Showing {visible.length} of {filtered.length} picks
            </p>
            {filtered.length > visibleCount && (
              <Button
                variant="outline"
                className="min-h-[44px] gap-1.5"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                <ChevronDown className="h-4 w-4" />
                Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
              </Button>
            )}
          </div>
        </AsyncSection>
      </section>
    </div>
  )
}
