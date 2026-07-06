'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Check, ChevronDown, Download, Minus, X } from 'lucide-react'

import { AsyncSection, FlagBadge } from '@/components/primitives'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'
import { useGenderQuery } from '@/hooks/useGenderQuery'

/**
 * /history — the audit ledger of settled predictions (Matchday v3).
 *
 * Day-grouped, dense fixture rows: teams with real crests/flags, final
 * score, the AI pick (outcome + scoreline) and a correct/incorrect tick
 * coloured by token. Model *quality* stats live on /accuracy — this page
 * is the ledger, so the only summary is a quiet "N settled" line.
 */

/**
 * Shape of a PredictionRecord as served by /api/v1/tracking/recent (the Node
 * route streams the committed backend JSON through unmodified).
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

/** bet365-grammar outcome code for the compact mobile chip. */
function pickCode(r: HistoryRecord): string {
  if (r.predicted_winner === 'home') return '1'
  if (r.predicted_winner === 'away') return '2'
  return 'X'
}

function dayKey(r: HistoryRecord): string {
  return (r.match_date || '').slice(0, 10) || 'unknown'
}

function formatDay(key: string): string {
  if (key === 'unknown') return 'Date unknown'
  const d = new Date(`${key}T12:00:00`)
  if (Number.isNaN(d.getTime())) return key
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
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

/** One team line: crest/flag, name, final goals when settled. */
function TeamLine({
  name,
  goals,
  settled,
  emphasis,
  national,
}: {
  name: string
  goals: number | null
  settled: boolean
  emphasis: 'winner' | 'loser' | 'neutral'
  national: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="inline-flex shrink-0" aria-hidden="true">
        <FlagBadge country={national ? name : undefined} teamName={name} size={20} />
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
      {settled && goals != null && (
        <span
          className={cn(
            'shrink-0 pl-2 text-[13px] font-bold tabular-nums',
            emphasis === 'loser' ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'
          )}
        >
          {goals}
        </span>
      )}
    </div>
  )
}

/** Result tick — green correct / red incorrect / muted pending, tokens only. */
function ResultTick({ status }: { status: 'correct' | 'incorrect' | 'pending' }) {
  if (status === 'correct') {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]"
        role="img"
        aria-label="Pick correct"
        title="Pick correct"
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'incorrect') {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-loss)]/12 text-[var(--accent-loss)]"
        role="img"
        aria-label="Pick incorrect"
        title="Pick incorrect"
      >
        <X className="h-3 w-3" strokeWidth={3} />
      </span>
    )
  }
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--muted-bg)] text-[var(--text-tertiary)]"
      role="img"
      aria-label="Awaiting result"
      title="Awaiting result"
    >
      <Minus className="h-3 w-3" strokeWidth={3} />
    </span>
  )
}

