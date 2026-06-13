'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { CalendarDays, Sparkles } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AnimatedCounter } from '@/components/ui/animated-counter'
import { cn } from '@/lib/utils'
import { springSnappy } from '@/lib/motion'

/**
 * Cinematic "Match Centre" header: a broadcast-style hero strip with an
 * aurora backdrop, animated live/upcoming/finished tiles, and a date-swipe
 * selector whose active pill slides between dates (framer-motion layoutId).
 *
 * Pure presentational component — all state is passed in from the page.
 */

export interface DateOption {
  label: string
  date: string
  isToday: boolean
}

export interface MatchCenterHeaderProps {
  dateOptions: DateOption[]
  selectedDate: string
  onSelectDate: (date: string) => void
  liveCount: number
  upcomingCount: number
  finishedCount: number
  selectedDateLabel: string
  predictHref?: string
  predictGender?: 'M' | 'F'
  modelAccuracy?: number | null
}

function CountTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'live' | 'upcoming' | 'finished'
}) {
  const styles: Record<typeof tone, string> = {
    live: 'border-[var(--accent-loss)]/40 bg-[var(--accent-loss)]/10 text-[var(--accent-loss)]',
    upcoming: 'border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]',
    finished: 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]',
  }
  return (
    <div
      className={cn(
        'relative min-w-[84px] overflow-hidden rounded-xl border px-3 py-2 text-center backdrop-blur-sm',
        styles[tone]
      )}
    >
      <div className="flex items-center justify-center gap-1.5 text-xl font-black tabular-nums leading-none">
        {tone === 'live' && value > 0 && <span className="live-dot" aria-hidden />}
        <AnimatedCounter value={value} duration={0.9} />
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider opacity-90">{label}</div>
    </div>
  )
}

export function MatchCenterHeader({
  dateOptions,
  selectedDate,
  onSelectDate,
  liveCount,
  upcomingCount,
  finishedCount,
  selectedDateLabel,
  predictHref = '/predict',
  predictGender = 'M',
  modelAccuracy,
}: MatchCenterHeaderProps) {
  const reduce = useReducedMotion()
  const predictUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (predictGender) params.set('gender', predictGender)
    return params.toString() ? `${predictHref}?${params.toString()}` : predictHref
  }, [predictHref, predictGender])

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto w-full max-w-5xl px-4 pt-4"
    >
      <Card variant="elevated" className="relative overflow-hidden p-4 md:p-5">
        {/* aurora glow behind the header */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{
            background:
              'radial-gradient(55% 80% at 0% 0%, color-mix(in srgb, var(--accent-primary) 16%, transparent), transparent 60%), radial-gradient(50% 80% at 100% 0%, color-mix(in srgb, var(--accent-ai) 16%, transparent), transparent 60%)',
          }}
        />
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              <CalendarDays className="h-3 w-3" strokeWidth={2.5} />
              Match Centre
            </div>
            <h1 className="text-h2 font-black tracking-tight text-[var(--text-primary)]">
              {selectedDateLabel}{' '}
              <span className="bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-ai)] bg-clip-text text-transparent">
                fixtures
              </span>
            </h1>
            <p className="mt-1 max-w-md text-small text-[var(--text-tertiary)]">
              Live scores from every major league plus AI-driven outcome and scoreline picks for every fixture.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button asChild variant="ai" size="sm" className="gap-1.5">
                <Link href={predictUrl} prefetch={false}>
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                  AI predict a fixture
                </Link>
              </Button>
              {typeof modelAccuracy === 'number' && (
                <Badge variant="outline" className="border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]">
                  Recent accuracy {Math.round(modelAccuracy * 100)}%
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <CountTile label="Live" value={liveCount} tone="live" />
            <CountTile label="Upcoming" value={upcomingCount} tone="upcoming" />
            <CountTile label="Finished" value={finishedCount} tone="finished" />
          </div>
        </div>

        {/* Date-swipe selector with a sliding active pill */}
        <div
          className="mt-4 -mx-1 flex items-center gap-1 overflow-x-auto px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:none]"
          role="tablist"
          aria-label="Select date"
        >
          {dateOptions.map((opt) => {
            const active = opt.date === selectedDate
            return (
              <button
                key={opt.date}
                role="tab"
                aria-selected={active}
                onClick={() => onSelectDate(opt.date)}
                className={cn(
                  'relative shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors',
                  active
                    ? 'text-[var(--accent-on-primary,_#04120a)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]'
                )}
              >
                {active && (
                  <motion.span
                    layoutId="date-active-pill"
                    transition={springSnappy}
                    className="absolute inset-0 -z-0 rounded-lg bg-gradient-to-br from-[var(--accent-primary-soft)] to-[var(--accent-primary)] shadow-[0_6px_18px_-8px_color-mix(in_srgb,var(--accent-primary)_90%,transparent)]"
                  />
                )}
                <span className="relative z-10">{opt.label}</span>
              </button>
            )
          })}
        </div>
      </Card>
    </motion.div>
  )
}
