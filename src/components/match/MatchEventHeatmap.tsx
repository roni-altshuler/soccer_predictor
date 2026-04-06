'use client'

import { useMemo, useState } from 'react'

interface MatchEvent {
  type: string
  minute: number
  addedTime?: number
  player: string
  team: 'home' | 'away'
  relatedPlayer?: string
}

interface ShotMapPoint {
  x: number
  y: number
  team: 'home' | 'away'
  expectedGoals?: number
  isGoal?: boolean
  minute?: number
  player?: string
}

interface HeatPoint {
  x: number
  y: number
  weight: number
  team: 'home' | 'away'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hashSeed(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function eventWeight(type: string): number {
  if (type === 'goal' || type === 'own_goal') return 3.6
  if (type === 'red_card') return 2.5
  if (type === 'yellow_card') return 1.5
  if (type === 'penalty_missed') return 2.1
  if (type === 'substitution') return 0.8
  if (type === 'assist') return 1.1
  return 1
}

function inferEventPoint(event: MatchEvent, index: number): HeatPoint {
  const minute = Math.max(0, event.minute + (event.addedTime || 0))
  const seed = hashSeed(`${event.player}-${event.type}-${minute}-${index}`)

  const baseX = event.team === 'home' ? 0.71 : 0.29
  const xJitter = ((seed % 41) - 20) / 100
  const ySeed = ((Math.floor(seed / 41) % 100) / 100)

  const typeBias = event.type === 'goal' || event.type === 'own_goal'
    ? (event.team === 'home' ? 0.13 : -0.13)
    : event.type === 'yellow_card' || event.type === 'red_card'
      ? (event.team === 'home' ? -0.06 : 0.06)
      : 0

  // Spread events into lanes while keeping deterministic positions.
  const minuteBand = (minute % 30) / 30
  const y = clamp(0.1 + ((ySeed * 0.55) + (minuteBand * 0.35)), 0.08, 0.92)
  const x = clamp(baseX + typeBias + (xJitter * 0.35), 0.08, 0.92)

  return {
    x,
    y,
    weight: eventWeight(event.type),
    team: event.team,
  }
}

export default function MatchEventHeatmap({
  events,
  homeTeam,
  awayTeam,
  shotmap = [],
}: {
  events: MatchEvent[]
  homeTeam: string
  awayTeam: string
  shotmap?: ShotMapPoint[]
}) {
  const [focusTeam, setFocusTeam] = useState<'home' | 'away'>('home')
  const usingShotmap = shotmap.length > 0

  const points = useMemo(() => {
    if (shotmap.length > 0) {
      return shotmap.map((shot) => ({
        x: clamp(shot.x, 0.04, 0.96),
        y: clamp(shot.y, 0.04, 0.96),
        weight: (shot.expectedGoals ? Math.max(0.8, shot.expectedGoals * 5.5) : 1.4) + (shot.isGoal ? 1.8 : 0),
        team: shot.team,
      }))
    }

    return events
      .filter((event) => {
        return [
          'goal',
          'own_goal',
          'assist',
          'yellow_card',
          'red_card',
          'substitution',
          'penalty_missed',
          'var',
        ].includes(event.type)
      })
      .map((event, index) => inferEventPoint(event, index))
  }, [events, shotmap])

  const focused = useMemo(() => {
    return points.filter((point) => point.team === focusTeam)
  }, [points, focusTeam])

  if (points.length === 0) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Play Heatmap</h3>
        <p className="text-xs mt-2 text-[var(--text-tertiary)]">
          Heatmap appears once event-level match actions are available.
        </p>
      </div>
    )
  }

  const baseColor = focusTeam === 'home' ? '#3b82f6' : '#f97316'
  const maxWeight = Math.max(...focused.map((point) => point.weight), 1)
  const totalWeight = focused.reduce((sum, point) => sum + point.weight, 0)

  const finalThirdWeight = focused
    .filter((point) => focusTeam === 'home' ? point.x >= 0.66 : point.x <= 0.34)
    .reduce((sum, point) => sum + point.weight, 0)

  const centralLaneWeight = focused
    .filter((point) => point.y >= 0.34 && point.y <= 0.66)
    .reduce((sum, point) => sum + point.weight, 0)

  const transitionWeight = focused
    .filter((point) => point.x > 0.34 && point.x < 0.66)
    .reduce((sum, point) => sum + point.weight, 0)

