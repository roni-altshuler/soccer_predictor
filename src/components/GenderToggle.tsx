'use client'

import { motion } from 'framer-motion'
import { useId } from 'react'

import { useGenderPreference, type GenderPreference } from '@/hooks/useGenderPreference'
import { cn } from '@/lib/utils'

/** Inline gender symbols — lucide-react v0.469 doesn't ship Mars/Venus glyphs. */
function MenSymbol({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="10" cy="14" r="5" />
      <path d="m15 9 5-5" />
      <path d="M15 4h5v5" />
    </svg>
  )
}
function WomenSymbol({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="9" r="5" />
      <path d="M12 14v8" />
      <path d="M9 19h6" />
    </svg>
  )
}

/**
 * Prominent segmented control for switching between men's and women's
 * football. Designed to be the most discoverable gender control on every
 * page that supports the toggle — never collapsed by default, with a
 * sliding pill background so the active state is obvious at a glance.
 *
 * Three sizes:
 *   - `hero`  big hero placement (home + accuracy pages)
 *   - `default`  standard inline placement (page headers, navbars)
 *   - `compact`  fallback for tight spaces (mobile top bar)
 */

export type GenderToggleSize = 'compact' | 'default' | 'hero'

interface GenderToggleProps {
  className?: string
  size?: GenderToggleSize
  /** Render the label without icons when space is at a premium. */
  iconless?: boolean
  /** Optional callback after a selection. The hook already persists. */
  onChange?: (value: GenderPreference) => void
}

const OPTIONS: { value: GenderPreference; label: string; short: string }[] = [
  { value: 'men', label: "Men's", short: 'M' },
  { value: 'women', label: "Women's", short: 'W' },
]

const sizeStyles: Record<GenderToggleSize, { container: string; button: string; pill: string; icon: string }> = {
  compact: {
    container: 'p-0.5 rounded-md',
    button: 'px-2 py-1 text-[10px]',
    pill: 'rounded',
    icon: 'h-3 w-3',
  },
  default: {
    container: 'p-1 rounded-lg',
    button: 'px-3 py-1.5 text-xs',
    pill: 'rounded-md',
    icon: 'h-3.5 w-3.5',
  },
  hero: {
    container: 'p-1 rounded-xl',
    button: 'px-4 py-2 text-sm',
    pill: 'rounded-lg',
    icon: 'h-4 w-4',
  },
}

export function GenderToggle({
  className,
  size = 'default',
  iconless = false,
  onChange,
}: GenderToggleProps) {
  const { gender, setGender } = useGenderPreference()
  const styles = sizeStyles[size]
  // Unique per instance — multiple toggles can be mounted at once (e.g. the
  // mobile + desktop topbar variants) and must not share a layout animation.
  const pillLayoutId = useId()

  const handleSelect = (value: GenderPreference) => {
    setGender(value)
    onChange?.(value)
  }

  return (
    <div
      role="group"
      aria-label="Football competition gender"
      className={cn(
        'relative inline-flex items-center border border-[var(--border-color)]',
        'bg-[var(--card-bg)] shadow-sm',
        styles.container,
        className
      )}
    >
      {OPTIONS.map((opt) => {
        const active = gender === opt.value
        const Icon = opt.value === 'men' ? MenSymbol : WomenSymbol
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleSelect(opt.value)}
            aria-pressed={active}
            aria-label={`${opt.label} football`}
            className={cn(
              'relative inline-flex items-center justify-center gap-1.5 font-semibold transition-colors',
              styles.button,
              active
                ? opt.value === 'women'
                  ? 'text-[var(--accent-women)]'
                  : 'text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
          >
            {active && (
              <motion.span
                layoutId={pillLayoutId}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                className={cn(
                  // Flat segmented-control fill (Matchday v3): a quiet
                  // surface step, never a gradient. Women's keeps its pink
                  // brand signal via the label colour above.
                  'absolute inset-0 -z-[1] bg-[var(--card-hover)] ring-1 ring-[var(--border-color)]',
                  styles.pill
                )}
              />
            )}
            {!iconless && (
              <Icon className={cn(styles.icon, 'shrink-0', active ? 'relative z-[1]' : '')} />
            )}
            <span className={cn('whitespace-nowrap', active && 'relative z-[1]')}>
              {size === 'compact' ? opt.short : opt.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
