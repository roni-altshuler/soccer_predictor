'use client'

import { useEffect, useState } from 'react'

import {
  AMBIENT_DEFAULT,
  AMBIENT_EVENT,
  AMBIENT_MODES,
  isAmbientMode,
  readAmbient,
  writeAmbient,
  type AmbientMode,
} from '@/lib/ambient'
import { cn } from '@/lib/utils'

/**
 * Pitch · soft / vivid / off — the reader's control over the ambient layer.
 *
 * Three segmented buttons in the mono caption type, `aria-pressed` on the
 * current one. It renders in the sidebar's bottom block on desktop and in the
 * topbar on mobile; both instances stay in step through the `ambientchange`
 * event, and the first paint already carries the stored choice because the
 * root layout applies it before hydration.
 */
export function AmbientToggle({
  label = 'Pitch',
  compact = false,
  className,
}: {
  /** Product word for the layer — "Pitch" here, "Court"/"Board" in siblings. */
  label?: string
  /** Topbar density: label for assistive tech only, 44px tap targets. */
  compact?: boolean
  className?: string
}) {
  // SSR renders the default; the real value is read once mounted, so the
  // markup matches on hydration and the buttons then reflect the attribute
  // the pre-paint script already set.
  const [mode, setMode] = useState<AmbientMode>(AMBIENT_DEFAULT)

  useEffect(() => {
    setMode(readAmbient())
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<unknown>).detail
      if (isAmbientMode(next)) setMode(next)
    }
    window.addEventListener(AMBIENT_EVENT, onChange)
    return () => window.removeEventListener(AMBIENT_EVENT, onChange)
  }, [])

  return (
    <div
      role="group"
      aria-label={`${label} backdrop`}
      className={cn('flex items-center gap-2', className)}
    >
      <span
        className={cn(
          'font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]',
          compact && 'sr-only',
        )}
      >
        {label}
      </span>
      <div className="flex overflow-hidden rounded-md border border-[var(--border-color)]">
        {AMBIENT_MODES.map((m, i) => {
          const active = mode === m
          return (
            <button
              key={m}
              type="button"
              aria-pressed={active}
              onClick={() => {
                writeAmbient(m)
                setMode(m)
              }}
              className={cn(
                'font-mono text-[10px] uppercase tracking-[0.1em] transition-colors',
                compact ? 'min-h-[44px] min-w-[44px] px-2' : 'min-h-[30px] px-2.5',
                i > 0 && 'border-l border-[var(--border-color)]',
                active
                  ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
              )}
            >
              {m}
            </button>
          )
        })}
      </div>
    </div>
  )
}
