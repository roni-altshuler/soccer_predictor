'use client'

import { motion, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/utils'
import { springSnappy } from '@/lib/motion'

/**
 * Sticky date strip — FotMob tab grammar: compact day buttons with a green
 * underline bar on the active day. Sits directly under the topbar on scores
 * surfaces; the strip itself is the page header (no hero above it).
 */

export interface DateOption {
  label: string
  date: string
  isToday: boolean
}

export interface DateStripProps {
  dateOptions: DateOption[]
  selectedDate: string
  onSelectDate: (date: string) => void
  className?: string
}

export function DateStrip({ dateOptions, selectedDate, onSelectDate, className }: DateStripProps) {
  const reduceMotion = useReducedMotion()
  return (
    <div
      className={cn(
        'sticky top-[var(--shell-topbar-h)] z-20 border-b border-[var(--nav-border)] bg-[var(--nav-bg)] backdrop-blur-md',
        className
      )}
    >
      <div
        className="mx-auto flex w-full max-w-5xl items-stretch overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Select date"
      >
        {dateOptions.map((opt) => {
          const active = opt.date === selectedDate
          return (
            <button
              key={opt.date}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectDate(opt.date)}
              className={cn(
                'relative flex min-h-[44px] flex-1 items-center justify-center whitespace-nowrap px-3 text-xs font-semibold transition-colors',
                active
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              {opt.label}
              {active && (
                <motion.span
                  {...(reduceMotion ? {} : { layoutId: 'datestrip-active', transition: springSnappy })}
                  className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-[var(--accent-primary)]"
                  aria-hidden
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
