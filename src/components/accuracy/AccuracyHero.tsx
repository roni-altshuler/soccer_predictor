'use client'

import { useMemo } from 'react'

import { AnimatedNumber } from '@/components/motion'
import { StatCard } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Performance scoreboard for /accuracy — Matchday v3.1 grammar: one flat
 * quiet card that reads like a track record. Left: the big headline hit
 * rate. Right: the last-20 W/L strip (most recent last) with the current
 * streak. Below: a rail of compact stat tiles.
 *
 * Data honesty (design rule 5): every tile renders only when its data
 * exists — windowed rates need a real sample behind them, probability
 * scores need settled picks. Nothing is ever shown as a fabricated 0.
 */

/** Minimum settled sample before a windowed rate is honest to show. */
const MIN_WINDOW_SAMPLES = 10

interface AccuracyHeroProps {
  accuracyPct: number          // 0..1
  completedPredictions: number
  totalPredictions: number
  /** Brier score — null hides the tile. */
  brierScore: number | null
  /** Expected calibration error 0..1 — null hides the tile. */
  calibrationError: number | null
  recentAccuracy: number       // 0..1 over the last (up to) 50 settled picks
  /** W/L across the last (up to) 20 settled picks, newest FIRST. */
  recentForm: string[]
  gender: 'men' | 'women'
  className?: string
}

function computeStreak(newestFirst: string[]): { type: 'W' | 'L'; count: number } | null {
  const first = newestFirst[0]
  if (first !== 'W' && first !== 'L') return null
  let count = 0
  for (const f of newestFirst) {
    if (f !== first) break
    count++
  }
  return { type: first, count }
}

export function AccuracyHero({
  accuracyPct,
  completedPredictions,
  totalPredictions,
  brierScore,
  calibrationError,
  recentAccuracy,
  recentForm,
  gender,
  className,
}: AccuracyHeroProps) {
  const universeLabel = gender === 'women' ? "Women's football" : "Men's football"
  const hasData = completedPredictions > 0
  const pendingCount = Math.max(0, totalPredictions - completedPredictions)
  const recentWindow = Math.min(50, completedPredictions)
  const showRecent = completedPredictions >= MIN_WINDOW_SAMPLES

  // Oldest → newest so the strip reads left-to-right like a form guide.
  const formOldestFirst = useMemo(() => [...recentForm].reverse(), [recentForm])
  const streak = useMemo(() => computeStreak(recentForm), [recentForm])

  return (
    <section aria-label="AI accuracy scoreboard" className={cn('space-y-3', className)}>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
          {/* Headline */}
          <div className="min-w-0">
            {hasData ? (
              <>
                <div className="flex items-baseline gap-2">
                  <AnimatedNumber
                    value={accuracyPct * 100}
                    decimals={1}
                    suffix="%"
                    className="text-4xl font-black leading-none tracking-tight text-[var(--accent-primary)]"
                  />
                </div>
                <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
                  correct winner across{' '}
                  <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                    {completedPredictions.toLocaleString()}
                  </span>{' '}
                  settled picks
                </p>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  {universeLabel}
                </p>
              </>
            ) : totalPredictions > 0 ? (
              <p className="text-[13px] text-[var(--text-secondary)]">
                <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                  {totalPredictions.toLocaleString()}
                </span>{' '}
                picks tracked — none settled yet. The headline number appears once the first
                result is in.
              </p>
            ) : (
              <p className="text-[13px] text-[var(--text-secondary)]">
                No picks tracked yet for this universe.
              </p>
            )}
          </div>

          {/* Recent form strip */}
          {formOldestFirst.length > 0 && (
            <div className="shrink-0 sm:text-right">
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  Last {formOldestFirst.length} picks
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
                    {streak.type}
                    {streak.count} streak
                  </span>
                )}
              </div>
              <div
                className="mt-1.5 flex max-w-[368px] flex-wrap gap-1 sm:justify-end"
                role="img"
                aria-label={`Result of the last ${formOldestFirst.length} picks, oldest to newest: ${formOldestFirst.join(', ')}`}
              >
                {formOldestFirst.map((f, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-[4px] text-[9px] font-bold leading-none',
                      f === 'W'
                        ? 'bg-[var(--accent-primary)]/18 text-[var(--accent-primary)]'
                        : 'bg-[var(--accent-loss)]/14 text-[var(--accent-loss)]'
                    )}
                  >
                    {f}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">most recent last</p>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border-color)]/40 px-4 py-2 md:px-5">
          <p className="text-[11px] text-[var(--text-tertiary)]">
            Every pick is locked before kick-off and scored against the final result — nothing is
            edited afterwards.
          </p>
        </div>
      </Card>

      {/* Stat rail — only tiles whose data exists. */}
      {hasData && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {showRecent && (
            <StatCard
              label={`Last ${recentWindow} picks`}
              value={<AnimatedNumber value={recentAccuracy * 100} decimals={1} suffix="%" />}
              sub="Recent settled window."
              size="sm"
            />
          )}
          {brierScore !== null && (
            <StatCard
              label="Brier score"
              value={<AnimatedNumber value={brierScore} decimals={3} />}
              sub="Probability error — lower is better. Guessing scores about 0.667."
              size="sm"
            />
          )}
          {calibrationError !== null && (
            <StatCard
              label="Calibration error"
              value={
                <AnimatedNumber value={calibrationError * 100} decimals={1} prefix="±" suffix="pts" />
              }
              sub="Gap between stated confidence and reality."
              size="sm"
            />
          )}
          <StatCard
            label="Settled"
            value={
              <AnimatedNumber
                value={completedPredictions}
                format={(n) => Math.round(n).toLocaleString()}
              />
            }
            sub="Picks with a final result."
            size="sm"
          />
          <StatCard
            label="Pending"
            value={
              <AnimatedNumber value={pendingCount} format={(n) => Math.round(n).toLocaleString()} />
            }
            sub="Waiting on the final whistle."
            size="sm"
          />
        </div>
      )}
    </section>
  )
}
