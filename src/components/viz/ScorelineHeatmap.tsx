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

/** A scoreline the reader has picked — by cell, chip or keyboard. */
export interface ScorelinePick {
  home: number
  away: number
}

interface ScorelineHeatmapProps {
  cells: ScorelineCell[]
  /** Model's headline scoreline — outlined in the grid. Defaults to the peak cell. */
  predicted?: { home: number; away: number }
  /** Grid extent per axis; the last band is "N+" (default 5). */
  maxGoals?: number
  /**
   * The picked scoreline, when the parent owns it (so chips outside the grid
   * and cells inside it agree). Uncontrolled when omitted.
   */
  selected?: ScorelinePick | null
  onSelect?: (pick: ScorelinePick | null) => void
  /** The exact-probability line under the grid (default on). */
  readout?: boolean
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

const clampGoal = (n: number, maxGoals: number) => Math.min(Math.max(0, Math.trunc(n)), maxGoals)

/** "12.3%" — one decimal, the precision the calibration supports. */
export const scorelinePct = (p: number) => `${(p * 100).toFixed(1)}%`

interface HeatmapInnerProps {
  width: number
  grid: GridCell[]
  maxGoals: number
  peak: { home: number; away: number } | null
  maxP: number
  selected: ScorelinePick | null
  onSelect: (pick: ScorelinePick | null) => void
  readout: boolean
}

function HeatmapInner({
  width,
  grid,
  maxGoals,
  peak,
  maxP,
  selected,
  onSelect,
  readout,
}: HeatmapInnerProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const margin = { top: 40, right: 8, bottom: 8, left: 40 }
  const innerW = Math.max(0, width - margin.left - margin.right)
  const cellSide = innerW / (maxGoals + 1)
  const innerH = cellSide * (maxGoals + 1)
  const height = innerH + margin.top + margin.bottom
  const domain = Array.from({ length: maxGoals + 1 }, (_, i) => String(i))

  const xScale = scaleBand({ domain, range: [0, innerW], padding: 0.06 })
  const yScale = scaleBand({ domain, range: [0, innerH], padding: 0.06 })

  const selectedKey = selected
    ? `${clampGoal(selected.home, maxGoals)}-${clampGoal(selected.away, maxGoals)}`
    : null
  // What the readout names: the cell under the pointer, else the picked one,
  // else the peak — so the line is never empty while there is a grid.
  const focusKey = hovered ?? selectedKey ?? (peak ? `${peak.home}-${peak.away}` : null)
  const focusCell = focusKey ? grid.find((c) => `${c.home}-${c.away}` === focusKey) ?? null : null

  const pick = (cell: GridCell) => {
    const key = `${cell.home}-${cell.away}`
    onSelect(key === selectedKey ? null : { home: cell.home, away: cell.away })
  }

  return (
    <div>
      <svg width={width} height={height} role="img" aria-label="Scoreline probability grid">
        <Group left={margin.left} top={margin.top}>
          {grid.map((cell) => {
            const key = `${cell.home}-${cell.away}`
            const x = xScale(String(cell.away)) ?? 0
            const y = yScale(String(cell.home)) ?? 0
            const t = maxP > 0 ? cell.probability / maxP : 0
            const isPeak = peak !== null && cell.home === peak.home && cell.away === peak.away
            const isHovered = hovered === key
            const isSelected = selectedKey === key
            const fill =
              cell.probability <= 0
                ? 'var(--muted-bg)'
                : `color-mix(in srgb, var(--accent-ai) ${Math.round(t * 82)}%, var(--card-bg))`
            const showLabel = isHovered || isSelected || isPeak || t >= 0.55
            const name = `${goalLabel(cell.home, maxGoals)}-${goalLabel(cell.away, maxGoals)}`
            return (
              <g
                key={key}
                role="button"
                tabIndex={0}
                aria-label={`${name}: ${scorelinePct(cell.probability)}`}
                aria-pressed={isSelected}
                className="cursor-pointer outline-none"
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered((prev) => (prev === key ? null : prev))}
                onFocus={() => setHovered(key)}
                onBlur={() => setHovered((prev) => (prev === key ? null : prev))}
                onClick={() => pick(cell)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    pick(cell)
                  }
                }}
              >
                <rect
                  x={x}
                  y={y}
                  width={xScale.bandwidth()}
                  height={yScale.bandwidth()}
                  rx={3}
                  fill={fill}
                  stroke={
                    isSelected
                      ? 'var(--text-primary)'
                      : isPeak
                        ? 'var(--accent-ai)'
                        : isHovered
                          ? 'var(--border-hover)'
                          : 'transparent'
                  }
                  strokeWidth={isSelected || isPeak ? 1.5 : 1}
                >
                  <title>{`${name}: ${scorelinePct(cell.probability)}`}</title>
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
      {/* The exact number, as text — hover, tap or arrow onto a cell. */}
      {readout ? (
        <p
          data-scoreline-readout
          aria-live="polite"
          className="mt-1.5 flex items-baseline justify-between gap-3 font-mono text-[11px] tabular-nums"
        >
          <span className="text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            P(score)
          </span>
          {focusCell ? (
            <span className="text-[var(--text-primary)]">
              {goalLabel(focusCell.home, maxGoals)}-{goalLabel(focusCell.away, maxGoals)}
              <span className="mx-1.5 text-[var(--text-tertiary)]">·</span>
              {scorelinePct(focusCell.probability)}
            </span>
          ) : (
            <span className="text-[var(--text-tertiary)]">—</span>
          )}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Home-goals × away-goals scoreline probability grid.
 *
 * Renders the model's full scoreline distribution for one fixture: rows are
 * home goals (0…N+), columns away goals, each cell tinted by probability via
 * `color-mix` over `var(--accent-ai)`. The model's headline scoreline (or the
 * peak cell when `predicted` is omitted) gets an accent outline. Every cell
 * is a button: hover, tap or focus it and the exact percentage reads out
 * under the grid as text; a pick is outlined in primary ink and stays.
 *
 * Feed it `MatchPrediction.scorelineDistribution`-shaped data; probabilities
 * above `maxGoals` are bucketed into the "N+" band so mass is never dropped.
 * Nothing is computed here — every number is a published scoreline
 * probability, read out.
 */
export function ScorelineHeatmap({
  cells,
  predicted,
  maxGoals = 5,
  selected,
  onSelect,
  readout = true,
  className,
}: ScorelineHeatmapProps) {
  const [ownPick, setOwnPick] = useState<ScorelinePick | null>(null)
  const controlled = selected !== undefined
  const pick = controlled ? selected ?? null : ownPick
  const setPick = (next: ScorelinePick | null) => {
    if (!controlled) setOwnPick(next)
    onSelect?.(next)
  }

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
            <HeatmapInner
              width={width}
              grid={grid}
              maxGoals={maxGoals}
              peak={peak}
              maxP={maxP}
              selected={pick}
              onSelect={setPick}
              readout={readout}
            />
          ) : null
        }
      </ParentSize>
    </div>
  )
}

/**
 * The most likely scorelines as chips — the top N of the published list,
 * sorted, each a button that picks its cell in the grid. Reads the raw cells,
 * not the bucketed grid, so a 6-0 chip says 6-0.
 */
export function ScorelineChips({
  cells,
  selected,
  onSelect,
  topN = 5,
  className,
}: {
  cells: ScorelineCell[]
  selected: ScorelinePick | null
  onSelect: (pick: ScorelinePick | null) => void
  topN?: number
  className?: string
}) {
  const top = useMemo(
    () =>
      [...cells]
        .filter((c) => Number.isFinite(c.probability) && c.probability > 0)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, topN),
    [cells, topN],
  )
  if (!top.length) return null
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)} aria-label="Most likely scorelines">
      {top.map((c) => {
        const active = selected !== null && selected.home === c.home && selected.away === c.away
        return (
          <li key={`${c.home}-${c.away}`}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(active ? null : { home: c.home, away: c.away })}
              className={cn(
                'inline-flex min-h-[32px] items-baseline gap-1.5 rounded-md border px-2.5 font-mono text-[11px] tabular-nums transition-colors',
                active
                  ? 'border-[var(--text-primary)] bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]',
              )}
            >
              <span className="font-semibold">
                {c.home}-{c.away}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)]">{scorelinePct(c.probability)}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default ScorelineHeatmap
