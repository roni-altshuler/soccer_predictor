'use client'

import { useEffect, useState } from 'react'

type EventType = 'goal' | 'own_goal' | 'yellow_card' | 'red_card' | 'substitution' | string

interface TimelineEvent {
  minute: number
  type: EventType
  team: 'home' | 'away'
  player: string
  detail?: string
}

interface TimelineResponse {
  match_id?: string
  events?: TimelineEvent[]
}

interface EventTimelineProps {
  matchId: string
  homeTeam: string
  awayTeam: string
  status: string
  league?: string
}

const FINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'POST', 'finished', 'cancelled', 'postponed'])

const COLORS: Record<string, string> = {
  goal: '#00c853',
  own_goal: '#00c853',
  red_card: '#ef4444',
  yellow_card: '#f59e0b',
  substitution: '#9ca3af',
}

function eventIcon(type: EventType): string {
  switch (type) {
    case 'goal':
      return '⚽'
    case 'own_goal':
      return '⚽'
    case 'yellow_card':
      return '🟨'
    case 'red_card':
      return '🟥'
    case 'substitution':
      return '🔁'
    default:
      return '•'
  }
}

function eventLabel(type: EventType): string {
  switch (type) {
    case 'goal':
      return 'Goal'
    case 'own_goal':
      return 'Own Goal'
    case 'yellow_card':
      return 'Yellow Card'
    case 'red_card':
      return 'Red Card'
    case 'substitution':
      return 'Substitution'
    default:
      return String(type).replace(/_/g, ' ')
  }
}

export default function EventTimeline({
  matchId,
  homeTeam,
  awayTeam,
  status,
  league,
}: EventTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const finalStatus = FINAL_STATUSES.has(status)

    async function load() {
      try {
        const qs = league ? `?league=${encodeURIComponent(league)}` : ''
        const res = await fetch(`/api/match/${matchId}/timeline${qs}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: TimelineResponse = await res.json()
        if (cancelled) return
        setEvents(Array.isArray(data.events) ? data.events : [])
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load timeline')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    if (finalStatus) {
      return () => {
        cancelled = true
      }
    }
    const id = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [matchId, status, league])

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ backgroundColor: '#161b22', borderColor: 'var(--border-color)' }}
    >
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Match Timeline</h3>
        <div className="flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
          <span className="truncate max-w-[120px]">{homeTeam}</span>
          <span>·</span>
          <span className="truncate max-w-[120px]">{awayTeam}</span>
        </div>
      </div>

      <div className="p-4">
        {loading && (
          <p className="text-sm text-center text-[var(--text-tertiary)] py-6">Loading timeline…</p>
        )}
        {!loading && error && (
          <p className="text-sm text-center text-red-400 py-6">Failed to load timeline ({error})</p>
        )}
        {!loading && !error && events && events.length === 0 && (
          <p className="text-sm text-center text-[var(--text-tertiary)] py-6">No events yet.</p>
        )}
        {!loading && !error && events && events.length > 0 && (
          <ol className="relative">
            <div
              aria-hidden
              className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px"
              style={{ backgroundColor: 'var(--border-color)' }}
            />
            {events.map((evt, idx) => {
              const color = COLORS[evt.type] || '#9ca3af'
              const isHome = evt.team === 'home'
              return (
                <li key={`${idx}-${evt.type}-${evt.minute}-${evt.player}`} className="relative grid grid-cols-[1fr_56px_1fr] gap-2 py-2">
                  <div className={`text-right pr-2 ${isHome ? '' : 'opacity-30'}`}>
                    {isHome && (
                      <EventBubble color={color} type={evt.type} player={evt.player} detail={evt.detail} align="right" />
                    )}
                  </div>
                  <div className="flex items-center justify-center">
                    <span
                      className="inline-flex items-center justify-center rounded-full text-[11px] font-bold"
                      style={{
                        width: 40,
                        height: 22,
                        backgroundColor: '#0d1117',
                        color: 'var(--text-primary)',
                        border: `1px solid ${color}`,
                      }}
                      title={`${eventLabel(evt.type)} – ${evt.minute}'`}
                    >
                      {evt.minute}&apos;
                    </span>
                  </div>
                  <div className={`text-left pl-2 ${isHome ? 'opacity-30' : ''}`}>
                    {!isHome && (
                      <EventBubble color={color} type={evt.type} player={evt.player} detail={evt.detail} align="left" />
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

function EventBubble({
  color,
  type,
  player,
  detail,
  align,
}: {
  color: string
  type: EventType
  player: string
  detail?: string
  align: 'left' | 'right'
}) {
  return (
    <div
      className={`inline-flex max-w-full flex-col gap-0.5 rounded-xl px-3 py-1.5 border text-xs ${
        align === 'right' ? 'items-end text-right' : 'items-start text-left'
      }`}
      style={{
        borderColor: color,
        backgroundColor: `${color}14`,
      }}
    >
      <span className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
        <span aria-hidden>{eventIcon(type)}</span>
        <span className="truncate" style={{ maxWidth: 180 }}>{player}</span>
      </span>
      <span className="uppercase tracking-wide text-[10px]" style={{ color }}>
        {eventLabel(type)}
      </span>
      {detail && (
        <span className="text-[10px] text-[var(--text-tertiary)] truncate" style={{ maxWidth: 240 }}>
          {detail}
        </span>
      )}
    </div>
  )
}
