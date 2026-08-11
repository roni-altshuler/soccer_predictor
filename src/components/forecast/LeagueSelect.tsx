'use client'

import { Check, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { LeagueMark } from '@/components/primitives/LeagueMark'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

/**
 * Pick a competition.
 *
 * Why a listbox and not the row of chips this replaced: seven chips already
 * wrapped to two lines on a phone, and every one of them was permanently on
 * screen competing with the forecast for attention. A reader looks at one
 * league at a time. The control that switches league should therefore occupy
 * the space of one league, not seven — which is exactly what FotMob, ESPN and
 * the BBC all settled on.
 *
 * Implemented as the ARIA listbox pattern rather than a `<select>` because the
 * rows carry a badge, a country and how much of the season is left — a native
 * option is text only. That means the keyboard contract has to be built by
 * hand, and all of it is here: arrows, Home/End, Enter/Space, Escape, Tab,
 * and type-ahead. `aria-activedescendant` tracks the highlighted row while DOM
 * focus stays on the list, which is what screen readers expect from a listbox.
 *
 * Order is by prominence, not alphabet. Alphabetical order opens on the
 * Bundesliga for an audience that is mostly there for the Premier League, and
 * no reader thinks of leagues as an alphabetised set.
 */

export interface LeagueOption {
  competition_id: string
  name: string
  country: string | null
  season: number
  fixtures_remaining: number
  teams: number
}

// Roughly by following, which is how every product in this space orders them:
// the big five, then the other top flights, then the second tiers. Anything
// unlisted falls to the end in alphabetical order rather than disappearing.
const RANK = [
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'ned.1', 'por.1', 'tur.1',
  'bra.1', 'eng.2', 'esp.2', 'ita.2', 'ger.2', 'fra.2',
]

// The app's mobile tab bar is fixed to the bottom of the viewport, so the
// space a dropdown can actually use ends above it, not at the window edge.
const BOTTOM_OBSTRUCTION = 76

export function orderLeagues<T extends { competition_id: string; name: string }>(
  leagues: T[],
): T[] {
  return [...leagues].sort((a, b) => {
    const ra = RANK.indexOf(a.competition_id)
    const rb = RANK.indexOf(b.competition_id)
    if (ra !== -1 || rb !== -1) {
      if (ra === -1) return 1
      if (rb === -1) return -1
      return ra - rb
    }
    return a.name.localeCompare(b.name)
  })
}

export const seasonLabel = (season: number) =>
  `${season}/${String(season + 1).slice(2)}`

export function LeagueSelect({
  leagues,
  value,
  onChange,
  className,
}: {
  leagues: LeagueOption[]
  value: string
  onChange: (competitionId: string) => void
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

  const ordered = useMemo(() => orderLeagues(leagues), [leagues])
  const index = Math.max(0, ordered.findIndex((l) => l.competition_id === value))
  const current = ordered[index]

  const optionId = (i: number) => `${baseId}-option-${i}`

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const choose = useCallback(
    (i: number) => {
      const league = ordered[i]
      if (league) onChange(league.competition_id)
      close()
    },
    [ordered, onChange, close],
  )

  // Open with the current league highlighted — the reader's place in the list,
  // not the top of it.
  useEffect(() => {
    if (open) setActive(index)
  }, [open, index])

  // Focus the list itself; `aria-activedescendant` carries the highlight from
  // there. Moving real focus row to row would fight the screen reader's own
  // model of a listbox.
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  // Anchored panel on a wide screen, bottom sheet on a phone.
  //
  // The anchored version has to fit between the trigger and the fixed tab bar,
  // and on a 375x667 device it does not: the panel is cut off with no
  // scrollbar and no sign the missing leagues exist. Flipping it upward only
  // moves the problem to the top edge on a 320px screen.
  //
  // A sheet has none of that geometry. It is also the better control on a
  // phone — thumb-reachable, full-width rows — which is why every app in this
  // category uses one.
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
    const last = ordered.length - 1
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
      const hit = ordered.findIndex((l) => l.name.toLowerCase().startsWith(q))
      if (hit !== -1) setActive(hit)
    }
  }

  if (!current) return null


  const accent = getLeagueAccent(current.competition_id)

  // The open panel. Portalled to `document.body` when it is a sheet: a
  // `position: fixed` element is positioned against the nearest ancestor with
  // a transform, filter or backdrop-filter rather than against the viewport,
  // and this page has several. Anchored to the trigger it must stay in the
  // tree, because that is what it is anchored to.
  const list = (
    <ul
      ref={listRef}
      role="listbox"
      tabIndex={-1}
      aria-label="Leagues"
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
      {ordered.map((l, i) => {
        const selected = l.competition_id === current.competition_id
        return (
          <li
            key={l.competition_id}
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
            <LeagueMark league={l.competition_id} size="sm" />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate text-[14px] leading-tight',
                  selected
                    ? 'font-semibold text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]',
                )}
              >
                {l.name}
              </span>
              <span className="block truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {l.country ?? getLeagueAccent(l.competition_id).country} ·{' '}
                {l.fixtures_remaining} to play
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
        aria-label={`League: ${current.name}. Change league`}
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
        <LeagueMark league={current.competition_id} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
            {current.name}
          </span>
          <span className="block truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            {current.country ?? accent.country} · {seasonLabel(current.season)}
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
