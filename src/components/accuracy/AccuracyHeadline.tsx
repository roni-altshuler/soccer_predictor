'use client'

import { useMemo } from 'react'

import { AnimatedNumber } from '@/components/motion'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import {
  MIN_ROBUST_SAMPLE,
  ALWAYS_HOME_RATE,
  count,
  pct1,
  samplePhrase,
  signedPts,
} from './accuracyMetrics'

/**
 * The one number this page exists to report: how often the picked winner
 * was the actual winner, with the sample it rests on and a reference point
 * that makes it readable.
 *
 * Design intent — the old hero showed "43.6%" in accent green with no
 * yardstick, so a reader had no way to tell whether that was good. A
 * three-way outcome picked blind lands 1 in 3, so the margin over that is
 * the honest context, and it is what gets the accent colour. The rate
 * itself renders in primary text: the page reports a record, it does not
 * congratulate itself.
 */

interface AccuracyHeadlineProps {
  /** Winner hit rate 0..1. */
  accuracy: number
  /** Settled picks the rate is measured over. */
  settled: number
  /** Picks still awaiting a final result. */
  pending: number
  /** W/L across the last (up to) 20 settled picks, newest FIRST. */
  recentForm: string[]
  gender: 'men' | 'women'
  className?: string
}

function computeStreak(newestFirst: string[]): { type: 'W' | 'L'; count: number } | null {
  const first = newestFirst[0]
  if (first !== 'W' && first !== 'L') return null
  let n = 0
  for (const f of newestFirst) {
    if (f !== first) break
    n++
  }
  return { type: first, count: n }
}

export function AccuracyHeadline({
  accuracy,
  settled,
  pending,
  recentForm,
  gender,
  className,
}: AccuracyHeadlineProps) {
  const universe = gender === 'women' ? "Women's football" : "Men's football"
  const marginPts = (accuracy - ALWAYS_HOME_RATE) * 100
  const beatsRandom = marginPts > 0
  const smallSample = settled < MIN_ROBUST_SAMPLE

  // Oldest → newest so the strip reads left-to-right like a form guide.
  const formOldestFirst = useMemo(() => [...recentForm].reverse(), [recentForm])
  const streak = useMemo(() => computeStreak(recentForm), [recentForm])

  // Scale the comparison bar so both markers sit comfortably inside it.
  const scaleMax = Math.max(0.6, accuracy + 0.1)
  const ratePos = Math.min(100, (accuracy / scaleMax) * 100)
  const randomPos = Math.min(100, (ALWAYS_HOME_RATE / scaleMax) * 100)

  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-start sm:justify-between md:p-5">
        {/* The number */}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Winner called correctly
          </p>

          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <AnimatedNumber
              value={accuracy * 100}
              decimals={1}
              suffix="%"
              className="text-[44px] font-black leading-none tracking-tight tabular-nums text-[var(--text-primary)]"
            />
            <span
              className={cn(
                'inline-flex items-center rounded-md px-1.5 py-0.5 text-[12px] font-bold tabular-nums',
                beatsRandom
                  ? 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]'
                  : 'bg-[var(--accent-loss)]/12 text-[var(--accent-loss)]'
              )}
            >
              {signedPts(marginPts)}
            </span>
          </div>

          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            across{' '}
            <span className="font-semibold tabular-nums text-[var(--text-primary)]">
              {samplePhrase(settled)}
            </span>
            {pending > 0 && (
              <span className="text-[var(--text-tertiary)]">
                {' '}
                · {count(pending)} awaiting a result
              </span>
            )}
          </p>

          {/* The yardstick: the home side wins 43% of the time, and picking
              it needs no model. A random pick is not a comparison anyone
              would make, and using it overstates the margin by 10 points. */}
          <div className="mt-3 max-w-[340px]">
            <div
              className="relative h-1.5 w-full rounded-full bg-[var(--muted-bg)]"
              role="img"
              aria-label={`Hit rate ${pct1(accuracy)}, compared with ${pct1(
                ALWAYS_HOME_RATE
              )} for always picking the home team`}
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent-primary)]/70"
                style={{ width: `${ratePos}%` }}
              />
              <span
                aria-hidden="true"
                className="absolute -top-1 h-3.5 w-px bg-[var(--text-tertiary)]"
                style={{ left: `${randomPos}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">
              Marker at {pct1(ALWAYS_HOME_RATE)} — always picking the home team, which needs
              no model.
            </p>
          </div>

          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            {universe}
          </p>
        </div>

        {/* Recent form */}
        {formOldestFirst.length > 0 && (
          <div className="shrink-0 sm:text-right">
            <div className="flex items-center gap-2 sm:justify-end">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                Last {formOldestFirst.length}
              </span>
              {streak && streak.count >= 2 && (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                    streak.type === 'W'
                      ? 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]'
                      : 'bg-[var(--accent-loss)]/12 text-[var(--accent-loss)]'
                  )}
                >
                  {streak.count} in a row
                </span>
              )}
            </div>
            {/* Fixed-width ticks on one line — wrapping split the strip
                into uneven clumps that read as a pattern in the data. */}
            <div
              className="mt-1.5 flex gap-[3px] sm:justify-end"
              role="img"
              aria-label={`Last ${formOldestFirst.length} settled picks, oldest to newest: ${formOldestFirst.join(', ')}`}
            >
              {formOldestFirst.map((f, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={cn(
                    'h-3.5 w-1.5 rounded-[2px]',
                    f === 'W' ? 'bg-[var(--accent-primary)]' : 'bg-[var(--accent-loss)]/45'
                  )}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-[var(--text-tertiary)]">
              Newest at the end
            </p>
          </div>
        )}
      </div>

      {smallSample && (
        <p className="border-t border-[var(--border-color)] bg-[var(--muted-bg)]/40 px-4 py-2.5 text-[11px] text-[var(--text-secondary)] md:px-5">
          Only {samplePhrase(settled)} so far — treat this rate and every breakdown below as
          provisional.
        </p>
      )}
    </Card>
  )
}
