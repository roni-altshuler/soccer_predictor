'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { Brain, CalendarDays, Sparkles } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { springSnappy } from '@/lib/motion'

/**
 * "Match Centre" header: a broadcast-style strip with an aurora backdrop
 * and a date-swipe selector whose active pill slides between dates
 * (framer-motion layoutId). The live/upcoming/finished counts live in the
 * page hero — the single source of truth — so this header intentionally
 * does NOT repeat them.
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
  selectedDateLabel: string
  predictHref?: string
  predictGender?: 'M' | 'F'
  modelAccuracy?: number | null
  /** Count of the day's fixtures carrying a committed model prediction. */
  aiPicksCount?: number
}

export function MatchCenterHeader({
  dateOptions,
  selectedDate,
  onSelectDate,
  selectedDateLabel,
  predictHref = '/predict',
  predictGender = 'M',
  modelAccuracy,
  aiPicksCount,
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
            <h2 className="text-h2 font-black tracking-tight text-[var(--text-primary)]">
              {selectedDateLabel}{' '}
              <span className="bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-ai)] bg-clip-text text-transparent">
                fixtures
              </span>
            </h2>
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
              {typeof aiPicksCount === 'number' && aiPicksCount > 0 && (
                <Badge variant="outline" className="gap-1 border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]">
                  <Brain className="h-3 w-3" strokeWidth={2.5} />
                  {aiPicksCount} committed {aiPicksCount === 1 ? 'pick' : 'picks'}
                </Badge>
              )}
            </div>
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
                  'relative inline-flex min-h-[40px] shrink-0 items-center rounded-lg px-4 text-xs font-semibold transition-colors',
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
