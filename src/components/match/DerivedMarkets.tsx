'use client'

import { useMemo } from 'react'

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
      className="fm-card overflow-hidden"
      style={{ background: '#0d1117', borderColor: 'color-mix(in srgb, #7c3aed 32%, var(--border-color))' }}
      aria-label="Derived betting markets"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: '#7c3aed' }} />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Derived Markets</h3>
          <span className="text-[10px] text-[var(--text-tertiary)]">model-derived</span>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="text-[11px] px-2 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#7c3aed]/50 transition-colors"
          >
            Refresh
          </button>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-4" style={{ background: '#0d1117' }}>
        {/* Over / Under */}
        {overUnderRows.length > 0 && (
          <div className="rounded-xl p-3" style={{ background: '#161b22', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">Total Goals</h4>
              <span className="text-[10px] text-[var(--text-tertiary)]">Over / Under</span>
            </div>
            <div className="space-y-2.5">
              {overUnderRows.map(({ line, over, under }) => (
                <div key={line} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">Line {line}</span>
                    <span>
                      <span className="text-[var(--text-primary)] font-semibold">{pct(over)}</span>
                      <span className="text-[var(--text-tertiary)]"> / {pct(under)}</span>
                    </span>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${clamp01(over) * 100}%`, background: '#7c3aed' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BTTS */}
        {btts && (
          <div className="rounded-xl p-3" style={{ background: '#161b22', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">Both Teams to Score</h4>
              <span className="text-[10px] text-[var(--text-tertiary)]">BTTS</span>
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--text-primary)]">Yes</span>
                  <span className="text-[var(--text-secondary)]">{pct(btts.yes)}</span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${clamp01(btts.yes) * 100}%`, background: '#7c3aed' }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="font-semibold text-[var(--text-primary)]">No</span>
                  <span className="text-[var(--text-secondary)]">{pct(btts.no)}</span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${clamp01(btts.no) * 100}%`, background: 'rgba(124,58,237,0.45)' }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Correct Score Top 5 */}
        {topScores.length > 0 && (
          <div className="rounded-xl p-3" style={{ background: '#161b22', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">Correct Score</h4>
              <span className="text-[10px] text-[var(--text-tertiary)]">Top 5</span>
            </div>
            <div className="space-y-2">
              {topScores.slice(0, 5).map((row, idx) => {
                const p = clamp01(row.probability)
                return (
                  <div key={`${row.home}-${row.away}-${idx}`} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-[var(--text-primary)] tabular-nums" aria-label={`Score ${row.home} to ${row.away}`}>
                        {row.home}-{row.away}
                      </span>
                      <span className="text-[var(--text-secondary)] tabular-nums">{pct(p)}</span>
                    </div>
                    <div className="relative h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${p * 100}%`, background: '#7c3aed' }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            {(homeTeam || awayTeam) && (
              <p className="mt-3 text-[10px] text-[var(--text-tertiary)] truncate">
                {homeTeam || 'Home'} vs {awayTeam || 'Away'}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
