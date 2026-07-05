'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Brain, Sparkles } from 'lucide-react'

import { AnimatedCounter } from '@/components/ui/animated-counter'
import { GenderToggle } from '@/components/GenderToggle'
import { DotPattern } from '@/components/magicui/dot-pattern'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { ShimmerButton } from '@/components/magicui/shimmer-button'
import { Spotlight } from '@/components/magicui/spotlight'
import { StatCard } from '@/components/primitives'
import { useGenderPreference } from '@/hooks/useGenderPreference'
import { cn } from '@/lib/utils'

/**
 * Honest accuracy figure for the hero chip. The parent resolves the widest
 * trustworthy window (30-day → all-time → holdout) per the design-language
 * rule: never render a rate from a window with fewer than 10 settled picks.
 */
export interface HeroAccuracy {
  /** 0–100 display percentage. */
  pct: number
  /** Window caption, e.g. "30-day accuracy" / "all-time accuracy" / "holdout accuracy". */
  windowLabel: string
  /** Sample caption, e.g. "214 settled picks" / "11,661-match holdout". */
  detail: string
}

interface HeroSpotlightProps {
  liveCount: number
  upcomingCount: number
  finishedCount: number
  selectedDateLabel: string
  /** Resolved honest accuracy; chip hides while null/undefined. */
  accuracy?: HeroAccuracy | null
}

/**
 * The marquee section above the Match Centre. Renders three blocks:
 *  1) A bold gradient headline + subhead, with the gender toggle inline.
 *  2) A live "stats triplet" (Live / Upcoming / Finished) with animated counters.
 *  3) An AI promo card that nudges visitors toward /predict.
 *
 * Designed to be the first thing a visitor sees: combines Fotmob-grade match
 * density signals with a modern dashboard hero (gradient ambient + glass
 * highlight + bento layout). Honours prefers-reduced-motion via the counter
 * primitive and AnimatePresence-free entry animations.
 */
export function HeroSpotlight({
  liveCount,
  upcomingCount,
  finishedCount,
  selectedDateLabel,
  accuracy,
}: HeroSpotlightProps) {
  const { gender } = useGenderPreference()
  const reduce = useReducedMotion()
  const router = useRouter()

  return (
    <Spotlight
      className="group block"
      size={520}
      color="color-mix(in srgb, var(--accent-ai) 12%, transparent)"
    >
    <section
      aria-label="Pitchwise Match Centre hero"
      className="relative isolate overflow-hidden border-b border-[var(--border-color)]"
    >
      {/* Layered gradient backdrop */}
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0 -z-10 opacity-90',
          gender === 'women'
            ? 'bg-[radial-gradient(60%_55%_at_15%_20%,rgba(236,72,153,0.18),transparent_60%),radial-gradient(45%_45%_at_85%_30%,rgba(139,92,246,0.18),transparent_60%)]'
            : 'bg-[radial-gradient(60%_55%_at_15%_20%,color-mix(in_srgb,var(--accent-primary)_22%,transparent),transparent_60%),radial-gradient(50%_50%_at_88%_25%,color-mix(in_srgb,var(--accent-ai)_24%,transparent),transparent_60%)]'
        )}
      />
      <DotPattern
        className="-z-10 opacity-30 [mask-image:radial-gradient(ellipse_at_top_right,white,transparent_70%)]"
        width={18}
        height={18}
        cr={0.9}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-[var(--accent-ai)]/35 to-transparent"
      />

      <div className="mx-auto flex w-full max-w-[var(--shell-content-max)] flex-col gap-6 px-4 py-8 md:px-8 md:py-10 lg:flex-row lg:items-end lg:justify-between">
        {/* LEFT — eyebrow + headline + subhead + gender toggle */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl space-y-4"
        >
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent-ai)]" aria-hidden="true" />
            <span>
              {gender === 'women' ? "Women's" : "Men's"} football · {selectedDateLabel}
            </span>
          </div>

          <h1 className="font-display text-[clamp(2rem,4.2vw,3.4rem)] font-extrabold leading-[1.04] tracking-tight text-[var(--text-primary)]">
            Live football.{' '}
            <span className="bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-ai)] to-[var(--accent-primary)] bg-clip-text text-transparent">
              Calibrated AI.
            </span>{' '}
            One match centre.
          </h1>

          <p className="max-w-xl text-[15px] leading-relaxed text-[var(--text-secondary)]">
            Every fixture below is scored by our unified prediction model.
            Switch universes for the top women&apos;s competitions — and{' '}
            <Link
              href="/accuracy"
              className="font-semibold text-[var(--accent-primary)] underline-offset-4 hover:underline"
            >
              audit how often we&apos;re right
            </Link>
            .
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <GenderToggle size="hero" />
            <ShimmerButton
              onClick={() => router.push('/predict')}
              background="linear-gradient(135deg, var(--accent-ai), var(--accent-primary))"
              shimmerColor="rgba(255,255,255,0.75)"
              borderRadius="0.75rem"
              className="text-sm shadow-lg shadow-[var(--accent-ai)]/25 transition-transform hover:-translate-y-0.5"
            >
              Run a prediction
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </ShimmerButton>
            <Link
              href="/welcome"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--text-secondary)] underline-offset-4 transition-colors hover:text-[var(--accent-primary)] hover:underline"
            >
              How it works
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </motion.div>

        {/* RIGHT — stats triplet + accuracy chip */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          className="flex w-full max-w-md flex-col gap-3"
        >
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              size="sm"
              accent="loss"
              label="Live now"
              value={
                <span className="inline-flex items-center gap-2">
                  <AnimatedCounter value={liveCount} duration={1.0} />
                  {liveCount > 0 && (
                    <span className="relative inline-flex h-2 w-2" aria-hidden="true">
                      <span className="absolute inset-0 motion-safe:animate-ping rounded-full bg-[var(--accent-loss)] opacity-60" />
                      <span className="relative inline-block h-2 w-2 rounded-full bg-[var(--accent-loss)]" />
                    </span>
                  )}
                </span>
              }
              className="bg-[var(--card-bg)]/70 backdrop-blur-sm"
            />
            <StatCard
              size="sm"
              accent="warn"
              label="Upcoming"
              value={<AnimatedCounter value={upcomingCount} duration={1.0} />}
              className="bg-[var(--card-bg)]/70 backdrop-blur-sm"
            />
            <StatCard
              size="sm"
              accent="primary"
              label="Finished"
              value={<AnimatedCounter value={finishedCount} duration={1.0} />}
              className="bg-[var(--card-bg)]/70 backdrop-blur-sm"
            />
          </div>

          {/* AI accuracy strip — only renders once an honest window resolved */}
          {accuracy && (
            <Link
              href="/accuracy"
              className="gradient-border group flex items-center gap-3 rounded-2xl p-3 transition-transform hover:-translate-y-0.5"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10">
                <Brain className="h-5 w-5 text-[var(--accent-ai)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                  Unified model · {accuracy.windowLabel}
                </p>
                <p className="flex items-baseline gap-1.5 text-[var(--text-primary)]">
                  <NumberTicker
                    value={accuracy.pct}
                    decimalPlaces={0}
                    suffix="%"
                    className="text-h3 font-bold tabular-nums"
                  />
                  <span className="truncate text-xs text-[var(--text-tertiary)]">
                    outcome hit-rate · {accuracy.detail}
                  </span>
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent-ai)]" />
            </Link>
          )}
        </motion.div>
      </div>
    </section>
    </Spotlight>
  )
}

