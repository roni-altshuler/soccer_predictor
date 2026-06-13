'use client'

import { useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
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

const HOME_COLOR = 'var(--team-tint-home, var(--accent-primary))'
const AWAY_COLOR = 'var(--team-tint-away, var(--accent-info))'

/**
 * Momentum graph inspired by FotMob — pressure flowing toward each team across
 * the match timeline. Bars grow out from a centre line (home above, away below),
 * animating in with a stagger, with goal markers pulsing on the timeline.
 */
export default function MatchMomentum({ events, homeTeam, awayTeam, status, possession }: MatchMomentumProps) {
  const reduce = useReducedMotion()
  const isFinished = status === 'STATUS_FINAL'
  const maxMinute = isFinished ? 90 : Math.max(90, ...events.map((e) => e.minute + (e.addedTime || 0)))

  const momentumData = useMemo(() => {
    const segments = 18 // every 5 minutes
    const data: number[] = new Array(segments).fill(0)
    for (const evt of events) {
      const min = evt.minute + (evt.addedTime || 0)
      const idx = Math.min(Math.floor(min / 5), segments - 1)
      const weight =
        evt.type === 'goal' ? 5 : evt.type === 'own_goal' ? 4 :
        evt.type === 'red_card' ? 3 : evt.type === 'yellow_card' ? 1 :
        evt.type === 'substitution' ? 0.5 : 0
      data[idx] += evt.team === 'home' ? weight : -weight
    }
    if (possession) {
      const bias = (possession[0] - possession[1]) / 100
      for (let i = 0; i < segments; i++) data[i] += bias * 1.5
    }
    const smoothed: number[] = []
    for (let i = 0; i < segments; i++) {
      const prev = data[i - 1] || 0
      const next = data[i + 1] || 0
      smoothed.push(data[i] * 0.6 + prev * 0.2 + next * 0.2)
    }
    return smoothed
  }, [events, possession])

  const maxVal = Math.max(3, ...momentumData.map(Math.abs))
  const chartH = 96
  const midY = chartH / 2
  const goalMarkers = events.filter((e) => e.type === 'goal' || e.type === 'own_goal')

  return (
    <div className="cine-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Momentum</h3>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Pressure flow
        </span>
      </div>

      <div className="mb-1 flex justify-between text-xs">
        <span className="font-semibold" style={{ color: HOME_COLOR }}>{homeTeam}</span>
        <span className="font-semibold" style={{ color: AWAY_COLOR }}>{awayTeam}</span>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 360 ${chartH}`} className="w-full" style={{ height: chartH }} role="img" aria-label="Match momentum">
          <defs>
            <linearGradient id="momentum-home" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={HOME_COLOR} stopOpacity="0.35" />
              <stop offset="100%" stopColor={HOME_COLOR} stopOpacity="1" />
            </linearGradient>
            <linearGradient id="momentum-away" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={AWAY_COLOR} stopOpacity="0.35" />
              <stop offset="100%" stopColor={AWAY_COLOR} stopOpacity="1" />
            </linearGradient>
          </defs>

          <line x1="0" y1={midY} x2="360" y2={midY} stroke="var(--border-color)" strokeWidth="1" strokeDasharray="3,3" />
          <line x1="180" y1="0" x2="180" y2={chartH} stroke="var(--border-color)" strokeWidth="0.75" />
          <text x="183" y={chartH - 3} fill="var(--text-tertiary)" fontSize="7">HT</text>

          {momentumData.map((val, i) => {
            const barW = 360 / 18 - 2
            const x = (i / 18) * 360 + 1
            const normalized = (val / maxVal) * (midY - 4)
            const isHome = val >= 0
            const h = Math.max(1, Math.abs(normalized))
            const y = isHome ? midY - h : midY
            return (
              <motion.rect
                key={i}
                x={x}
                width={barW}
                rx="2"
                fill={isHome ? 'url(#momentum-home)' : 'url(#momentum-away)'}
                initial={reduce ? false : { height: 0, y: midY }}
                animate={{ height: h, y }}
                transition={{ duration: 0.5, delay: reduce ? 0 : i * 0.025, ease: [0.22, 1, 0.36, 1] }}
              />
            )
          })}

          {goalMarkers.map((evt, i) => {
            const min = evt.minute + (evt.addedTime || 0)
            const x = (min / maxMinute) * 360
            const y = evt.team === 'home' ? 8 : chartH - 8
            const color = evt.team === 'home' ? HOME_COLOR : AWAY_COLOR
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="6" fill={color} opacity="0.25">
                  {!reduce && (
                    <animate attributeName="r" values="5;9;5" dur="2.4s" repeatCount="indefinite" />
                  )}
                </circle>
                <circle cx={x} cy={y} r="3.5" fill={color} />
                <circle cx={x} cy={y} r="1.4" fill="var(--card-bg)" />
              </g>
            )
          })}
        </svg>

        <div className="mt-0.5 flex justify-between text-[10px] text-[var(--text-tertiary)]">
          <span>0&apos;</span>
          <span>45&apos;</span>
          <span>90&apos;</span>
        </div>
      </div>

      {goalMarkers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {goalMarkers.map((g, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                background: `color-mix(in srgb, ${g.team === 'home' ? HOME_COLOR : AWAY_COLOR} 15%, transparent)`,
                color: g.team === 'home' ? HOME_COLOR : AWAY_COLOR,
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
