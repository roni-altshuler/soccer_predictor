'use client'

import Link from 'next/link'
import { Activity, Brain, Flame, Sparkles, Trophy } from 'lucide-react'

import { BentoCard, BentoGrid } from '@/components/magicui/bento-grid'
import { BorderBeam } from '@/components/magicui/border-beam'
import { GridPattern } from '@/components/magicui/grid-pattern'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { cn } from '@/lib/utils'

interface HomeBentoStripProps {
  liveCount: number
  todayPredictionsCount: number
  topLeagueLabel?: string
  topLeagueAccuracyPct?: number
  modelVersion?: string
  className?: string
}

/**
 * 4-cell bento mosaic that sits above the Match Centre table. Pulls
 * already-fetched parent state (live, predictions, top-league accuracy,
 * model version) and surfaces them as scannable signals before the user
 * scrolls into the league sections.
 */
export function HomeBentoStrip({
  liveCount,
  todayPredictionsCount,
  topLeagueLabel,
  topLeagueAccuracyPct,
  modelVersion,
  className,
}: HomeBentoStripProps) {
  return (
    <BentoGrid className={cn('auto-rows-[10rem] gap-3', className)}>
      {/* Live now — featured, with BorderBeam */}
      <BentoCard className="col-span-3 md:col-span-2 lg:col-span-2">
        <div className="relative z-10 flex h-full flex-col justify-between p-5">
          <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            <Activity className="h-3.5 w-3.5 text-[var(--accent-loss)]" aria-hidden />
            Live right now
          </div>
          <div className="flex items-baseline gap-3">
            <NumberTicker
              value={liveCount}
              className="text-display font-extrabold text-[var(--text-primary)]"
            />
            <span className="text-small text-[var(--text-tertiary)]">matches in play</span>
          </div>
          <Link
            href="/"
            className="self-start text-caption font-mono uppercase tracking-[0.18em] text-[var(--accent-primary)] underline-offset-4 hover:underline"
          >
            Jump to live →
          </Link>
        </div>
        {liveCount > 0 ? (
          <BorderBeam size={1} duration={9} borderRadius={8} colorFrom="var(--accent-loss)" colorTo="var(--accent-primary)" />
        ) : null}
      </BentoCard>

      {/* Today's predictions */}
      <BentoCard className="col-span-3 md:col-span-1 lg:col-span-1">
        <div className="relative z-10 flex h-full flex-col justify-between p-5">
          <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            <Brain className="h-3.5 w-3.5 text-[var(--accent-ai)]" aria-hidden />
            Today
          </div>
          <NumberTicker
            value={todayPredictionsCount}
            className="text-h1 font-extrabold text-[var(--accent-ai)]"
          />
          <p className="text-caption text-[var(--text-tertiary)]">AI picks generated</p>
        </div>
      </BentoCard>

      {/* Top accuracy league */}
      <BentoCard className="col-span-3 md:col-span-2 lg:col-span-2">
        <GridPattern
          width={28}
          height={28}
          className="-z-0 opacity-60 [mask-image:linear-gradient(to_bottom,white,transparent_80%)]"
        />
        <div className="relative z-10 flex h-full flex-col justify-between p-5">
          <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            <Trophy className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden />
            Highest-accuracy league · 30d
          </div>
          <div>
            <p className="text-h3 font-bold text-[var(--text-primary)]">
              {topLeagueLabel ?? '—'}
            </p>
            <p className="mt-1 flex items-baseline gap-1.5 text-[var(--text-secondary)]">
              <NumberTicker
                value={topLeagueAccuracyPct ?? 0}
                decimalPlaces={1}
                suffix="%"
                className="text-h4 font-semibold text-[var(--accent-primary)] tabular-nums"
              />
              <span className="text-small">outcome hit-rate</span>
            </p>
          </div>
          <Link
            href="/accuracy"
            className="self-start text-caption font-mono uppercase tracking-[0.18em] text-[var(--accent-primary)] underline-offset-4 hover:underline"
          >
            See calibration →
          </Link>
        </div>
      </BentoCard>

      {/* Model version */}
      <BentoCard className="col-span-3 md:col-span-1 lg:col-span-1">
        <div className="relative z-10 flex h-full flex-col justify-between p-5">
          <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent-ai)]" aria-hidden />
            Model
          </div>
          <p className="text-h3 font-bold text-[var(--text-primary)]">
            {modelVersion ?? 'unified v2'}
          </p>
          <p className="text-caption text-[var(--text-tertiary)]">
            <Flame className="mr-1 inline h-3 w-3 text-[var(--accent-warn)]" />
            online learning enabled
          </p>
        </div>
      </BentoCard>
    </BentoGrid>
  )
}
