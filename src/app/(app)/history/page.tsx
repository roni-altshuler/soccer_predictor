'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { ChevronLeft, ChevronRight, Download, RotateCcw } from 'lucide-react'

import { LedgerSkeleton, LedgerTable } from '@/components/history/LedgerTable'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import {
  applyFilters,
  competitionsOf,
  DEFAULT_FILTERS,
  formatDateRange,
  OUTCOME_OPTIONS,
  PAGE_SIZE,
  PERIOD_OPTIONS,
  pageBounds,
  sortNewestFirst,
  summarise,
  toCSV,
  type LedgerFilters,
  type LedgerRecord,
  type OutcomeFilter,
  type PeriodFilter,
} from '@/lib/historyLedger'
import { cn } from '@/lib/utils'

/**
 * /history — the prediction record.
 *
 * A ledger, not a highlight reel: every prediction we published inside the
 * loaded window, the result that followed, and whether the call was right.
 * Model *quality* analysis (calibration, accuracy by competition) lives on
 * /accuracy; this page exists so the raw record can be read and exported.
 */

interface RecentResponse {
  count: number
  predictions: LedgerRecord[]
}

/** The tracking route caps a single request at 200 records. */
const WINDOW_LIMIT = 200

async function fetcher(url: string): Promise<RecentResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return (await res.json()) as RecentResponse
}

const controlClass =
  'h-9 min-h-[36px] rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] px-2.5 text-[13px] text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)] focus-visible:border-[var(--accent-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]'

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
    >
      {children}
    </label>
  )
}

export default function HistoryPage() {
  const { gender, withParam } = useGenderQuery()
  const [filters, setFilters] = useState<LedgerFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)

  const { data, error, isLoading, mutate } = useSWR<RecentResponse>(
    withParam(`/api/v1/tracking/recent?limit=${WINDOW_LIMIT}`),
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 5 * 60_000 }
  )

  const records = useMemo(
    () => sortNewestFirst(data?.predictions ?? []),
    [data]
  )

  const windowSummary = useMemo(() => summarise(records), [records])
  const windowRange = useMemo(() => formatDateRange(records), [records])
  const competitions = useMemo(() => competitionsOf(records), [records])

  const filtered = useMemo(() => applyFilters(records, filters), [records, filters])
  const bounds = useMemo(() => pageBounds(filtered.length, page), [filtered.length, page])
  const visible = useMemo(
    () => filtered.slice((bounds.page - 1) * PAGE_SIZE, bounds.page * PAGE_SIZE),
    [filtered, bounds.page]
  )

  // Any change to what's being asked for returns the reader to page one.
  useEffect(() => {
    setPage(1)
  }, [filters, gender])

  const update = useCallback(<K extends keyof LedgerFilters>(key: K, value: LedgerFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleExport = useCallback(() => {
    const blob = new Blob([toCSV(filtered)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `pitchverse-record-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [filtered])

  const filtersAreDefault =
    filters.outcome === DEFAULT_FILTERS.outcome &&
    filters.competition === DEFAULT_FILTERS.competition &&
    filters.period === DEFAULT_FILTERS.period &&
    filters.query.trim() === ''

  const hasWindow = records.length > 0

  return (
    <div className="mx-auto w-full max-w-5xl px-3 pb-10 pt-4 sm:px-4">
      {/* Header — what this page is, and the honest totals behind it */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold text-[var(--text-primary)]">
            Prediction record
          </h1>
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
            Every {gender === 'women' ? "women's" : "men's"} prediction we published in
            this window, and the result that followed.
          </p>
          {hasWindow && (
            <p className="mt-1 text-[12px] tabular-nums text-[var(--text-tertiary)]">
              {windowSummary.settled} settled
              {windowSummary.pending > 0 && ` · ${windowSummary.pending} awaiting result`}
              {windowRange && ` · ${windowRange}`}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:pointer-events-none disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download CSV
        </button>
      </header>

      {/* Controls — plain form fields, deliberately not chips */}
      <section
        aria-label="Filter the record"
        className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4"
      >
        <div className="min-w-0">
          <FieldLabel htmlFor="ledger-outcome">Outcome</FieldLabel>
          <select
            id="ledger-outcome"
            className={cn(controlClass, 'w-full')}
            value={filters.outcome}
            onChange={(e) => update('outcome', e.target.value as OutcomeFilter)}
          >
            {OUTCOME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <FieldLabel htmlFor="ledger-competition">Competition</FieldLabel>
          <select
            id="ledger-competition"
            className={cn(controlClass, 'w-full')}
            value={filters.competition}
            onChange={(e) => update('competition', e.target.value)}
          >
            <option value="all">All competitions</option>
            {competitions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <FieldLabel htmlFor="ledger-period">Period</FieldLabel>
          <select
            id="ledger-period"
            className={cn(controlClass, 'w-full')}
            value={String(filters.period)}
            onChange={(e) => update('period', Number(e.target.value) as PeriodFilter)}
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <FieldLabel htmlFor="ledger-query">Team</FieldLabel>
          <input
            id="ledger-query"
            type="search"
            autoComplete="off"
            placeholder="Filter by name"
            className={cn(controlClass, 'w-full')}
            value={filters.query}
            onChange={(e) => update('query', e.target.value)}
          />
        </div>
      </section>

      {/* The ledger */}
      {isLoading && records.length === 0 ? (
        <LedgerSkeleton />
      ) : error ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-6 py-10 text-center"
        >
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">
            The record couldn’t be loaded
          </p>
          <p className="max-w-sm text-[12px] text-[var(--text-tertiary)]">
            {(error as Error).message}
          </p>
          <button
            type="button"
            onClick={() => mutate()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[var(--border-color)] px-4 text-[13px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-6 py-12 text-center">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">
            {hasWindow ? 'Nothing in the record matches these filters' : 'No record yet'}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-[var(--text-tertiary)]">
            {hasWindow
              ? 'Widen the period, clear the team filter, or switch the outcome to “All predictions”.'
              : 'Nothing has been published for this universe yet. Settled predictions appear here once the matches they cover have been played.'}
          </p>
          {hasWindow && !filtersAreDefault && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="mt-4 inline-flex min-h-[44px] items-center rounded-md border border-[var(--border-color)] px-4 text-[13px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              Reset filters
            </button>
          )}
        </div>
      ) : (
        <>
          <LedgerTable records={visible} />

          <nav
            aria-label="Record pagination"
            className="mt-3 flex flex-wrap items-center justify-between gap-3"
          >
            <p
              className="text-[12px] tabular-nums text-[var(--text-tertiary)]"
              aria-live="polite"
            >
              {bounds.from}–{bounds.to} of {filtered.length}
              {filtered.length !== records.length && ` (filtered from ${records.length})`}
            </p>
            {bounds.pageCount > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={bounds.page <= 1}
                  className="inline-flex h-11 min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-3 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">Previous</span>
                </button>
                <span className="px-2 text-[12px] tabular-nums text-[var(--text-tertiary)]">
                  Page {bounds.page} / {bounds.pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(bounds.pageCount, p + 1))}
                  disabled={bounds.page >= bounds.pageCount}
                  className="inline-flex h-11 min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-3 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:pointer-events-none disabled:opacity-40"
                >
                  <span className="sr-only sm:not-sr-only">Next</span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </nav>
        </>
      )}
    </div>
  )
}
