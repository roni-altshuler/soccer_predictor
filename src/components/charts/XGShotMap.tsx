'use client'

import { useChartTheme } from './theme'
import { cn } from '@/lib/utils'

export interface ShotPoint {
  /** 0..1 — fraction across pitch length (0 = own goal line, 1 = opponent goal). */
  x: number
  /** 0..1 — fraction across pitch width (0 = top, 1 = bottom). */
  y: number
  /** Expected goal value 0..1. */
  xG: number
  /** Whether this shot resulted in a goal. */
  goal?: boolean
  /** Outcome label for the tooltip (e.g. "Saved", "Off target"). */
  outcome?: string
  /** Side that took the shot. */
  team?: 'home' | 'away'
  /** Player name for the tooltip. */
  player?: string
}

interface XGShotMapProps {
  shots: ShotPoint[]
  /** Which side's shots to render — defaults to both. */
  side?: 'both' | 'home' | 'away'
  /** Pixel height of the pitch SVG. */
  height?: number
  /** Aspect ratio (width / height) of the pitch. */
  aspect?: number
  className?: string
}

/**
 * xG shot map on a stylised half-pitch (per-team) or full pitch (both).
 * Bubble radius scales with xG; goals get a filled outline ring.
 */
export function XGShotMap({
  shots,
  side = 'both',
  height = 320,
  aspect = 1.5,
  className,
}: XGShotMapProps) {
  const theme = useChartTheme()
  const width = height * aspect

  const filtered = shots.filter((s) => (side === 'both' ? true : s.team === side))

  return (
    <div className={cn('relative', className)} style={{ width: '100%', maxWidth: width }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="auto"
        className="block rounded-xl"
        style={{ backgroundColor: 'var(--pitch-bg)' }}
      >
        <Pitch width={width} height={height} stroke={theme.border} />
        {filtered.map((s, i) => {
          const cx = side === 'away' ? width * (1 - s.x) : width * s.x
          const cy = height * s.y
          const r = 4 + Math.min(s.xG, 1) * 18
          const fill = s.team === 'away' ? theme.away : theme.home
          return (
            <g key={i} role="img" aria-label={s.player ?? 'Shot'}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={fill}
                fillOpacity={s.goal ? 0.85 : 0.45}
                stroke={s.goal ? '#fff' : fill}
                strokeWidth={s.goal ? 2 : 1}
              />
              {s.goal ? (
                <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#fff" strokeOpacity={0.5} />
              ) : null}
            </g>
          )
        })}
      </svg>
      <div className="mt-2 flex items-center gap-3 text-caption text-[var(--text-tertiary)]">
        <LegendDot color={theme.home} label="Home" />
        <LegendDot color={theme.away} label="Away" />
        <span className="ml-auto">Bubble size = xG · ringed = goal</span>
      </div>
    </div>
  )
}

function Pitch({ width, height, stroke }: { width: number; height: number; stroke: string }) {
  const cx = width / 2
  const cy = height / 2
  const boxW = width * 0.16
  const boxH = height * 0.55
  const goalW = width * 0.05
  const goalH = height * 0.22
  return (
    <g fill="none" stroke={stroke} strokeWidth={1.2} opacity={0.7}>
      {/* outer */}
      <rect x={4} y={4} width={width - 8} height={height - 8} rx={6} />
      {/* halfway */}
      <line x1={cx} y1={4} x2={cx} y2={height - 4} />
      <circle cx={cx} cy={cy} r={Math.min(width, height) * 0.08} />
      <circle cx={cx} cy={cy} r={2} fill={stroke} />
      {/* left box */}
      <rect x={4} y={(height - boxH) / 2} width={boxW} height={boxH} />
      <rect x={4} y={(height - goalH) / 2} width={goalW} height={goalH} />
      {/* right box */}
      <rect x={width - 4 - boxW} y={(height - boxH) / 2} width={boxW} height={boxH} />
      <rect x={width - 4 - goalW} y={(height - goalH) / 2} width={goalW} height={goalH} />
    </g>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}
