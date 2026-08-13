'use client'

import { TeamCrest } from '@/components/primitives/TeamCrest'
import { cn } from '@/lib/utils'

/**
 * A three-way probability, readable without colour and without a mouse.
 *
 * Three rules this component exists to keep:
 *
 *  1. **The number is always text.** The bar is a second encoding, never the
 *     only one. A reader on a monochrome display, a screen reader, or a phone
 *     in sunlight gets the same information as everyone else.
 *  2. **The segments carry labels, not just colours.** Home/draw/away are
 *     distinguished by position and by a written label; colour is redundant.
 *  3. **No false precision.** One decimal place. The model's calibration error
 *     is .0099, so the second decimal of a percentage is noise and printing it
 *     would imply a precision the measurement does not support.
 */

export interface ThreeWay {
  home: number
  draw: number
  away: number
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export function ProbabilityBar({
  probabilities,
  homeLabel = 'Home',
  awayLabel = 'Away',
  showLabels = true,
  className,
}: {
  probabilities: ThreeWay
  homeLabel?: string
  awayLabel?: string
  showLabels?: boolean
  className?: string
}) {
  const { home, draw, away } = probabilities
  const segments = [
    { key: 'home', label: homeLabel, value: clamp(home), tone: 'bg-[var(--accent-primary)]' },
    { key: 'draw', label: 'Draw', value: clamp(draw), tone: 'bg-[var(--text-tertiary)]' },
    { key: 'away', label: awayLabel, value: clamp(away), tone: 'bg-[var(--border-strong,var(--border-color))]' },
  ]

  return (
    <div className={cn('w-full', className)}>
      {showLabels ? (
        <div className="grid grid-cols-3 gap-2">
          {segments.map((s) => (
            <div key={s.key} className="min-w-0">
              <div className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                {s.label}
              </div>
              <div
                className={cn(
                  'font-mono text-[15px] tabular-nums',
                  s.key === 'home'
                    ? 'text-[var(--accent-primary)]'
                    : 'text-[var(--text-secondary)]',
                )}
              >
                {pct(s.value)}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/*
        Presentational: every number in it is already text above. Announcing
        the bar as well would read the same three figures twice.
      */}
      <div
        aria-hidden
        className={cn(
          'mt-2 flex h-[6px] w-full overflow-hidden rounded-full bg-[var(--border-color)]',
        )}
      >
        {segments.map((s) => (
          <div
            key={s.key}
            className={cn('h-full', s.tone)}
            style={{ width: `${s.value * 100}%` }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * A single probability as a bar with its value beside it — the title-race and
 * relegation shape. `max` scales the bar so the leader fills the row; without
 * it a 12% favourite renders as a sliver and the ordering stops being legible.
 */
export function ProbabilityRow({
  label,
  value,
  max = 1,
  tone = 'primary',
  suffix,
  competitionId,
  className,
}: {
  label: string
  value: number
  max?: number
  tone?: 'primary' | 'warn' | 'muted'
  suffix?: string
  /** When given, `label` is read as a club and gets its crest. */
  competitionId?: string
  className?: string
}) {
  const width = max > 0 ? Math.max(1.5, (clamp(value) / max) * 100) : 0
  const bar =
    tone === 'warn'
      ? 'bg-[var(--accent-warn)]'
      : tone === 'muted'
        ? 'bg-[var(--text-tertiary)]'
        : 'bg-[var(--accent-primary)]'

  return (
    <div className={cn('grid grid-cols-[1fr_auto] items-baseline gap-x-3', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {competitionId ? (
            <TeamCrest team={label} competitionId={competitionId} size="sm" />
          ) : null}
          <span className="truncate text-[13px] text-[var(--text-secondary)]">{label}</span>
          {suffix ? (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              {suffix}
            </span>
          ) : null}
        </div>
        <div
          aria-hidden
          className="mt-1.5 h-[4px] w-full overflow-hidden rounded-full bg-[var(--border-color)]"
        >
          <div className={cn('h-full rounded-full', bar)} style={{ width: `${width}%` }} />
        </div>
      </div>
      <span
        className={cn(
          'font-mono text-[13px] tabular-nums',
          tone === 'warn' ? 'text-[var(--accent-warn)]' : 'text-[var(--text-primary)]',
        )}
      >
        {pct(value)}
      </span>
    </div>
  )
}
