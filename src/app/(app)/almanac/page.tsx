'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'

import { AnimatedNumber } from '@/components/motion'
import { EmptyState } from '@/components/EmptyState'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

import {
  type AlmanacQuery,
  type Direction,
  MINUTE_MAX,
  MINUTE_STEP,
  PRESETS,
  THIN_SAMPLE,
  buildQuestion,
  diffFrom,
  directionOf,
  magnitudeOf,
  minuteLabel,
  parseQuery,
  queryToSearch,
  stateKey,
} from './query'

/**
 * The Almanac (VISION_2030 §3.7) — ask football's history a structured
 * question, get a count, not a guess. Every number on this page is an exact
 * tally of warehouse rows served by `/api/v1/rarity`; unseen states return an
 * honest zero. No LLM, no estimate — the Boardroom's Historian, exposed direct.
 */

interface Precedent {
  match_id: string
  home: string
  away: string
  final_score: string
  date: string
  competition_id: string
  side: 'home' | 'away'
  outcome: 'w' | 'd'
}

interface RarityResponse {
  key: string
  gender: 'M' | 'F'
  diff: number
  minute_bucket: number
  n: number
  w: number
  d: number
  l: number
  win_rate: number
  matches_covered: number
  examples?: Precedent[]
}

/** Men's ESPN endpoints whose event ids resolve on the match-detail route. */
const ROUTABLE_ESPN = new Set([
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'ned.1', 'por.1', 'usa.1',
  'uefa.champions', 'uefa.europa', 'uefa.euro', 'conmebol.america', 'fifa.world',
])

/**
 * Warehouse match ids are provider-prefixed (`espn_eng.1_605659`,
 * `fd_premier_league_…`, `of_esp.1_…`). Only ESPN-sourced men's rows carry a
 * numeric event id the `/matches/[id]` route can load; everything else renders
 * as a static row rather than a knowingly-broken link (honest affordances).
 */
