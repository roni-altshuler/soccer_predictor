'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { CalendarDays, Sparkles } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * FotMob-style "Match Centre" header: hero strip + date selector.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  🟢 LIVE NOW (3)                              Refresh seconds 14 │
 *   │  Match Centre                                                    │
 *   │  Today's Premier League, La Liga, Serie A …                       │
 *   │  [Yesterday] [Today] [Tomorrow] [Thu Aug 23] [Fri 24] …          │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Pure presentational component. All state (selected date, counts, etc.)
 * is passed in from the page.
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
  /** Optional: deep-link the AI prediction CTA. */
  predictHref?: string
  predictGender?: 'M' | 'F'
  modelAccuracy?: number | null
}

function CountChip({
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
        'min-w-[88px] rounded-lg border px-3 py-2 text-center',
        styles[tone]
      )}
    >
      <div className="text-xl font-black tabular-nums leading-none">{value}</div>
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
  const predictUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (predictGender) params.set('gender', predictGender)
    return params.toString() ? `${predictHref}?${params.toString()}` : predictHref
  }, [predictHref, predictGender])

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto w-full max-w-5xl px-4 pt-4"
    >
      <Card className="overflow-hidden border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              <CalendarDays className="h-3 w-3" strokeWidth={2.5} />
              Match Centre
            </div>
            <h1 className="text-h2 font-black text-[var(--text-primary)]">
              {selectedDateLabel} fixtures
            </h1>
            <p className="mt-1 max-w-md text-small text-[var(--text-tertiary)]">
              Live scores from every major league plus AI-driven outcome and scoreline picks for every fixture.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button asChild size="sm" className="gap-1.5">
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
            <CountChip label="Live" value={liveCount} tone="live" />
            <CountChip label="Upcoming" value={upcomingCount} tone="upcoming" />
            <CountChip label="Finished" value={finishedCount} tone="finished" />
          </div>
        </div>

        <div className="mt-4 -mx-1 flex items-center gap-1 overflow-x-auto px-1 py-1 [-ms-overflow-style:none] [scrollbar-width:none]">
          {dateOptions.map((opt) => {
            const active = opt.date === selectedDate
            return (
              <button
                key={opt.date}
                onClick={() => onSelectDate(opt.date)}
                className={cn(
                  'shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                  active
                    ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-on-primary,_#04120a)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]'
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </Card>
    </motion.div>
  )
}
