'use client'

import { useMemo } from 'react'
import { CircleDot } from 'lucide-react'

interface MatchEvent {
  type: string
  minute: number
  addedTime?: number
  player: string
  team: 'home' | 'away'
  relatedPlayer?: string
}

interface MatchMomentumProps {
  events: MatchEvent[]
  homeTeam: string
  awayTeam: string
  status: string
  possession?: [number, number]
}

/** Momentum chart inspired by FotMob — shows event flow across match timeline */
export default function MatchMomentum({ events, homeTeam, awayTeam, status, possession }: MatchMomentumProps) {
  const isFinished = status === 'STATUS_FINAL'
  const maxMinute = isFinished ? 90 : Math.max(90, ...events.map(e => e.minute + (e.addedTime || 0)))

  // Build momentum data: positive = home dominance, negative = away dominance
  const momentumData = useMemo(() => {
    const segments = 18 // Every 5 minutes
    const data: number[] = new Array(segments).fill(0)

    for (const evt of events) {
      const min = evt.minute + (evt.addedTime || 0)
      const idx = Math.min(Math.floor(min / 5), segments - 1)
      const weight = evt.type === 'goal' ? 5 : evt.type === 'own_goal' ? 4 :
                     evt.type === 'red_card' ? 3 : evt.type === 'yellow_card' ? 1 :
                     evt.type === 'substitution' ? 0.5 : 0

      if (evt.team === 'home') {
        data[idx] += weight
      } else {
        data[idx] -= weight
      }
    }

    // Apply possession bias if available
    if (possession) {
      const bias = (possession[0] - possession[1]) / 100 // e.g., 60-40 → 0.2
      for (let i = 0; i < segments; i++) {
        data[i] += bias * 1.5
      }
    }

    // Smooth data with neighbors
    const smoothed: number[] = []
    for (let i = 0; i < segments; i++) {
      const prev = data[i - 1] || 0
      const next = data[i + 1] || 0
      smoothed.push(data[i] * 0.6 + prev * 0.2 + next * 0.2)
    }

    return smoothed
  }, [events, possession])

  const maxVal = Math.max(3, ...momentumData.map(Math.abs))
  const chartH = 80
  const midY = chartH / 2

  // Event markers for goals
  const goalMarkers = events.filter(e => e.type === 'goal' || e.type === 'own_goal')

  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--muted-bg)' }}>
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
        Momentum
      </h3>

      {/* Team labels */}
      <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
        <span className="font-medium" style={{ color: '#3b82f6' }}>{homeTeam}</span>
        <span className="font-medium" style={{ color: '#f97316' }}>{awayTeam}</span>
      </div>

      {/* SVG Chart */}
      <div className="relative">
        <svg viewBox={`0 0 360 ${chartH}`} className="w-full" style={{ height: chartH }}>
          {/* Background */}
          <rect x="0" y="0" width="360" height={chartH} rx="4" fill="var(--bg)" opacity="0.3" />

          {/* Center line */}
          <line x1="0" y1={midY} x2="360" y2={midY} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,2" />

          {/* Half time line */}
          <line x1="180" y1="0" x2="180" y2={chartH} stroke="var(--border)" strokeWidth="0.5" />
          <text x="180" y={chartH - 2} textAnchor="middle" fill="var(--text-tertiary)" fontSize="7">HT</text>

          {/* Momentum bars */}
          {momentumData.map((val, i) => {
            const x = (i / 18) * 360
            const barW = 360 / 18 - 1
            const normalized = (val / maxVal) * (midY - 4)
            const isHome = val >= 0

            return (
              <rect
                key={i}
                x={x + 0.5}
                y={isHome ? midY - normalized : midY}
                width={barW}
                height={Math.abs(normalized)}
                rx="1"
                fill={isHome ? '#3b82f6' : '#f97316'}
                opacity={0.6 + Math.abs(val / maxVal) * 0.4}
              />
            )
          })}

          {/* Goal markers */}
          {goalMarkers.map((evt, i) => {
            const min = evt.minute + (evt.addedTime || 0)
            const x = (min / maxMinute) * 360
            const y = evt.team === 'home' ? 6 : chartH - 6
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="4" fill={evt.team === 'home' ? '#3b82f6' : '#f97316'} />
                <circle cx={x} cy={y} r="1.5" fill="white" />
              </g>
            )
          })}
        </svg>

        {/* Minute labels */}
        <div className="flex justify-between text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          <span>0&apos;</span>
          <span>45&apos;</span>
          <span>90&apos;</span>
        </div>
      </div>

      {/* Goal timeline summary */}
      {goalMarkers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {goalMarkers.map((g, i) => (
            <span
              key={i}
              className="text-[10px] px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1"
              style={{
                background: g.team === 'home' ? 'rgba(59,130,246,0.15)' : 'rgba(249,115,22,0.15)',
                color: g.team === 'home' ? '#3b82f6' : '#f97316',
              }}
            >
              <CircleDot className="h-3 w-3" aria-hidden />
              {g.player} {g.minute}&apos;{g.addedTime ? `+${g.addedTime}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
