'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Brain, Radio, Sparkles } from 'lucide-react'

import { AnimatedCounter } from '@/components/ui/animated-counter'
import { GenderToggle } from '@/components/GenderToggle'
import { useGenderPreference } from '@/hooks/useGenderPreference'
import { cn } from '@/lib/utils'

interface HeroSpotlightProps {
  liveCount: number
  upcomingCount: number
  finishedCount: number
  selectedDateLabel: string
  /** Headline accuracy figure (0–100). Pulled from /api/v1/tracking/accuracy by parent. */
  modelAccuracyPct?: number
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
  modelAccuracyPct,
}: HeroSpotlightProps) {
  const { gender } = useGenderPreference()
  const reduce = useReducedMotion()

  return (
    <section
      aria-label="FotPredict AI Match Centre hero"
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
            <Link
              href="/predict"
              className="group inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-[var(--accent-ai)] to-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-[var(--accent-on-primary)] shadow-lg shadow-[var(--accent-ai)]/25 transition-transform hover:-translate-y-0.5"
            >
              Run a prediction
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
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
            <KpiTile
              accent="loss"
              label="Live now"
              value={liveCount}
              live
            />
            <KpiTile
              accent="ai"
              label="Upcoming"
              value={upcomingCount}
            />
            <KpiTile
              accent="muted"
              label="Finished"
              value={finishedCount}
            />
          </div>

          {/* AI accuracy strip */}
          <Link
            href="/accuracy"
            className="gradient-border group flex items-center gap-3 rounded-2xl p-3 transition-transform hover:-translate-y-0.5"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10">
              <Brain className="h-5 w-5 text-[var(--accent-ai)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Unified model · 30-day accuracy
              </p>
              <p className="flex items-baseline gap-1.5 text-[var(--text-primary)]">
                <AnimatedCounter
                  value={modelAccuracyPct ?? 0}
                  digits={1}
                  suffix="%"
                  className="text-h3 font-bold tabular-nums"
                />
                <span className="text-xs text-[var(--text-tertiary)]">
                  outcome hit-rate
                </span>
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent-ai)]" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}

function KpiTile({
  accent,
  label,
  value,
  live,
}: {
  accent: 'loss' | 'ai' | 'muted'
  label: string
  value: number
  live?: boolean
}) {
  const ringClass =
    accent === 'loss'
      ? 'border-[var(--accent-loss)]/30'
      : accent === 'ai'
        ? 'border-[var(--accent-ai)]/30'
        : 'border-[var(--border-color)]'
  const numberClass =
    accent === 'loss'
      ? 'text-[var(--accent-loss)]'
      : accent === 'ai'
        ? 'text-[var(--accent-ai)]'
        : 'text-[var(--text-primary)]'

  return (
    <div
      className={cn(
        'relative flex flex-col gap-1 rounded-xl border bg-[var(--card-bg)]/70 px-3 py-3 text-left shadow-sm backdrop-blur-sm',
        ringClass
      )}
    >
      <div className="flex items-center gap-1.5">
        {live && value > 0 && (
          <span className="relative inline-flex h-2 w-2 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-60" />
            <span className="relative inline-block h-2 w-2 rounded-full bg-[var(--accent-loss)]" />
          </span>
        )}
        {!live && accent === 'ai' && (
          <Radio className="h-2.5 w-2.5 text-[var(--accent-ai)]" aria-hidden="true" />
        )}
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          {label}
        </p>
      </div>
      <p className={cn('text-h2 font-extrabold leading-none tabular-nums', numberClass)}>
        <AnimatedCounter value={value} duration={1.0} />
      </p>
    </div>
  )
}
