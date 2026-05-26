'use client'

import { CircleDot, RefreshCw, Square, ShieldOff } from 'lucide-react'

import { cn } from '@/lib/utils'

export type EventType =
  | 'goal'
  | 'own_goal'
  | 'penalty_goal'
  | 'penalty_missed'
  | 'yellow_card'
  | 'red_card'
  | 'substitution'
  | string

export interface TimelineEvent {
  type: EventType
  minute: number
  addedTime?: number
  player: string
  team: 'home' | 'away'
  /** Assist (for goals) or incoming player (for substitutions). */
  relatedPlayer?: string
  /** Optional score snapshot at this event ("1-0"). */
  score?: string
}

interface EventTimelineProps {
  events: TimelineEvent[]
  /** Display labels — used for the event row header (top of column). */
  homeName?: string
  awayName?: string
  /** Per-team brand colors — surfaces via `--team-tint-{home,away}`. */
  homeColor?: string
  awayColor?: string
  /** Minute at which half-time happened (default 45). */
  halftimeMinute?: number
  className?: string
}

function eventIcon(type: EventType) {
  const t = type as string
  if (t === 'goal' || t === 'own_goal' || t === 'penalty_goal') {
    return <CircleDot className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden />
  }
  if (t === 'yellow_card') {
    return <Square className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" aria-hidden />
  }
  if (t === 'red_card') {
    return <Square className="h-3.5 w-3.5 fill-red-500 text-red-500" aria-hidden />
  }
  if (t === 'penalty_missed') {
    return <ShieldOff className="h-4 w-4 text-[var(--text-tertiary)]" aria-hidden />
  }
  if (t === 'substitution') {
    return <RefreshCw className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden />
  }
  return <CircleDot className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden />
}

function eventLabel(evt: TimelineEvent): string {
  const t = evt.type as string
  if (t === 'own_goal') return `${evt.player} (OG)`
  if (t === 'penalty_goal') return `${evt.player} (pen)`
  if (t === 'penalty_missed') return `${evt.player} (pen miss)`
  return evt.player
}

function formatMinute(evt: TimelineEvent): string {
  const m = `${evt.minute}'`
  return evt.addedTime ? `${evt.minute}+${evt.addedTime}'` : m
}

/**
 * EventTimeline — FotMob-style centred timeline. Each row shows the minute
 * in a centred chip with the event on the home side (right-aligned) or
 * away side (left-aligned). Half-time renders as a dashed separator.
 *
 * Reads `--team-tint-{home,away}` (Phase 0.A) for the assist meta colour.
 */
export function EventTimeline({
  events,
  homeName,
  awayName,
  homeColor,
  awayColor,
  halftimeMinute = 45,
  className,
}: EventTimelineProps) {
  // Sort events stably (already given but defensive) and split around halftime.
  const sorted = [...events].sort((a, b) => {
    if (a.minute !== b.minute) return a.minute - b.minute
    return (a.addedTime ?? 0) - (b.addedTime ?? 0)
  })

  if (sorted.length === 0) {
    return (
      <div
        className={cn(
          'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6 text-center text-meta text-[var(--text-tertiary)]',
          className,
        )}
      >
        No events recorded yet.
      </div>
    )
  }

  const firstHalf = sorted.filter((e) => e.minute <= halftimeMinute)
  const secondHalf = sorted.filter((e) => e.minute > halftimeMinute)

  function renderEvent(evt: TimelineEvent, idx: number) {
    const isHome = evt.team === 'home'
    const isGoal = evt.type === 'goal' || evt.type === 'own_goal' || evt.type === 'penalty_goal'
    return (
      <div
        key={`${evt.minute}-${idx}-${evt.player}`}
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5"
      >
        <div className={cn('flex items-center justify-end gap-2', !isHome && 'invisible')}>
          {isHome && (
            <>
              <div className="flex flex-col items-end">
                <span
                  className={cn(
                    'text-meta text-[var(--text-primary)]',
                    isGoal && 'font-semibold',
                  )}
                >
                  {eventLabel(evt)}
                </span>
                {evt.relatedPlayer && isGoal && (
                  <span className="text-caption text-[var(--text-tertiary)]">assist · {evt.relatedPlayer}</span>
                )}
                {evt.relatedPlayer && evt.type === 'substitution' && (
                  <span className="text-caption text-[var(--text-tertiary)]">on · {evt.relatedPlayer}</span>
                )}
              </div>
              <span className="flex-shrink-0">{eventIcon(evt.type)}</span>
            </>
          )}
        </div>
        <span
          className={cn(
            'flex h-7 min-w-[3rem] items-center justify-center rounded-full px-2 text-meta font-numeric font-semibold tabular-nums',
            isGoal
              ? 'bg-[var(--accent-primary)] text-[var(--accent-on-primary)]'
              : 'bg-[var(--muted-bg)] text-[var(--text-tertiary)]',
          )}
        >
          {formatMinute(evt)}
        </span>
        <div className={cn('flex items-center justify-start gap-2', isHome && 'invisible')}>
          {!isHome && (
            <>
              <span className="flex-shrink-0">{eventIcon(evt.type)}</span>
              <div className="flex flex-col">
                <span
                  className={cn(
                    'text-meta text-[var(--text-primary)]',
                    isGoal && 'font-semibold',
                  )}
                >
                  {eventLabel(evt)}
                </span>
                {evt.relatedPlayer && isGoal && (
                  <span className="text-caption text-[var(--text-tertiary)]">assist · {evt.relatedPlayer}</span>
                )}
                {evt.relatedPlayer && evt.type === 'substitution' && (
                  <span className="text-caption text-[var(--text-tertiary)]">on · {evt.relatedPlayer}</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className,
      )}
      style={
        {
          '--team-tint-home': homeColor ?? 'var(--accent-primary)',
          '--team-tint-away': awayColor ?? 'var(--accent-loss)',
        } as React.CSSProperties
      }
    >
      {(homeName || awayName) && (
        <div className="grid grid-cols-2 border-b border-[var(--border-color)] bg-[var(--muted-bg)] px-4 py-2">
          <span className="text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            {homeName ?? 'Home'}
          </span>
          <span className="text-right text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            {awayName ?? 'Away'}
          </span>
        </div>
      )}
      <div className="divide-y divide-[var(--border-color)] px-4">
        {firstHalf.map((evt, i) => renderEvent(evt, i))}
        {secondHalf.length > 0 && (
          <div className="flex items-center justify-center py-3">
            <span className="rounded-full border border-dashed border-[var(--border-color)] px-3 py-1 text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              Half time
            </span>
          </div>
        )}
        {secondHalf.map((evt, i) => renderEvent(evt, firstHalf.length + i))}
      </div>
    </div>
  )
}
