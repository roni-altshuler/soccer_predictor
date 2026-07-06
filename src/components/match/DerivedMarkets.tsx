'use client'

import { useMemo } from 'react'

import { cn } from '@/lib/utils'

export interface DerivedMarketsData {
  over_under?: Record<string, { over: number; under: number }>
  btts?: { yes: number; no: number }
  correct_score_top5?: Array<{ home: number; away: number; probability: number }>
}

interface DerivedMarketsProps {
  data?: DerivedMarketsData | null
  homeTeam?: string
  awayTeam?: string
  onRefresh?: () => void
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function pct(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`
}

const OVER_UNDER_LINES = ['0.5', '1.5', '2.5', '3.5'] as const

/**
 * Quiet AI-market probability rows (totals, BTTS, correct score) in the
 * bet365 data-grid register: one hairline row per market, thin cyan
 * `--accent-ai` bar for the modelled probability, tabular numerals. The
 * leading option in each pair is saturated; the trailing option muted.
 * Renders nothing when no market data exists.
 */
function ProbRow({
  label,
  value,
  emphasized = true,
  scaleMax = 1,
}: {
  label: string
  value: number
  emphasized?: boolean
  /** Visual scale ceiling — lets low-probability sets (correct score) stay legible. */
  scaleMax?: number
}) {
  const p = clamp01(value)
  const width = scaleMax > 0 ? Math.min(1, p / scaleMax) : p
  return (
    <div className="flex min-h-[28px] items-center gap-3">
      <span
        className={cn(
          'w-16 shrink-0 text-[12px] tabular-nums',
          emphasized ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
        )}
      >
        {label}
      </span>
      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{
            width: `${width * 100}%`,
            background: emphasized
              ? 'var(--accent-ai)'
              : 'color-mix(in srgb, var(--accent-ai) 35%, transparent)',
          }}
        />
      </div>
      <span
        className={cn(
          'w-10 shrink-0 text-right text-[12px] tabular-nums',
          emphasized ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
        )}
      >
        {pct(p)}
      </span>
    </div>
  )
}

function MarketColumn({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          {title}
        </h4>
        {hint && <span className="text-[10px] text-[var(--text-tertiary)]">{hint}</span>}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

export default function DerivedMarkets({ data, homeTeam, awayTeam, onRefresh }: DerivedMarketsProps) {
  const overUnderRows = useMemo(() => {
    if (!data?.over_under) return []
    return OVER_UNDER_LINES.map((line) => {
      const row = data.over_under?.[line]
      if (!row) return null
      return { line: line as string, over: clamp01(row.over), under: clamp01(row.under) }
    }).filter((row): row is { line: string; over: number; under: number } => row !== null)
  }, [data])

  const btts = data?.btts
  const topScores = data?.correct_score_top5 || []

  // Additive: render nothing if no payload at all.
  if (!data || (overUnderRows.length === 0 && !btts && topScores.length === 0)) {
    return null
  }

  return (
    <section
      className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
      aria-label="AI goal and scoreline markets"
    >
      <header className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Goal markets</h3>
          <span className="rounded border border-[color-mix(in_srgb,var(--accent-ai)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-ai)_10%,transparent)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--accent-ai)]">
            AI
          </span>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="min-h-[32px] rounded-md border border-[var(--border-color)] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
          >
            Refresh
          </button>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-3">
        {/* Over / Under */}
        {overUnderRows.length > 0 && (
          <MarketColumn title="Total goals" hint="Over the line">
            {overUnderRows.map(({ line, over }) => (
              <ProbRow key={line} label={`Over ${line}`} value={over} emphasized={over >= 0.5} />
            ))}
          </MarketColumn>
        )}

        {/* BTTS */}
        {btts && (
          <MarketColumn title="Both teams to score">
            <ProbRow label="Yes" value={btts.yes} emphasized={btts.yes >= btts.no} />
            <ProbRow label="No" value={btts.no} emphasized={btts.no > btts.yes} />
          </MarketColumn>
        )}

        {/* Correct Score Top 5 */}
        {topScores.length > 0 && (
          <MarketColumn
            title="Correct score"
            hint={homeTeam && awayTeam ? `${homeTeam} · ${awayTeam}` : 'Top 5'}
          >
            {(() => {
              const rows = topScores.slice(0, 5)
              const maxP = Math.max(...rows.map((r) => clamp01(r.probability)), 1e-6)
              return rows.map((row, idx) => (
                <ProbRow
                  key={`${row.home}-${row.away}-${idx}`}
                  label={`${row.home}–${row.away}`}
                  value={row.probability}
                  emphasized={idx === 0}
                  scaleMax={maxP}
                />
              ))
            })()}
          </MarketColumn>
        )}
      </div>
    </section>
  )
}