/** One ledger row — MatchRow grammar: status col, stacked teams, AI zone. */
function LedgerRow({ record }: { record: HistoryRecord }) {
  const status = statusOf(record)
  const settled = status !== 'pending'
  const accent = getLeagueAccent(record.league)
  const national = NATIONAL_COMPETITIONS.has(accent.competitionId)
  const winner = record.actual_winner

  let homeEmphasis: 'winner' | 'loser' | 'neutral' = 'neutral'
  let awayEmphasis: 'winner' | 'loser' | 'neutral' = 'neutral'
  if (settled && winner === 'home') {
    homeEmphasis = 'winner'
    awayEmphasis = 'loser'
  } else if (settled && winner === 'away') {
    homeEmphasis = 'loser'
    awayEmphasis = 'winner'
  }

  const href = /^\d+$/.test(String(record.match_id))
    ? `/matches/${record.match_id}`
    : undefined

  const inner = (
    <div className="flex w-full items-center">
      {/* Status column — FT for settled, dash for pending */}
      <div className="flex w-[52px] shrink-0 items-center justify-center">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          {settled ? 'FT' : '–'}
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5 border-l border-[var(--border-color)]/60 py-2 pl-3">
        <TeamLine
          name={record.home_team}
          goals={record.actual_home_goals}
          settled={settled}
          emphasis={homeEmphasis}
          national={national}
        />
        <TeamLine
          name={record.away_team}
          goals={record.actual_away_goals}
          settled={settled}
          emphasis={awayEmphasis}
          national={national}
        />
      </div>

      {/* AI pick zone — committed pick only, cyan data accent */}
      <div className="ml-3 flex shrink-0 items-center gap-2 pr-1">
        <span className="hidden w-24 truncate text-right text-[11px] text-[var(--text-tertiary)] md:block">
          {accent.competitionId !== 'unknown' ? accent.shortName : record.league}
        </span>
        <span className="inline-flex max-w-[10rem] items-center rounded-md bg-[var(--accent-ai)]/10 px-1.5 py-1 text-[10px] font-semibold tabular-nums text-[var(--accent-ai)]">
          {/* Full pick label on >=sm; compact "AI 2-1" / "AI 1|X|2" on phones */}
          <span className="hidden truncate sm:inline">AI {pickLabel(record)}</span>
          {record.predicted_scoreline ? (
            <span className="shrink-0 sm:ml-1">
              <span className="sm:hidden">AI </span>
              {record.predicted_scoreline}
            </span>
          ) : (
            <span className="shrink-0 sm:hidden">AI {pickCode(record)}</span>
          )}
        </span>
        <ResultTick status={status} />
      </div>
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

  const visible = filtered.slice(0, visibleCount)

  // First fetch still in flight — no counts until real data lands.
  const hydrating = isLoading && rows.length === 0
  const settledCount = counts.correct + counts.incorrect

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

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-3 pb-8 pt-3 sm:px-4">
        {/* Compact title line — the ledger is the page */}
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="text-[15px] font-bold text-[var(--text-primary)]">History</h1>
            {!hydrating && counts.all > 0 && (
              <span className="truncate text-[11px] tabular-nums text-[var(--text-tertiary)]">
                {settledCount} settled
                {counts.pending > 0 ? ` · ${counts.pending} pending` : ''}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[36px] shrink-0 gap-1.5 text-xs text-[var(--text-secondary)]"
            onClick={() => downloadCSV(filtered)}
            disabled={filtered.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>

        {/* Outcome filter — quiet pills */}
        <div
          className="mb-1 flex flex-wrap items-center gap-1"
          role="group"
          aria-label="Filter by outcome"
        >
          {(['all', 'correct', 'incorrect', 'pending'] as const).map((f) => {
            const active = statusFilter === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                aria-pressed={active}
                className={cn(
                  'flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold capitalize transition-colors',
                  active
                    ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                )}
              >
                {f}
                {!hydrating && (
                  <span className="text-[10px] tabular-nums opacity-75">{counts[f]}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* League filter — quiet chips, second line only when useful */}
        {leagues.length > 1 && (
          <div
            className="mb-2 flex flex-wrap items-center gap-1"
            role="group"
            aria-label="Filter by league"
          >
            <button
              type="button"
              onClick={() => setLeagueFilter(null)}
              aria-pressed={leagueFilter === null}
              className={cn(
                'flex min-h-[36px] items-center rounded-full px-3 text-xs font-semibold transition-colors',
                leagueFilter === null
                  ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              All leagues
            </button>
            {leagues.map((name) => {
              const acc = getLeagueAccent(name)
              const active = leagueFilter === name
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setLeagueFilter(active ? null : name)}
                  aria-pressed={active}
                  className={cn(
                    'flex min-h-[36px] items-center rounded-full px-3 text-xs font-semibold transition-colors',
                    active
                      ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  )}
                >
                  {acc.competitionId !== 'unknown' ? acc.shortName : name}
                </button>
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
          {/* Day-grouped ledger */}
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.key} aria-label={formatDay(group.key)}>
                <h2
                  className={cn(
                    'sticky top-[var(--shell-topbar-h)] z-10 -mx-1 flex items-baseline justify-between',
                    'bg-[var(--background)]/95 px-1 py-2 backdrop-blur-sm'
                  )}
                >
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">
                    {formatDay(group.key)}
                  </span>
                  <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">
                    {group.records.length}
                  </span>
                </h2>
                <Card className="overflow-hidden p-0">
                  <div className="divide-y divide-[var(--border-color)]/40">
                    {group.records.map((r) => (
                      <LedgerRow key={`${r.match_id}-${r.match_date}`} record={r} />
                    ))}
                  </div>
                </Card>
              </section>
            ))}
          </div>

          {/* Load more */}
          <div className="mt-4 flex flex-col items-center gap-1">
            <p className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
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
      </div>
    </div>
  )
}
