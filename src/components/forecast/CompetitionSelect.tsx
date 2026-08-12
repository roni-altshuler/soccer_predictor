'use client'

import { Check, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { LeagueMark } from '@/components/primitives/LeagueMark'
import { cn } from '@/lib/utils'

/**
 * Pick one competition out of many.
 *
 * Why a picker and not a row of chips: seven league chips already wrapped to
 * two lines on a phone, and the tournament page had nine. Every one of them
 * was permanently on screen competing with the forecast for attention, when a
 * reader looks at one competition at a time. The control that switches
 * competition should therefore occupy the space of one — which is what FotMob,
 * ESPN and the BBC all settled on.
 *
 * Implemented as the ARIA listbox pattern rather than a `<select>` because the
 * rows carry a badge and a second line of context — how much of a season is
 * left, or whether a tournament has been drawn yet. A native option is text
 * only. That means the keyboard contract has to be built by hand, and all of
 * it is here: arrows, Home/End, Enter/Space, Escape, Tab, and type-ahead.
 * `aria-activedescendant` tracks the highlighted row while DOM focus stays on
 * the list, which is what screen readers expect from a listbox.
 *
 * Below the `sm` breakpoint it is a bottom sheet, portalled to `document.body`.
 * An anchored panel has to fit between the trigger and the app's fixed tab bar
 * and at 375x667 it does not; flipping it upward only moves the clipping to
 * the top edge at 320px. `position: fixed` resolves against the nearest
 * transformed ancestor rather than the viewport, and this app has several,
 * hence the portal.
 *
 * Generic on purpose. There were two of these pickers to build and a keyboard
 * contract is not a thing to implement twice.
 */

export interface CompetitionOption {
  id: string
  name: string
  /** Second line in the list — country and fixtures left, region and status. */
  subtitle: string
  /**
   * Second line on the closed trigger, when it differs. The trigger answers
   * "which competition am I looking at"; a row answers "why would I switch to
   * this one". Those are not always the same sentence.
   */
  triggerSubtitle?: string
  /** Marks a competition as under way, with a dot before the name. */
  live?: boolean
}

// The app's mobile tab bar is fixed to the bottom of the viewport, so the
// space a dropdown can actually use ends above it, not at the window edge.
const BOTTOM_OBSTRUCTION = 76

export function CompetitionSelect({
  options,
  value,
  onChange,
  kind = 'League',
  className,
}: {
  /** In the order they should be offered. The caller decides what that is. */
  options: CompetitionOption[]
  value: string
  onChange: (id: string) => void
  /** Names the control for screen readers: "League", "Tournament". */
  kind?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState<{
    sheet: boolean
    above: boolean
    maxHeight: number
  }>({ sheet: false, above: false, maxHeight: 384 })
  // `document` does not exist while this renders on the server, and the sheet
  // is portalled into it.
  const [mounted, setMounted] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const typeahead = useRef({ buffer: '', at: 0 })
  const baseId = useId()

  useEffect(() => setMounted(true), [])

  const index = Math.max(0, options.findIndex((o) => o.id === value))
  const current = options[index]

  const optionId = (i: number) => `${baseId}-option-${i}`

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const choose = useCallback(
    (i: number) => {
      const option = options[i]
      if (option) onChange(option.id)
      close()
    },
    [options, onChange, close],
  )

  // Open with the current competition highlighted — the reader's place in the
  // list, not the top of it.
  useEffect(() => {
    if (open) setActive(index)
  }, [open, index])

  // Focus the list itself; `aria-activedescendant` carries the highlight from
  // there. Moving real focus row to row would fight the screen reader's own
  // model of a listbox.
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  useEffect(() => {
    const measure = () => {
      const wide =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(min-width: 640px)').matches
      if (!wide) {
        setPlacement({ sheet: true, above: false, maxHeight: 0 })
        return
      }
      const r = triggerRef.current?.getBoundingClientRect()
      const gutter = 12
      const below = r ? window.innerHeight - r.bottom - gutter : 384
      const above = r ? r.top - gutter : 384
      const useAbove = below < 240 && above > below
      setPlacement({
        sheet: false,
        above: useAbove,
        maxHeight: Math.min(384, Math.max(0, useAbove ? above : below)),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  // Keep the highlighted row on screen now that the panel can scroll.
  useEffect(() => {
    if (!open) return
    document
      .getElementById(`${baseId}-option-${active}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, active, baseId])

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      // The sheet lives in a portal, so it is outside `rootRef` in the DOM
      // while being very much inside the control.
      if (rootRef.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
    }
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = options.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => (i >= last ? 0 : i + 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => (i <= 0 ? last : i - 1))
        return
      case 'Home':
        e.preventDefault()
        setActive(0)
        return
      case 'End':
        e.preventDefault()
        setActive(last)
        return
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        return
      case 'Escape':
        e.preventDefault()
        close()
        return
      case 'Tab':
        // Tab commits nothing and closes — the same contract as a native
        // select, so a keyboard user cannot leave a half-open control behind.
        setOpen(false)
        return
      default:
        break
    }
    // Type-ahead. "li" finds Ligue 1 rather than stopping at the first L.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now()
      const t = typeahead.current
      t.buffer = now - t.at > 900 ? e.key : t.buffer + e.key
      t.at = now
      const q = t.buffer.toLowerCase()
      const hit = options.findIndex((o) => o.name.toLowerCase().startsWith(q))
      if (hit !== -1) setActive(hit)
    }
  }

  if (!current) return null

  const list = (
    <ul
      ref={listRef}
      role="listbox"
      tabIndex={-1}
      aria-label={`${kind}s`}
      aria-activedescendant={optionId(active)}
      onKeyDown={onKeyDown}
      style={
        placement.sheet
          ? { bottom: BOTTOM_OBSTRUCTION, maxHeight: '65vh' }
          : { maxHeight: placement.maxHeight }
      }
      className={cn(
        'z-50 overflow-y-auto border',
        'border-[var(--border-color)] bg-[var(--card-bg)] shadow-2xl shadow-black/40',
        'focus:outline-none',
        placement.sheet
          ? 'fixed inset-x-0 rounded-t-2xl px-2 pb-3 pt-2'
          : cn(
              'absolute left-0 right-0 rounded-xl p-1 sm:right-auto sm:w-[22rem]',
              placement.above ? 'bottom-full mb-2' : 'top-full mt-2',
            ),
      )}
    >
      {options.map((o, i) => {
        const selected = o.id === current.id
        return (
          <li
            key={o.id}
            id={optionId(i)}
            role="option"
            aria-selected={selected}
            onClick={() => choose(i)}
            onMouseEnter={() => setActive(i)}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 transition-colors',
              // Roomier rows in the sheet: it is operated with a thumb.
              placement.sheet ? 'py-3' : 'py-2',
              i === active && 'bg-[var(--card-hover)]',
            )}
          >
            <LeagueMark league={o.id} size="sm" />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'flex items-center gap-1.5 truncate text-[14px] leading-tight',
                  selected
                    ? 'font-semibold text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]',
                )}
              >
                {o.live ? (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]"
                  />
                ) : null}
                <span className="truncate">{o.name}</span>
              </span>
              <span className="block truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {o.subtitle}
              </span>
            </span>
            {selected ? (
              <Check
                aria-hidden
                strokeWidth={2.5}
                className="h-4 w-4 shrink-0 text-[var(--accent-primary)]"
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )

  const sheet = (
    <>
      <div
        aria-hidden
        onClick={() => close()}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
      />
      {list}
    </>
  )

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${kind}: ${current.name}. Change ${kind.toLowerCase()}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={cn(
          'group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
          'border-[var(--border-color)] bg-[var(--card-bg)] hover:border-[var(--text-tertiary)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]',
          'sm:w-auto sm:min-w-[16rem]',
        )}
      >
        <LeagueMark league={current.id} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
            {current.live ? (
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]"
              />
            ) : null}
            <span className="truncate">{current.name}</span>
          </span>
          <span className="block truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            {current.triggerSubtitle ?? current.subtitle}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          strokeWidth={2}
          className={cn(
            'h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {!open ? null : placement.sheet ? (
        mounted ? createPortal(sheet, document.body) : null
      ) : (
        list
      )}
    </div>
  )
}