function precedentHref(p: Precedent): string | undefined {
  const m = p.match_id.match(/^espn_(.+)_(\d+)$/)
  if (!m) return undefined
  const [, competition, eventId] = m
  if (!ROUTABLE_ESPN.has(competition)) return undefined
  return `/matches/${eventId}?league=${competition}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// -- controls ----------------------------------------------------------------

/** Segmented button group — one active option, 44px tap targets, tokens only. */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  accent = 'var(--accent-primary)',
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  accent?: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex min-h-[44px] items-center rounded-lg border px-3.5 text-sm font-semibold transition-colors',
              active
                ? 'text-[var(--text-primary)]'
                : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]'
            )}
            style={
              active
                ? {
                    borderColor: accent,
                    background: `color-mix(in srgb, ${accent} 12%, var(--card-bg))`,
                  }
                : undefined
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function QueryBuilder({
  query,
  onChange,
}: {
  query: AlmanacQuery
  onChange: (next: AlmanacQuery) => void
}) {
  const direction = directionOf(query.diff)
  const magnitude = magnitudeOf(query.diff)
  const accent = query.gender === 'F' ? 'var(--accent-women)' : 'var(--accent-primary)'

  return (
    <div className="space-y-5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 sm:p-5">
      {/* Universe */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          Universe
        </p>
        <Segmented
          label="Universe"
          value={query.gender}
          accent={accent}
          onChange={(gender) => onChange({ ...query, gender })}
          options={[
            { value: 'M', label: "Men's" },
            { value: 'F', label: "Women's" },
          ]}
        />
      </div>

      {/* Match state */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          A team that is
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented
            label="Match state"
            value={direction}
            accent={accent}
            onChange={(dir: Direction) => onChange({ ...query, diff: diffFrom(dir, magnitude) })}
            options={[
              { value: 'trailing', label: 'Trailing by' },
              { value: 'level', label: 'Level' },
              { value: 'leading', label: 'Leading by' },
            ]}
          />
          {direction !== 'level' && (
            <Segmented
              label="By how many goals"
              value={magnitude}
              accent={accent}
              onChange={(mag: number) => onChange({ ...query, diff: diffFrom(direction, mag) })}
              options={[
                { value: 1, label: '1' },
                { value: 2, label: '2' },
                { value: 3, label: '3+' },
              ]}
            />
          )}
        </div>
      </div>

      {/* Minute */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            At the
          </p>
          <p className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
            {minuteLabel(query.minute)}
          </p>
        </div>
        <input
          type="range"
          min={0}
          max={MINUTE_MAX}
          step={MINUTE_STEP}
          value={query.minute}
          onChange={(e) => onChange({ ...query, minute: Number(e.target.value) })}
          aria-label="Minute of the match"
          aria-valuetext={minuteLabel(query.minute)}
          className="h-11 w-full cursor-pointer accent-[var(--accent-primary)]"
          style={{ accentColor: accent }}
        />
        <div className="flex justify-between text-[10px] tabular-nums text-[var(--text-tertiary)]">
          <span>Kickoff</span>
          <span>45’</span>
          <span>90’</span>
        </div>
      </div>
    </div>
  )
}

// -- answer -------------------------------------------------------------------

function OutcomeBar({
  label,
  count,
  n,
  color,
}: {
  label: string
  count: number
  n: number
  color: string
}) {
  const pct = n > 0 ? (count / n) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(pct > 0 ? 1 : 0, pct)}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-[var(--text-tertiary)]">
        <span className="font-semibold text-[var(--text-secondary)]">{count.toLocaleString()}</span>{' '}
        · {pct.toFixed(1)}%
      </span>
    </div>
  )
}

function AnswerPanel({ data, query }: { data: RarityResponse; query: AlmanacQuery }) {
  const { n, w, d, l, matches_covered } = data
  const winPct = n > 0 ? (w / n) * 100 : 0
  const thin = n > 0 && n < THIN_SAMPLE

  if (n === 0) {
    return (
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
        <EmptyState
          title="No such situation in the covered matches"
          description="That’s the answer — this exact state has never occurred in the history we count. Try an earlier minute or a smaller deficit."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5 sm:p-6">
      {/* Headline: the win rate, with the exact fraction beside it */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <AnimatedNumber
          value={winPct}
          decimals={1}
          suffix="%"
          className="text-5xl font-bold tracking-tight text-[var(--text-primary)]"
        />
        <p className="text-sm tabular-nums text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">
            {w.toLocaleString()} of {n.toLocaleString()}
          </span>{' '}
          {n === 1 ? 'match' : 'matches'} went on to win
        </p>
      </div>

      {/* Thin-sample honesty flag */}
      {thin && (
        <p
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium"
          style={{
            color: 'var(--accent-warn)',
            borderColor: 'color-mix(in srgb, var(--accent-warn) 40%, transparent)',
            background: 'color-mix(in srgb, var(--accent-warn) 8%, transparent)',
          }}
          role="note"
        >
          Thin sample — only {n.toLocaleString()} such {n === 1 ? 'match' : 'matches'} on record. Treat with care.
        </p>
      )}

      {/* Full W/D/L split from the queried side's point of view */}
      <div className="space-y-2">
        <OutcomeBar label="Won" count={w} n={n} color="var(--accent-primary)" />
        <OutcomeBar label="Drew" count={d} n={n} color="var(--accent-warn)" />
        <OutcomeBar label="Lost" count={l} n={n} color="var(--accent-loss)" />
      </div>

      {/* n-count honesty line */}
      <p className="border-t border-[var(--border-color)] pt-3 text-[11px] tabular-nums text-[var(--text-tertiary)]">
        Counted across {matches_covered.toLocaleString()} covered {query.gender === 'F' ? "women's" : "men's"} matches ·
        state {stateKey(query)}
      </p>
    </div>
  )
}

// -- precedents ---------------------------------------------------------------

function PrecedentRow({ p }: { p: Precedent }) {
  const accent = getLeagueAccent(p.competition_id)
  const href = precedentHref(p)

  const inner = (
    <div className="flex w-full items-center gap-3 px-3 py-2.5">
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: accent.accent }}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-secondary)]">
        <span className={p.side === 'home' ? 'font-semibold text-[var(--text-primary)]' : undefined}>
          {p.home}
        </span>
        <span className="px-1.5 font-semibold tabular-nums text-[var(--text-primary)]">
          {p.final_score}
        </span>
        <span className={p.side === 'away' ? 'font-semibold text-[var(--text-primary)]' : undefined}>
          {p.away}
        </span>
      </span>
      <span className="hidden shrink-0 text-[11px] text-[var(--text-tertiary)] sm:inline">
        {accent.competitionId !== 'unknown' ? accent.shortName : p.competition_id}
      </span>
      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-tertiary)]">
        {formatDate(p.date)}
      </span>
    </div>
  )

  const className =
    'block w-full transition-colors hover:bg-[var(--card-hover)] focus-visible:bg-[var(--card-hover)] focus-visible:outline-none'

  return href ? (
    <Link href={href} prefetch={false} className={className}>
      {inner}
    </Link>
  ) : (
    <div className="w-full">{inner}</div>
  )
}

function PrecedentsRail({ precedents }: { precedents: Precedent[] }) {
  if (precedents.length === 0) return null
  const shown = precedents.slice(0, 12)
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          Precedents
        </h2>
        <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
          {shown.length} shown
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
        <div className="divide-y divide-[var(--border-color)]/50">
          {shown.map((p) => (
            <PrecedentRow key={`${p.match_id}-${p.side}`} p={p} />
          ))}
        </div>
      </div>
    </div>
  )
}

// -- page ---------------------------------------------------------------------

function AlmanacContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { asQueryParam } = useGenderQuery()

  const [query, setQuery] = useState<AlmanacQuery>(() =>
    parseQuery(
      {
        gender: searchParams.get('gender'),
        diff: searchParams.get('diff'),
        minute: searchParams.get('minute'),
      },
      asQueryParam
    )
  )

  const [data, setData] = useState<RarityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const question = useMemo(() => buildQuestion(query), [query])

  // Keep the URL in lockstep with the builder — a shared link IS the product.
  useEffect(() => {
    router.replace(`/almanac?${queryToSearch(query)}`, { scroll: false })
  }, [query, router])

  // Exact-count lookup + precedents. A valid query never errors; unseen → n:0.
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    fetch(
      `/api/v1/rarity?gender=${query.gender}&diff=${query.diff}&minute=${query.minute}&examples=1`,
      { signal: controller.signal }
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json: RarityResponse) => {
        setData(json)
        setLoading(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setError(true)
        setLoading(false)
      })
    return () => controller.abort()
  }, [query])

  const activePreset = PRESETS.find(
    (p) => p.query.gender === query.gender && p.query.diff === query.diff && p.query.minute === query.minute
  )

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-3 pb-12 pt-4 sm:px-4">
        {/* Data-first title — no hero */}
        <div className="mb-4 px-1">
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Almanac</h1>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
            Ask the history — every answer is a count, not a guess.
          </p>
        </div>

        {/* Starter questions */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => {
            const active = activePreset?.id === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => setQuery(preset.query)}
                className={cn(
                  'inline-flex min-h-[44px] items-center rounded-full border px-3.5 text-xs font-semibold transition-colors',
                  active
                    ? 'border-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,var(--card-bg))] text-[var(--text-primary)]'
                    : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]'
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>

        {/* The composed question, live */}
        <p className="mb-4 px-1 text-lg font-semibold leading-snug text-[var(--text-primary)]">
          {question}
        </p>

        <div className="space-y-4">
          <QueryBuilder query={query} onChange={setQuery} />

          {/* Answer */}
          {error ? (
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
              <EmptyState
                title="Couldn’t reach the history"
                description="The count service didn’t respond. Try again in a moment."
              />
            </div>
          ) : loading && !data ? (
            <div className="flex min-h-[180px] items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent-primary)] border-t-transparent" />
            </div>
          ) : data ? (
            <>
              <AnswerPanel data={data} query={query} />
              <PrecedentsRail precedents={data.examples ?? []} />
            </>
          ) : null}
        </div>

        <p className="mt-8 px-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Counts are exact tallies of covered matches — educational only, not betting advice.
        </p>
      </div>
    </div>
  )
}

export default function AlmanacPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent-primary)] border-t-transparent" />
        </div>
      }
    >
      <AlmanacContent />
    </Suspense>
  )
}
