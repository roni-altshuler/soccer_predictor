'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { Brain, ShieldCheck, Sparkles } from 'lucide-react'

import { GenderToggle } from '@/components/GenderToggle'
import { useGenderPreference } from '@/hooks/useGenderPreference'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Hero header for the /predict page. Sits above the team selector and
 * mirrors the gradient/glass language of the home HeroSpotlight and
 * accuracy AccuracyHero so the three "headline" pages feel like one
 * product.
 */
export function PredictHero() {
  const reduce = useReducedMotion()
  const { gender } = useGenderPreference()

  return (
    <section
      aria-label="AI prediction tool"
      className="relative isolate overflow-hidden rounded-3xl border border-[var(--border-color)]"
    >
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0 -z-10',
          gender === 'women'
            ? 'bg-[radial-gradient(60%_55%_at_15%_20%,rgba(236,72,153,0.22),transparent_60%),radial-gradient(50%_50%_at_88%_25%,rgba(139,92,246,0.22),transparent_60%)]'
            : 'bg-[radial-gradient(60%_55%_at_15%_20%,color-mix(in_srgb,var(--accent-ai)_26%,transparent),transparent_60%),radial-gradient(50%_50%_at_88%_25%,color-mix(in_srgb,var(--accent-primary)_24%,transparent),transparent_60%)]'
        )}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-ai)]/40 to-transparent"
      />

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 flex flex-col gap-5 p-6 md:p-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Badge
            variant="outline"
            className="border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]"
          >
            <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
            Unified multi-task model
          </Badge>
          <GenderToggle size="default" />
        </div>

        <h1 className="font-display text-[clamp(1.8rem,3.8vw,2.8rem)] font-extrabold leading-[1.05] tracking-tight text-[var(--text-primary)]">
          Predict any matchup.{' '}
          <span className="bg-gradient-to-r from-[var(--accent-ai)] via-[var(--accent-primary)] to-[var(--accent-ai)] bg-clip-text text-transparent">
            See the model&apos;s reasoning.
          </span>
        </h1>

        <p className="max-w-2xl text-[15px] leading-relaxed text-[var(--text-secondary)]">
          Pick two teams from anywhere in the {gender === 'women' ? 'women\'s' : 'men\'s'} universe — including cross-league pairings — and the
          model returns calibrated W/D/L probabilities, an xG breakdown, a scoreline
          distribution, and the factors it weighed most heavily.
        </p>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
          <span className="flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5 text-[var(--accent-ai)]" aria-hidden="true" />
            80 contextual features
          </span>
          <span className="h-1 w-1 rounded-full bg-[var(--border-color)]" aria-hidden="true" />
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
            Isotonic-calibrated
          </span>
          <span className="h-1 w-1 rounded-full bg-[var(--border-color)]" aria-hidden="true" />
          <span>Bivariate-Poisson xG head</span>
        </div>
      </motion.div>
    </section>
  )
}
