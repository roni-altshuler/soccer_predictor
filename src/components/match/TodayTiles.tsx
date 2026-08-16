'use client'

import { cn } from '@/lib/utils'

/**
 * Season context above the scores list — Hardwood's tile row, adapted.
 *
 * **What these deliberately are not.** The sibling project's tiles read
 * "Games forecast · With a line · Flagged as value", which are facts about the
 * pipeline rather than about football. Pitchverse retired exactly that shape
 * once already: "FIXTURES TRACKED 18", "AI PICKS GENERATED", "Models live ·
 * v2.3" are listed in DESIGN.md under why the previous theme failed, and rule
 * 4 forbids surfacing internal telemetry on a consumer surface.
 *
 * So every tile here is a fact about the day's football, countable from the
 * same payload that draws the list underneath. Nothing about how many
 * forecasts exist, when the cache refreshed, or which model is serving. Model
 * *quality* has a home on this page already — the evidence panel at the
 * bottom, below the numbers it justifies.
 */

/** European seasons straddle the new year; August is the boundary. */
export function seasonLabel(dateKey: string): string {
  const [y, m] = dateKey.split('-').map(Number)
  if (!y || !m) return ''
  const start = m >= 8 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {label}
      </p>
      <p className="tabular mt-0.5 font-mono text-[15px] text-[var(--text-primary)]">{value}</p>
    </div>
  )
}

export function TodayTiles({
  dateKey,
  total,
  live,
  leagues,
  className,
}: {
  dateKey: string
  total: number
  live: number
  leagues: number
  className?: string
}) {
  const season = seasonLabel(dateKey)
  // Nothing scheduled is not a statistic worth four boxes — the empty state
  // below already says so, and a row of zeros reads as a broken page.
  if (total === 0) return null

  return (
    <section
      className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)}
      aria-label="Season context"
      data-today-tiles
    >
      {season ? <Tile label="Season" value={season} /> : null}
      <Tile label="Matches" value={String(total)} />
      <Tile label="Live now" value={String(live)} />
      <Tile label="Competitions" value={String(leagues)} />
    </section>
  )
}
