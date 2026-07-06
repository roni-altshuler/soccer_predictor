'use client'

import { useMemo, useState } from 'react'
import { Group } from '@visx/group'
import { scaleBand } from '@visx/scale'
import { AxisLeft, AxisTop } from '@visx/axis'
import { ParentSize } from '@visx/responsive'

import { cn } from '@/lib/utils'

export interface ScorelineCell {
  /** Home goals for this cell (values above `maxGoals` are bucketed into the last row). */
  home: number
  /** Away goals for this cell. */
  away: number
  /** Probability of this exact scoreline, 0–1. */
  probability: number
}

interface ScorelineHeatmapProps {
  cells: ScorelineCell[]
  /** Model's headline scoreline — outlined in the grid. Defaults to the peak cell. */
  predicted?: { home: number; away: number }
  /** Grid extent per axis; the last band is "N+" (default 5). */
  maxGoals?: number
  className?: string
}

interface GridCell {
  home: number
  away: number
  probability: number
}

function buildGrid(cells: ScorelineCell[], maxGoals: number): GridCell[] {
  const grid = new Map<string, GridCell>()
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      grid.set(`${h}-${a}`, { home: h, away: a, probability: 0 })
    }
  }
  for (const c of cells) {
    if (!Number.isFinite(c.probability) || c.probability <= 0) continue
    const h = Math.min(Math.max(0, Math.trunc(c.home)), maxGoals)
    const a = Math.min(Math.max(0, Math.trunc(c.away)), maxGoals)
    const cell = grid.get(`${h}-${a}`)
    if (cell) cell.probability += c.probability
  }
  return Array.from(grid.values())
}

function goalLabel(n: number, maxGoals: number): string {
  return n >= maxGoals ? `${maxGoals}+` : String(n)
}

interface HeatmapInnerProps {
  width: number
  grid: GridCell[]
  maxGoals: number
  peak: { home: number; away: number } | null
  maxP: number
}

function HeatmapInner({ width, grid, maxGoals, peak, maxP }: HeatmapInnerProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const margin = { top: 40, right: 8, bottom: 8, left: 40 }
  const innerW = Math.max(0, width - margin.left - margin.right)
  const cellSide = innerW / (maxGoals + 1)
  const innerH = cellSide * (maxGoals + 1)
  const height = innerH + margin.top + margin.bottom
  const domain = Array.from({ length: maxGoals + 1 }, (_, i) => String(i))

  const xScale = scaleBand({ domain, range: [0, innerW], padding: 0.06 })
  const yScale = scaleBand({ domain, range: [0, innerH], padding: 0.06 })

  return (
    <svg width={width} height={height} role="img" aria-label="Scoreline probability grid">
      <Group left={margin.left} top={margin.top}>
        {grid.map((cell) => {
          const key = `${cell.home}-${cell.away}`
          const x = xScale(String(cell.away)) ?? 0
          const y = yScale(String(cell.home)) ?? 0
          const t = maxP > 0 ? cell.probability / maxP : 0
          const isPeak = peak !== null && cell.home === peak.home && cell.away === peak.away
          const isHovered = hovered === key
          const fill =
            cell.probability <= 0
              ? 'var(--muted-bg)'
              : `color-mix(in srgb, var(--accent-ai) ${Math.round(t * 82)}%, var(--card-bg))`
          const showLabel = isHovered || isPeak || t >= 0.55
          return (
            <g
              key={key}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered((prev) => (prev === key ? null : prev))}
            >
              <rect
                x={x}
                y={y}
                width={xScale.bandwidth()}
                height={yScale.bandwidth()}
                rx={3}
                fill={fill}
                stroke={isPeak ? 'var(--accent-ai)' : isHovered ? 'var(--border-hover)' : 'transparent'}
                strokeWidth={isPeak ? 1.5 : 1}
              >
                <title>
                  {`${goalLabel(cell.home, maxGoals)}–${goalLabel(cell.away, maxGoals)}: ${(cell.probability * 100).toFixed(1)}%`}
                </title>
              </rect>
              {showLabel && cell.probability > 0 && (
                <text
                  x={x + xScale.bandwidth() / 2}
                  y={y + yScale.bandwidth() / 2}
                  className="tabular-nums"
                  fill={t >= 0.5 ? 'var(--accent-on-primary)' : 'var(--text-primary)'}
                  fontSize={10}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  pointerEvents="none"
                >
                  {(cell.probability * 100).toFixed(cell.probability >= 0.095 ? 0 : 1)}%
                </text>
              )}
            </g>
          )
        })}
        <AxisTop
          scale={xScale}
          stroke="var(--border-color)"
          tickStroke="var(--border-color)"
          tickFormat={(v) => goalLabel(Number(v), maxGoals)}
          tickLabelProps={{
            fill: 'var(--text-tertiary)',
            fontSize: 10,
            textAnchor: 'middle',
            dy: '-0.4em',
          }}
          label="Away goals"
          labelOffset={18}
          labelProps={{
            fill: 'var(--text-tertiary)',
            fontSize: 10,
            textAnchor: 'middle',
          }}
        />
        <AxisLeft
          scale={yScale}
          stroke="var(--border-color)"
          tickStroke="var(--border-color)"
          tickFormat={(v) => goalLabel(Number(v), maxGoals)}
          tickLabelProps={{
            fill: 'var(--text-tertiary)',
            fontSize: 10,
            textAnchor: 'end',
            dx: '-0.4em',
            dy: '0.33em',
          }}
          label="Home goals"
          labelOffset={22}
          labelProps={{
            fill: 'var(--text-tertiary)',
            fontSize: 10,
            textAnchor: 'middle',
          }}
        />
      </Group>
    </svg>
  )
}

/**
 * Home-goals × away-goals scoreline probability grid.
 *
 * Renders the model's full scoreline distribution for one fixture: rows are
 * home goals (0…N+), columns away goals, each cell tinted by probability via
 * `color-mix` over `var(--accent-ai)` (this is AI prediction data — cyan only).
 * The model's headline scoreline (or the peak cell when `predicted` is
 * omitted) gets a cyan outline. Exact tabular percentages appear on hover and
 * on high-probability cells; every cell also carries a native tooltip.
 *
 * Feed it `MatchPrediction.scorelineDistribution`-shaped data; probabilities
 * above `maxGoals` are bucketed into the "N+" band so mass is never dropped.
 */
export function ScorelineHeatmap({
  cells,
  predicted,
  maxGoals = 5,
  className,
}: ScorelineHeatmapProps) {
  const grid = useMemo(() => buildGrid(cells, maxGoals), [cells, maxGoals])
  const maxP = useMemo(() => Math.max(0, ...grid.map((c) => c.probability)), [grid])
  const peak = useMemo(() => {
    if (predicted) {
      return {
        home: Math.min(Math.max(0, Math.trunc(predicted.home)), maxGoals),
        away: Math.min(Math.max(0, Math.trunc(predicted.away)), maxGoals),
      }
    }
    if (maxP <= 0) return null
    const top = grid.find((c) => c.probability === maxP)
    return top ? { home: top.home, away: top.away } : null
  }, [predicted, grid, maxP, maxGoals])

  if (maxP <= 0) return null

  return (
    <div className={cn('w-full max-w-md', className)}>
      <ParentSize debounceTime={10}>
        {({ width }) =>
          width > 0 ? (
            <HeatmapInner width={width} grid={grid} maxGoals={maxGoals} peak={peak} maxP={maxP} />
          ) : null
        }
      </ParentSize>
    </div>
  )
}

export default ScorelineHeatmap
