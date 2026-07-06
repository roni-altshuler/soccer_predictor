'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { StatCard } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Headline block for the public accuracy page — Matchday v3 grammar:
 * a flat card with the honest one-line result, then a quiet stat-tile
 * rail. No hero band, no giant number, no gradients.
 *
 * Data honesty (design rule 5): the recent-window hit rate only renders
 * when at least 10 predictions have settled — small windows fall back to
 * the all-time figure with a caption, never a fabricated 0.0%.
 */

/** Minimum settled sample before a windowed rate is honest to show. */
const MIN_WINDOW_SAMPLES = 10

interface AccuracyHeroProps {
  accuracyPct: number          // 0..1
  completedPredictions: number
  totalPredictions: number
  brierScore: number
  recentAccuracy: number       // 0..1
  gender: 'men' | 'women'
  className?: string
}

export function AccuracyHero({
  accuracyPct,
  completedPredictions,
  totalPredictions,
  brierScore,
  recentAccuracy,
  gender,
  className,
}: AccuracyHeroProps) {
  const universeLabel = gender === 'women' ? "Women's football" : "Men's football"
  const accuracyPctScaled = accuracyPct * 100
  const recentPctScaled = recentAccuracy * 100
  const pendingCount = Math.max(0, totalPredictions - completedPredictions)
  const hasData = completedPredictions > 0
  // The "recent" rate is computed over the last (up to) 50 settled picks —
  // only honest to show once the window has a real sample behind it.
  const recentWindow = Math.min(50, completedPredictions)
  const showRecent = completedPredictions >= MIN_WINDOW_SAMPLES

  return (
    <section aria-label="AI accuracy headline" className={cn('space-y-3', className)}>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            {hasData ? (
              <>
                <span className="text-xl font-bold tabular-nums leading-none text-[var(--accent-primary)]">
                  {accuracyPctScaled.toFixed(1)}%
                </span>
                <span className="text-[13px] text-[var(--text-secondary)]">
                  correct winner across{' '}
                  <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                    {completedPredictions.toLocaleString()}
                  </span>{' '}
                  settled picks
                </span>
              </>
            ) : totalPredictions > 0 ? (
              <span className="text-[13px] text-[var(--text-secondary)]">
                <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                  {totalPredictions.toLocaleString()}
                </span>{' '}
                picks tracked — none settled yet. The headline number appears once the first
                result is in.
              </span>
            ) : (
              <span className="text-[13px] text-[var(--text-secondary)]">
                No picks tracked yet for this universe.
              </span>
            )}
          </div>
          <span className="shrink-0 text-[11px] font-semibold text-[var(--text-tertiary)]">
            {universeLabel}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-color)]/40 px-4 py-2">
          <p className="text-[11px] text-[var(--text-tertiary)]">
            Every AI pick is scored against the final result — nothing is edited after kick-off.
          </p>
          <Link
            href="/predict"
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--accent-primary)] hover:underline"
          >
            Predict a matchup
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </Card>

      {/* Stat rail — quiet tiles; windowed rates render only when the
          sample supports them (never 0.0% from an empty window). */}
      {hasData && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {showRecent ? (
            <StatCard
              label={`Last ${recentWindow} picks`}
              value={`${Math.round(recentPctScaled)}%`}
              sub="Recent settled window."
              size="sm"
            />
          ) : (
            <StatCard
              label="Recent form"
              value={`${accuracyPctScaled.toFixed(1)}%`}
              sub={`All-time — shown until ${MIN_WINDOW_SAMPLES}+ recent picks settle.`}
              size="sm"
            />
          )}
          <StatCard
            label="Probability score"
            value={brierScore.toFixed(3)}
            sub="Lower = percentages closer to reality. Random is about 0.66."
            size="sm"
          />
          <StatCard
            label="Settled"
            value={completedPredictions.toLocaleString()}
            sub="Picks with a final result."
            size="sm"
          />
          <StatCard
            label="Pending"
            value={pendingCount.toLocaleString()}
            sub="Waiting on the final whistle."
            size="sm"
          />
        </div>
      )}
    </section>
  )
}
