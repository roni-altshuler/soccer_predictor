'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Brain, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

import { GenderToggle } from '@/components/GenderToggle'
import { StatCard } from '@/components/primitives'
import { AnimatedCounter } from '@/components/ui/animated-counter'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Compact hero band for the public accuracy page — primary (results)
 * accent per the Broadcast design language. Pure presentational —
 * accepts the live numbers from the parent so it works for both the
 * men's and women's universe via the gender toggle anchored top-right.
 *
 * Data honesty (design rule 3): the recent-window hit rate only renders
 * when at least 10 predictions have settled; the Brier score and the
 * headline only render once real outcomes exist. No 0.0% from empty
 * windows, ever.
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
  const reduce = useReducedMotion()
  const universeLabel = gender === 'women' ? "women's universe" : "men's universe"
  const accuracyPctScaled = accuracyPct * 100
  const recentPctScaled = recentAccuracy * 100
  const pendingCount = Math.max(0, totalPredictions - completedPredictions)
  const hasData = completedPredictions > 0
  // The "recent" rate is computed over the last (up to) 50 settled picks —
  // only honest to show once the window has a real sample behind it.
  const recentWindow = Math.min(50, completedPredictions)
  const showRecent = completedPredictions >= MIN_WINDOW_SAMPLES

  return (
    <section
      aria-label="AI model accuracy headline"
      className={cn(
        'surface-elevated relative isolate overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className
      )}
    >
      {/* Subtle primary-accent gradient (8–12% opacity per design contract) */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_55%_at_12%_18%,color-mix(in_srgb,var(--accent-primary)_12%,transparent),transparent_60%),radial-gradient(45%_50%_at_90%_20%,color-mix(in_srgb,var(--accent-primary)_8%,transparent),transparent_60%)]"
      />

      <div className="relative z-10 flex flex-col gap-6 p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Badge
              variant="outline"
              className="border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]"
            >
              <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
              Audit · {universeLabel}
            </Badge>
            <p className="max-w-xl text-sm text-[var(--text-secondary)]">
              Live audit of every prediction the unified multi-task model has made — the
              same engine that powers the home Match Centre.
            </p>
          </div>
          <GenderToggle size="default" />
        </div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto] md:items-end"
        >
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Outcome accuracy
            </p>
            {hasData ? (
              <h1 className="font-display text-[clamp(3rem,7vw,5.5rem)] font-extrabold leading-[0.95] tracking-tight tabular-nums text-[var(--accent-primary)]">
                <AnimatedCounter value={accuracyPctScaled} digits={1} suffix="%" duration={1.2} />
              </h1>
            ) : (
              <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] font-extrabold leading-tight text-[var(--text-primary)]">
                Collecting…
              </h1>
            )}
            <p className="max-w-2xl text-small text-[var(--text-secondary)]">
              {hasData ? (
                <>
                  Across{' '}
                  <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                    {completedPredictions.toLocaleString()}
                  </span>{' '}
                  completed predictions of the{' '}
                  <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                    {totalPredictions.toLocaleString()}
                  </span>{' '}
                  we&apos;ve tracked.
                  {showRecent && (
                    <>
                      {' '}Recent {recentWindow} picks running at{' '}
                      <span className="font-semibold tabular-nums text-[var(--accent-primary)]">
                        {Math.round(recentPctScaled)}%
                      </span>
                      .
                    </>
                  )}
                </>
              ) : totalPredictions > 0 ? (
                <>
                  <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                    {totalPredictions.toLocaleString()}
                  </span>{' '}
                  predictions tracked — none with a final result yet. The headline number
                  appears here once the outcome fetcher settles its first match.
                </>
              ) : (
                <>The unified {universeLabel} model hasn&apos;t made any predictions yet.</>
              )}
            </p>
          </div>

          {/* CTA card — pull from the trust strip into a clickable AI promo */}
          <Link
            href="/predict"
            className="gradient-border group flex min-h-[44px] items-center gap-3 rounded-2xl p-3 transition-transform hover:-translate-y-0.5 md:min-w-[260px]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10">
              <Brain className="h-5 w-5 text-[var(--accent-ai)]" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Try it yourself
              </p>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Predict any matchup
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent-ai)]" />
          </Link>
        </motion.div>

        {/* Stat rail — StatCards render only when the sample supports them
            (rule 3): no Brier/recent-rate from an empty or tiny window. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {hasData && (
            <StatCard
              label="Brier score"
              value={brierScore.toFixed(3)}
              sub="Lower = better calibrated. Random ≈ 0.66."
              accent="ai"
              size="sm"
            />
          )}
          {showRecent && (
            <StatCard
              label={`Recent (last ${recentWindow})`}
              value={`${Math.round(recentPctScaled)}%`}
              sub="How the model is doing right now."
              accent="primary"
              size="sm"
            />
          )}
          <StatCard
            label="Completed"
            value={completedPredictions.toLocaleString()}
            sub="Predictions whose result is in."
            size="sm"
          />
          <StatCard
            label="Pending"
            value={pendingCount.toLocaleString()}
            sub="Picks waiting on a final whistle."
            size="sm"
          />
        </div>
      </div>
    </section>
  )
}
