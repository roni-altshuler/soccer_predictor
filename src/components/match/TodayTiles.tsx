'use client'

import { getLeagueAccent } from '@/lib/leagueAccents'
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
 *
 * Each count now carries one thin bar drawn from the same payload (2026-09-12):
 * the day's matches split live · to play · full-time, and the competitions by
 * their share of the slate. The number stays the primary encoding and the
 * caption names every segment in order, so nothing is read from colour alone.
 */

/** European seasons straddle the new year; August is the boundary. */
export function seasonLabel(dateKey: string): string {
  const [y, m] = dateKey.split('-').map(Number)
  if (!y || !m) return ''
  const start = m >= 8 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export interface CompetitionCount {
  name: string
  count: number
}

interface Segment {
  key: string
  count: number
  tone: string
}

/** One 3px track, segments proportional to count, a 2px surface gap between. */
function SegmentBar({ segments, total }: { segments: Segment[]; total: number }) {
  const shown = segments.filter((s) => s.count > 0)
  if (total <= 0 || shown.length === 0) return null
  return (
    <div
      aria-hidden="true"
      className="mt-1.5 flex h-[3px] w-full gap-[2px] overflow-hidden rounded-full"
    >
      {shown.map((s) => (
        <span
          key={s.key}
          className="h-full rounded-full"
          style={{ width: `${(s.count / total) * 100}%`, background: s.tone }}
        />
      ))}
    </div>
  )
}

function Tile({
  label,
  value,
  caption,
  bar,
}: {
  label: string
  value: string
  caption?: string | null
  bar?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {label}
      </p>
      <p className="tabular mt-0.5 font-mono text-[15px] text-[var(--text-primary)]">{value}</p>
      {bar}
      {caption ? (
        <p className="mt-1 truncate font-mono text-[9px] tabular-nums text-[var(--text-tertiary)]">
          {caption}
        </p>
      ) : null}
    </div>
  )
}

const ink = (pct: number) => `color-mix(in srgb, var(--text-secondary) ${pct}%, transparent)`

/** Abbreviate a competition for a 9px caption; the raw name when unknown. */
function shortName(name: string): string {
  const accent = getLeagueAccent(name)
  return accent.competitionId === 'unknown' ? name : accent.shortName
}

export function TodayTiles({
  dateKey,
  total,
  live,
  upcoming = 0,
  finished = 0,
  leagues,
  competitions = [],
  className,
}: {
  dateKey: string
  total: number
  live: number
  upcoming?: number
  finished?: number
  leagues: number
  /** Matches per competition, any order — sorted here. */
  competitions?: CompetitionCount[]
  className?: string
}) {
  const season = seasonLabel(dateKey)
  // Nothing scheduled is not a statistic worth four boxes — the empty state
  // below already says so, and a row of zeros reads as a broken page.
  if (total === 0) return null

  const statusParts = [
    live ? `${live} live` : null,
    upcoming ? `${upcoming} to play` : null,
    finished ? `${finished} FT` : null,
  ].filter(Boolean)

  const ranked = [...competitions].filter((c) => c.count > 0).sort((a, b) => b.count - a.count)
  const top = ranked.slice(0, 3)
  const rest = ranked.slice(3).reduce((n, c) => n + c.count, 0)
  const shareTotal = ranked.reduce((n, c) => n + c.count, 0)
  const compCaption = top.length
    ? [...top.map((c) => `${shortName(c.name)} ${c.count}`), rest ? `+${rest}` : null]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <section
      className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)}
      aria-label="Season context"
      data-today-tiles
    >
      {season ? <Tile label="Season" value={season} /> : null}
      <Tile
        label="Matches"
        value={String(total)}
        caption={statusParts.length > 1 ? statusParts.join(' · ') : null}
        bar={
          <SegmentBar
            total={total}
            segments={[
              // Live is the one segment with a meaning of its own, and it
              // takes the token that means live everywhere else on the site.
              { key: 'live', count: live, tone: 'var(--accent-loss)' },
              { key: 'upcoming', count: upcoming, tone: ink(55) },
              { key: 'finished', count: finished, tone: ink(28) },
            ]}
          />
        }
      />
      <Tile label="Live now" value={String(live)} caption={live ? `of ${total}` : null} />
      <Tile
        label="Competitions"
        value={String(leagues)}
        caption={compCaption}
        bar={
          <SegmentBar
            total={shareTotal}
            segments={[
              ...top.map((c, i) => ({ key: c.name, count: c.count, tone: ink([70, 50, 36][i]) })),
              { key: 'rest', count: rest, tone: ink(18) },
            ]}
          />
        }
      />
    </section>
  )
}
