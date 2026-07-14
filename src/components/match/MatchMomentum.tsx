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

interface MomentumPoint {
  minute: number
  value: number
}

interface MatchMomentumProps {
  events: MatchEvent[]
  homeTeam: string
  awayTeam: string
  status: string
  possession?: [number, number]
  /**
   * Real per-minute momentum series from the match data feed (sign encodes
   * side, positive = home). When present it drives the chart directly and no
   * "approximate" label is shown; otherwise the curve is synthesized from
   * events + possession and labelled as approximate.
   */
  series?: MomentumPoint[] | null
}

const HOME_COLOR = 'var(--team-tint-home, var(--accent-primary))'
const AWAY_COLOR = 'var(--team-tint-away, var(--accent-info))'

/**
 * Momentum strip — pressure flowing toward each team across the match
 * timeline. Bars grow out from a centre line (home above, away below).
 */
export default function MatchMomentum({
  events,
  homeTeam,
  awayTeam,
  status,
  possession,
  series,
}: MatchMomentumProps) {
  const reduce = useReducedMotion()
  const isFinished = status === 'STATUS_FINAL'
  const hasRealSeries = Array.isArray(series) && series.length > 0

  const maxMinute = useMemo(() => {
    const eventMax = events.map((e) => e.minute + (e.addedTime || 0))
    const seriesMax = hasRealSeries ? series!.map((p) => p.minute) : []
    return isFinished
      ? Math.max(90, ...seriesMax, 0)
      : Math.max(90, ...eventMax, ...seriesMax, 0)
  }, [events, series, hasRealSeries, isFinished])

  // Synthesized fallback — event weights + possession bias in 5-minute bins.
  const synthesized = useMemo(() => {
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

  // Bars: real series when present, synthesized bins otherwise. Each bar is
  // { x (0..1 across the pitch of time), width (0..1), value }.
  const bars = useMemo(() => {
    if (hasRealSeries) {
      const pts = [...series!]
        .filter((p) => Number.isFinite(p.minute) && Number.isFinite(p.value))
        .sort((a, b) => a.minute - b.minute)
      const span = Math.max(maxMinute, 1)
      const w = Math.max(0.004, 1 / Math.max(pts.length, 1))
      return pts.map((p) => ({
        x: Math.min(1, Math.max(0, p.minute / span)),
        width: w,
        value: p.value,
      }))
    }
    return synthesized.map((value, i) => ({
      x: i / 18,
      width: 1 / 18,
      value,
    }))
  }, [hasRealSeries, series, synthesized, maxMinute])

  const maxVal = Math.max(hasRealSeries ? 1 : 3, ...bars.map((b) => Math.abs(b.value)))
  const chartH = 96
  const midY = chartH / 2
  const goalMarkers = events.filter((e) => e.type === 'goal' || e.type === 'own_goal')

  if (bars.length === 0) return null

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Momentum</h3>
        {!hasRealSeries && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Approximate · from match events
          </span>
        )}
      </div>

      <div className="mb-1 flex justify-between text-xs">
        <span className="font-semibold" style={{ color: HOME_COLOR }}>{homeTeam}</span>
        <span className="font-semibold" style={{ color: AWAY_COLOR }}>{awayTeam}</span>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 360 ${chartH}`} className="w-full" style={{ height: chartH }} role="img" aria-label="Match momentum">
          {/* Flat chart surface: one centre hairline + a quiet HT tick. No grid. */}
          <line x1="0" y1={midY} x2="360" y2={midY} stroke="var(--border-color)" strokeWidth="1" strokeDasharray="3,3" />
          <line x1={(45 / Math.max(maxMinute, 90)) * 360} y1={chartH - 10} x2={(45 / Math.max(maxMinute, 90)) * 360} y2={chartH} stroke="var(--border-color)" strokeWidth="0.75" />
          <text x={(45 / Math.max(maxMinute, 90)) * 360 + 3} y={chartH - 3} fill="var(--text-tertiary)" fontSize="7">HT</text>

          {bars.map((bar, i) => {
            const barW = Math.max(1, bar.width * 360 - (hasRealSeries ? 0.6 : 2))
            const x = bar.x * 360 + (hasRealSeries ? 0 : 1)
            const normalized = (bar.value / maxVal) * (midY - 4)
            const isHome = bar.value >= 0
            const h = Math.max(1, Math.abs(normalized))
            const y = isHome ? midY - h : midY
            return (
              <motion.rect
                key={i}
                x={x}
                width={barW}
                rx={hasRealSeries ? 0.5 : 2}
                fill={isHome ? HOME_COLOR : AWAY_COLOR}
                fillOpacity={0.9}
                initial={reduce ? false : { height: 0, y: midY }}
                animate={{ height: h, y }}
                transition={{ duration: 0.5, delay: reduce ? 0 : Math.min(i * 0.012, 0.5), ease: [0.22, 1, 0.36, 1] }}
              />
            )
          })}

          {goalMarkers.map((evt, i) => {
            const min = evt.minute + (evt.addedTime || 0)
            const x = (min / Math.max(maxMinute, 1)) * 360
            const y = evt.team === 'home' ? 8 : chartH - 8
            const color = evt.team === 'home' ? HOME_COLOR : AWAY_COLOR
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="5" fill={color} opacity="0.22" />
                <circle cx={x} cy={y} r="3.5" fill={color} />
                <circle cx={x} cy={y} r="1.4" fill="var(--card-bg)" />
              </g>
            )
          })}
        </svg>

        <div className="mt-0.5 flex justify-between text-[10px] text-[var(--text-tertiary)]">
          <span>0&apos;</span>
          <span>45&apos;</span>
          <span>{maxMinute > 90 ? `${Math.round(maxMinute)}'` : "90'"}</span>
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
