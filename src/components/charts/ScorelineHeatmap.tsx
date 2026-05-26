'use client'

import { useChartTheme } from './theme'
import { cn } from '@/lib/utils'

interface ScorelineHeatmapProps {
  /** 2D probability grid — `grid[h][a]` = P(home scores `h`, away scores `a`). */
  grid: number[][]
  /** Optional team names for axis labels. */
  homeLabel?: string
  awayLabel?: string
  /** Maximum scoreline cell size in px. */
  cellSize?: number
  className?: string
}

/**
 * Poisson-style scoreline grid (rows = home goals, cols = away goals).
 * Cell color intensity maps to probability; the most likely cell is
 * highlighted with a ring.
 */
export function ScorelineHeatmap({
  grid,
  homeLabel = 'Home',
  awayLabel = 'Away',
  cellSize = 36,
  className,
}: ScorelineHeatmapProps) {
  const theme = useChartTheme()
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  if (rows === 0 || cols === 0) return null

  const max = Math.max(...grid.flat())
  // Locate winner cell
  let maxIdx: [number, number] = [0, 0]
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === max) maxIdx = [r, c]
    }
  }

  return (
    <div className={cn('inline-block', className)}>
      <div className="flex items-end gap-2">
        <span className="rotate-180 [writing-mode:vertical-rl] py-2 text-caption font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          {homeLabel} goals
        </span>
        <div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: `28px repeat(${cols}, ${cellSize}px)`,
              gridAutoRows: `${cellSize}px`,
              gap: 2,
            }}
          >
            {/* corner */}
            <div />
            {/* away header */}
            {Array.from({ length: cols }).map((_, c) => (
              <div
                key={`hcol-${c}`}
                className="flex items-center justify-center text-caption font-mono text-[var(--text-tertiary)]"
              >
                {c}
              </div>
            ))}
            {grid.map((row, r) => (
              <FragmentRow key={r} rowIdx={r} row={row} max={max} maxIdx={maxIdx} theme={theme} />
            ))}
          </div>
          <p className="mt-1 text-center text-caption font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            {awayLabel} goals
          </p>
        </div>
      </div>
    </div>
  )
}

function FragmentRow({
  rowIdx,
  row,
  max,
  maxIdx,
  theme,
}: {
  rowIdx: number
  row: number[]
  max: number
  maxIdx: [number, number]
  theme: ReturnType<typeof useChartTheme>
}) {
  return (
    <>
      <div className="flex items-center justify-center text-caption font-mono text-[var(--text-tertiary)]">
        {rowIdx}
      </div>
      {row.map((p, c) => {
        const intensity = max > 0 ? Math.min(1, p / max) : 0
        const isMax = rowIdx === maxIdx[0] && c === maxIdx[1]
        const isDraw = rowIdx === c
        const baseColor = rowIdx > c ? theme.home : rowIdx < c ? theme.away : theme.draw
        return (
          <div
            key={`${rowIdx}-${c}`}
            title={`${rowIdx}-${c}: ${(p * 100).toFixed(1)}%`}
            className={cn(
              'flex items-center justify-center rounded-md font-mono text-[10px] font-semibold tabular-nums transition-transform',
              isMax && 'ring-2 ring-offset-1 ring-offset-[var(--card-bg)]'
            )}
            style={{
              backgroundColor: `color-mix(in srgb, ${baseColor} ${Math.round(intensity * 90)}%, transparent)`,
              color: intensity > 0.4 ? '#fff' : 'var(--text-secondary)',
              borderColor: isDraw ? theme.draw : 'transparent',
            }}
          >
            {p > 0.005 ? `${(p * 100).toFixed(0)}` : ''}
          </div>
        )
      })}
    </>
  )
}
