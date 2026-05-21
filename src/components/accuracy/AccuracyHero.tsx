'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

import { GenderToggle } from '@/components/GenderToggle'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Big "Our AI gets it right 60.56% of the time" hero for the public
 * accuracy page. Pure presentational — accepts the live numbers from
 * the parent so it works for both the men's and women's universe via
 * the prominent gender toggle anchored top-right.
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

function AnimatedPercent({ value }: { value: number }) {
  const [shown, setShown] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const target = Math.round(value * 1000) / 10
    let frame = 0
    const max = 30
    const start = performance.now()
    const tick = () => {
      const now = performance.now()
      const t = Math.min(1, (now - start) / 700)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(target * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [value])

  return (
    <span ref={ref} className="tabular-nums">
      {shown.toFixed(1)}%
    </span>
  )
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
  const universeLabel = gender === 'women' ? "women's universe" : "men's universe"

  return (
    <Card
      className={cn(
        'relative overflow-hidden border-[var(--accent-ai)]/25 bg-gradient-to-br',
        gender === 'women'
          ? 'from-pink-500/10 via-[var(--card-bg)] to-violet-500/10'
          : 'from-[var(--accent-ai)]/10 via-[var(--card-bg)] to-[var(--accent-primary)]/10',
        'p-6 md:p-8',
        className
      )}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Badge
              variant="outline"
              className="border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]"
            >
              How accurate is our AI?
            </Badge>
            <p className="text-sm text-[var(--text-tertiary)]">
              Live audit of every prediction the unified multi-task model has made.
            </p>
          </div>
          <GenderToggle size="default" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-2"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Outcome accuracy ({universeLabel})
          </p>
          {completedPredictions === 0 ? (
            <>
              <h1 className="text-display font-black leading-none text-[var(--text-primary)]">
                Collecting…
              </h1>
              <p className="max-w-2xl text-small text-[var(--text-secondary)]">
                {totalPredictions > 0 ? (
                  <>
                    <span className="font-semibold text-[var(--text-primary)] tabular-nums">
                      {totalPredictions.toLocaleString()}
                    </span>{' '}
                    prediction{totalPredictions === 1 ? '' : 's'} tracked — none with a final result yet.
                    The accuracy number appears here once the outcome fetcher settles its first match.
                  </>
                ) : (
                  <>
                    The unified {universeLabel} model hasn&apos;t made any predictions yet.
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-display font-black leading-none text-[var(--text-primary)]">
                <AnimatedPercent value={accuracyPct} />
              </h1>
              <p className="max-w-2xl text-small text-[var(--text-secondary)]">
                Across <span className="font-semibold text-[var(--text-primary)] tabular-nums">{completedPredictions.toLocaleString()}</span>{' '}
                completed predictions of the{' '}
                <span className="font-semibold text-[var(--text-primary)] tabular-nums">{totalPredictions.toLocaleString()}</span>{' '}
                we&apos;ve tracked. Last 50 picks running at{' '}
                <span className="font-semibold text-[var(--accent-primary)] tabular-nums">{(recentAccuracy * 100).toFixed(1)}%</span>.
              </p>
            </>
          )}
        </motion.div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Brier score" value={brierScore.toFixed(3)} hint="Lower = better calibrated. Random guessing ≈ 0.66." />
          <Stat label="Recent (last 50)" value={`${(recentAccuracy * 100).toFixed(1)}%`} hint="How the model is doing right now." />
          <Stat label="Completed" value={completedPredictions.toLocaleString()} hint="Predictions whose result is in." />
          <Stat label="Pending" value={(totalPredictions - completedPredictions).toLocaleString()} hint="Picks waiting on a final whistle." />
        </div>
      </div>
    </Card>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div
      className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)]/60 p-3"
      title={hint}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-[var(--text-primary)]">{value}</p>
    </div>
  )
}
