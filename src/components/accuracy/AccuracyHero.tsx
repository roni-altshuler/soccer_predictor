'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Brain, ShieldCheck, TrendingUp } from 'lucide-react'
import Link from 'next/link'

import { GenderToggle } from '@/components/GenderToggle'
import { AnimatedCounter } from '@/components/ui/animated-counter'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Big "Our AI gets it right 60.56% of the time" hero for the public
 * accuracy page. Pure presentational — accepts the live numbers from
 * the parent so it works for both the men's and women's universe via
 * the prominent gender toggle anchored top-right.
 *
 * Redesigned in Phase 2 to use the new shell tokens (.bento-card,
 * .gradient-border, .ambient-bg) and the shared AnimatedCounter primitive
 * for consistency with the home HeroSpotlight.
 */

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

  return (
    <section
      aria-label="AI model accuracy headline"
      className={cn(
        'relative isolate overflow-hidden rounded-3xl border border-[var(--border-color)]',
        className
      )}
    >
      {/* Layered gradient + soft noise */}
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0 -z-10',
          gender === 'women'
            ? 'bg-[radial-gradient(60%_55%_at_15%_20%,rgba(236,72,153,0.20),transparent_60%),radial-gradient(50%_50%_at_88%_25%,rgba(139,92,246,0.20),transparent_60%)]'
            : 'bg-[radial-gradient(60%_55%_at_15%_20%,color-mix(in_srgb,var(--accent-ai)_24%,transparent),transparent_60%),radial-gradient(50%_50%_at_88%_25%,color-mix(in_srgb,var(--accent-primary)_24%,transparent),transparent_60%)]'
        )}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-ai)]/40 to-transparent"
      />

      <div className="relative z-10 flex flex-col gap-6 p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Badge
              variant="outline"
              className="border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]"
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
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
              Outcome accuracy
            </p>
            {hasData ? (
              <h1 className="font-display text-[clamp(3rem,7vw,5.5rem)] font-extrabold leading-[0.95] tracking-tight">
                <span className="bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-ai)] to-[var(--accent-primary)] bg-clip-text text-transparent">
                  <AnimatedCounter value={accuracyPctScaled} digits={1} suffix="%" duration={1.2} />
                </span>
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
                  we&apos;ve tracked. Recent 50 picks running at{' '}
                  <span className="font-semibold tabular-nums text-[var(--accent-primary)]">
                    {recentPctScaled.toFixed(1)}%
                  </span>
                  .
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
            className="gradient-border group flex items-center gap-3 rounded-2xl p-3 transition-transform hover:-translate-y-0.5 md:min-w-[260px]"
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

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <BentoStat
            label="Brier score"
            value={brierScore.toFixed(3)}
            hint="Lower = better calibrated. Random guessing ≈ 0.66."
            tone="ai"
          />
          <BentoStat
            label="Recent (last 50)"
            value={`${recentPctScaled.toFixed(1)}%`}
            hint="How the model is doing right now."
            tone="primary"
            icon={<TrendingUp className="h-3 w-3" />}
          />
          <BentoStat
            label="Completed"
            value={completedPredictions.toLocaleString()}
            hint="Predictions whose result is in."
            tone="muted"
          />
          <BentoStat
            label="Pending"
            value={pendingCount.toLocaleString()}
            hint="Picks waiting on a final whistle."
            tone="muted"
          />
        </div>
      </div>
    </section>
  )
}

function BentoStat({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string
  value: string
  hint: string
  tone: 'primary' | 'ai' | 'muted'
  icon?: React.ReactNode
}) {
  const toneClasses =
    tone === 'primary'
      ? 'text-[var(--accent-primary)]'
      : tone === 'ai'
        ? 'text-[var(--accent-ai)]'
        : 'text-[var(--text-primary)]'

  return (
    <div className="bento-card p-3" title={hint}>
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
        {icon}
        {label}
      </p>
      <p className={cn('mt-1.5 text-h3 font-black tabular-nums', toneClasses)}>{value}</p>
    </div>
  )
}