  const zoneShare = (zoneWeight: number): string => {
    if (totalWeight <= 0) return '0%'
    return `${Math.round((zoneWeight / totalWeight) * 100)}%`
  }

  const teamLabel = focusTeam === 'home' ? homeTeam : awayTeam

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Play Heatmap</h3>
            <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
              {usingShotmap ? 'Shot-location pressure from match shotmap data.' : 'Event-pressure view inspired by Fotmob stats tab.'}
            </p>
          </div>
          <div className="flex gap-1 rounded-lg bg-[var(--muted-bg)] p-1">
            <button
              onClick={() => setFocusTeam('home')}
              className={`px-3 py-1.5 text-xs rounded-md font-semibold transition-colors ${
                focusTeam === 'home'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {homeTeam}
            </button>
            <button
              onClick={() => setFocusTeam('away')}
              className={`px-3 py-1.5 text-xs rounded-md font-semibold transition-colors ${
                focusTeam === 'away'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {awayTeam}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-2">
          {usingShotmap
            ? 'Using real shot coordinates when available from match providers.'
            : 'Current source uses deterministic event positions as a proxy until shot coordinates are wired.'}
        </p>
      </div>

      <div className="p-4 space-y-3">
        <div className="rounded-xl border bg-[var(--muted-bg)] p-2.5" style={{ borderColor: 'var(--border-color)' }}>
          <svg viewBox="0 0 340 220" className="w-full h-auto">
            <rect x="8" y="8" width="324" height="204" rx="8" fill="transparent" stroke="var(--border-color)" strokeWidth="1.2" />
            <line x1="170" y1="8" x2="170" y2="212" stroke="var(--border-color)" strokeWidth="1" />
            <circle cx="170" cy="110" r="25" fill="none" stroke="var(--border-color)" strokeWidth="1" />
            <circle cx="170" cy="110" r="1.5" fill="var(--border-color)" />

            <rect x="8" y="58" width="52" height="104" fill="none" stroke="var(--border-color)" strokeWidth="1" />
            <rect x="8" y="78" width="20" height="64" fill="none" stroke="var(--border-color)" strokeWidth="1" />
            <rect x="280" y="58" width="52" height="104" fill="none" stroke="var(--border-color)" strokeWidth="1" />
            <rect x="312" y="78" width="20" height="64" fill="none" stroke="var(--border-color)" strokeWidth="1" />

            {focused.map((point, index) => {
              const cx = 8 + (point.x * 324)
              const cy = 8 + (point.y * 204)
              const intensity = point.weight / maxWeight
              const radius = 10 + (intensity * 18)
              const opacity = 0.12 + (intensity * 0.3)

              return (
                <g key={`${focusTeam}-${index}-${point.x}-${point.y}`}>
                  <circle cx={cx} cy={cy} r={radius} fill={baseColor} opacity={opacity} />
                  <circle cx={cx} cy={cy} r={3 + (intensity * 2)} fill={baseColor} opacity={0.85} />
                </g>
              )
            })}
          </svg>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="rounded-lg border bg-[var(--muted-bg)] p-2.5" style={{ borderColor: 'var(--border-color)' }}>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Final Third Pressure</p>
            <p className="text-lg font-bold mt-1" style={{ color: baseColor }}>{zoneShare(finalThirdWeight)}</p>
            <p className="text-[10px] text-[var(--text-tertiary)]">{teamLabel} attacking zone intensity</p>
          </div>
          <div className="rounded-lg border bg-[var(--muted-bg)] p-2.5" style={{ borderColor: 'var(--border-color)' }}>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Central Lane Activity</p>
            <p className="text-lg font-bold mt-1" style={{ color: baseColor }}>{zoneShare(centralLaneWeight)}</p>
            <p className="text-[10px] text-[var(--text-tertiary)]">Middle-channel event density</p>
          </div>
          <div className="rounded-lg border bg-[var(--muted-bg)] p-2.5" style={{ borderColor: 'var(--border-color)' }}>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Transition Events</p>
            <p className="text-lg font-bold mt-1" style={{ color: baseColor }}>{zoneShare(transitionWeight)}</p>
            <p className="text-[10px] text-[var(--text-tertiary)]">Middle-third build and recoveries</p>
          </div>
        </div>
      </div>
    </div>
  )
}
