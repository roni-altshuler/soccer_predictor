'use client'

import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { ArrowRight, Sparkles, TrendingUp } from 'lucide-react'

import { DotPattern } from '@/components/magicui/dot-pattern'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { FlagBadge } from '@/components/primitives'
import { cn } from '@/lib/utils'
import { CtaButton } from './primitives/CtaButton'

/** Static, lightweight demo numbers for the hero centerpiece card. The real,
 *  live prediction is rendered further down the page in <PredictionDemo>.
 *  Crest URLs are ESPN's canonical club logos (rule 2: real identities). */
const HERO_MATCH = {
  league: 'Premier League',
  home: 'Arsenal',
  homeCrest: 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png',
  away: 'Chelsea',
  awayCrest: 'https://a.espncdn.com/i/teamlogos/soccer/500/363.png',
  homeWin: 0.54,
  draw: 0.26,
  awayWin: 0.2,
  xg: { home: 1.9, away: 1.1 },
  score: '2–1',
  confidence: 0.61,
}

function ProbabilityBar({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: string
}) {
  const reduce = useReducedMotion()
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-xs font-semibold text-[var(--text-tertiary)]">{label}</span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: accent }}
          initial={{ width: 0 }}
          whileInView={{ width: `${value * 100}%` }}
          viewport={{ once: true }}
          transition={reduce ? { duration: 0 } : { duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
        />
      </div>
      <span className="w-11 shrink-0 text-right font-numeric text-xs font-bold tabular-nums text-[var(--text-primary)]">
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

export function MarketingHero() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  })
  // Subtle parallax: the backdrop drifts up and fades as the hero scrolls away.
  // `reduce` is folded into the output range (not the `style` prop) so the
  // initial render is identical server/client — at scroll progress 0 both map
  // to '0%' / opacity 1, avoiding a hydration mismatch. Under reduced-motion
  // the values stay constant, so there's no parallax.
  const bgY = useTransform(scrollYProgress, [0, 1], ['0%', reduce ? '0%' : '24%'])
  const bgOpacity = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 0.2])

  return (
    <section
      ref={ref}
      aria-labelledby="hero-heading"
      className="relative isolate overflow-hidden px-5 pb-20 pt-28 sm:px-8 md:pb-28 md:pt-36"
    >
      {/* Ambient backdrop */}
      <motion.div
        aria-hidden="true"
        style={{ y: bgY, opacity: bgOpacity }}
        className="absolute inset-0 -z-10"
      >
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_0%,color-mix(in_srgb,var(--accent-primary)_20%,transparent),transparent_60%),radial-gradient(55%_45%_at_85%_10%,color-mix(in_srgb,var(--accent-ai)_18%,transparent),transparent_60%)]" />
        <DotPattern
          width={26}
          height={26}
          className="[mask-image:radial-gradient(70%_60%_at_50%_30%,white,transparent)] text-[var(--accent-ai)]/30"
        />
      </motion.div>

      <div className="mx-auto grid w-full max-w-[var(--shell-content-max)] items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Copy column */}
        <div className="flex flex-col items-start gap-6">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-primary)]"
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Calibrated football intelligence
          </motion.span>

          <motion.h1
            id="hero-heading"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.6, delay: 0.05 }}
            className="font-display text-[clamp(2.4rem,6vw,4.25rem)] font-extrabold leading-[1.02] tracking-tight text-[var(--text-primary)]"
          >
            Football predictions
            <br className="hidden sm:block" /> you can{' '}
            <span className="mkt-headline-gradient">actually verify</span>.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.6, delay: 0.12 }}
            className="max-w-xl text-pretty text-base leading-relaxed text-[var(--text-secondary)] md:text-lg"
          >
            Pitchverse pairs live scores with AI predictions that publish their confidence,
            log every pick, and answer to real outcomes — updated through the day, for the men&apos;s
            and women&apos;s game alike.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.6, delay: 0.18 }}
            className="flex flex-wrap items-center gap-3"
          >
            <CtaButton href="/" variant="primary" size="lg">
              Open Match Centre
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </CtaButton>
            <CtaButton href="#how-it-works" variant="secondary" size="lg">
              See how it works
            </CtaButton>
          </motion.div>

          {/* Proof stats */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={reduce ? { duration: 0 } : { duration: 0.6, delay: 0.28 }}
            className="mt-2 grid w-full max-w-lg grid-cols-3 gap-4 border-t border-[var(--border-color)] pt-6"
          >
            {[
              { value: 60.5, suffix: '%', dp: 1, label: "Men's accuracy", sub: 'across 11,661 scored matches' },
              { value: 77735, suffix: '+', dp: 0, label: 'Matches analysed', sub: 'men + women' },
              { value: 3, suffix: '×', dp: 0, label: 'Daily refreshes', sub: 'picks stay current' },
            ].map((s) => (
              <div key={s.label}>
                <p className="font-numeric text-2xl font-extrabold tabular-nums text-[var(--text-primary)] md:text-3xl">
                  <NumberTicker value={s.value} decimalPlaces={s.dp} suffix={s.suffix} />
                </p>
                <p className="mt-1 text-xs font-semibold text-[var(--text-secondary)]">{s.label}</p>
                <p className="text-[11px] text-[var(--text-tertiary)]">{s.sub}</p>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Visual centerpiece — stylized prediction card */}
        <motion.div
          initial={{ opacity: 0, y: 28, rotateX: 6 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto w-full max-w-md"
          style={{ perspective: 1200 }}
        >
          <div className="relative overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6 shadow-[var(--shadow-lg)]">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-ai)] to-transparent"
            />
            {/* Card header */}
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-ai)]/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-ai)]">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                AI prediction
              </span>
              <span className="text-[11px] font-medium text-[var(--text-tertiary)]">{HERO_MATCH.league}</span>
            </div>

            {/* Teams */}
            <div className="mt-5 flex items-center justify-between">
              <div className="flex flex-col items-center gap-2">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--muted-bg)]">
                  <FlagBadge teamName={HERO_MATCH.home} logoUrl={HERO_MATCH.homeCrest} size={34} />
                </span>
                <span className="text-xs font-semibold text-[var(--text-primary)]">{HERO_MATCH.home}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="font-numeric text-3xl font-extrabold tabular-nums text-[var(--text-primary)]">
                  {HERO_MATCH.score}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">most likely</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--muted-bg)]">
                  <FlagBadge teamName={HERO_MATCH.away} logoUrl={HERO_MATCH.awayCrest} size={34} />
                </span>
                <span className="text-xs font-semibold text-[var(--text-primary)]">{HERO_MATCH.away}</span>
              </div>
            </div>

            {/* Probability bars */}
            <div className="mt-6 space-y-2.5">
              <ProbabilityBar label="Home" value={HERO_MATCH.homeWin} accent="var(--accent-primary)" />
              <ProbabilityBar label="Draw" value={HERO_MATCH.draw} accent="var(--accent-warn)" />
              <ProbabilityBar label="Away" value={HERO_MATCH.awayWin} accent="var(--accent-loss)" />
            </div>

            {/* Footer metrics */}
            <div className="mt-6 grid grid-cols-3 gap-2 border-t border-[var(--border-color)] pt-4 text-center">
              <div>
                <p className="font-numeric text-sm font-bold text-[var(--text-primary)]">{HERO_MATCH.xg.home}</p>
                <p className="text-[10px] text-[var(--text-tertiary)]">Home xG</p>
              </div>
              <div>
                <p className="font-numeric text-sm font-bold text-[var(--text-primary)]">{HERO_MATCH.xg.away}</p>
                <p className="text-[10px] text-[var(--text-tertiary)]">Away xG</p>
              </div>
              <div>
                <p className="inline-flex items-center justify-center gap-1 font-numeric text-sm font-bold text-[var(--accent-primary)]">
                  <TrendingUp className="h-3 w-3" aria-hidden="true" />
                  {Math.round(HERO_MATCH.confidence * 100)}%
                </p>
                <p className="text-[10px] text-[var(--text-tertiary)]">Confidence</p>
              </div>
            </div>
          </div>

          {/* Floating accent chip */}
          <div
            className={cn(
              'absolute -bottom-4 -left-4 hidden items-center gap-2 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 shadow-[var(--shadow-md)] sm:flex',
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="leading-tight">
              <p className="text-[11px] font-bold text-[var(--text-primary)]">Calibrated</p>
              <p className="text-[10px] text-[var(--text-tertiary)]">60% → wins ~60%</p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
