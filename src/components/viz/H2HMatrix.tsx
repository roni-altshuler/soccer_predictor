'use client'

import { Group } from '@visx/group'
import { scaleBand } from '@visx/scale'
import { AxisLeft, AxisTop } from '@visx/axis'
import { ParentSize } from '@visx/responsive'

import { cn } from '@/lib/utils'

export interface H2HEntity {
  /** Stable id (team slug / ESPN id). */
  id: string
  /** Team name — initials are derived from it when no crest is available. */
  label: string
  /** Optional crest URL rendered as the axis tick. */
  crestUrl?: string
}

interface H2HMatrixProps {
  /** Row/column order of the matrix. */
  entities: H2HEntity[]
  /**
   * `matrix[i][j]` = P(entities[i] beats entities[j]), 0–1.
   * Diagonal (and unknown pairs) should be `null`.
   */
  matrix: ReadonlyArray<ReadonlyArray<number | null>>
  className?: string
}

function initials(label: string): string {
  const words = label.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0] + (words[2]?.[0] ?? '')).toUpperCase()
  return label.slice(0, 3).toUpperCase()
}

interface TickProps {
  x?: number
  y?: number
  formattedValue?: string
}

function makeTick(
  entities: H2HEntity[],
  placement: 'left' | 'top',
  band: number,
): (props: TickProps) => React.ReactElement {
  const byId = new Map(entities.map((e) => [e.id, e]))
  const TickComponent = ({ x = 0, y = 0, formattedValue }: TickProps) => {
    const entity = byId.get(formattedValue ?? '')
    const size = Math.min(22, Math.max(12, band - 8))
    if (entity?.crestUrl) {
      const ix = placement === 'left' ? x - size - 4 : x - size / 2
      const iy = placement === 'left' ? y - size / 2 : y - size - 4
      return (
        <image
          href={entity.crestUrl}
          x={ix}
          y={iy}
          width={size}
          height={size}
          preserveAspectRatio="xMidYMid meet"
        >
          <title>{entity.label}</title>
        </image>
      )
    }
    return (
      <text
        x={x}
        y={y}
        dy={placement === 'left' ? '0.33em' : '-0.4em'}
        textAnchor={placement === 'left' ? 'end' : 'middle'}
        fontSize={10}
        fontWeight={700}
        fill="var(--text-secondary)"
      >
        {entity ? initials(entity.label) : formattedValue}
      </text>
    )
  }
  TickComponent.displayName = `H2HMatrixTick(${placement})`
  return TickComponent
}

interface MatrixInnerProps extends Pick<H2HMatrixProps, 'entities' | 'matrix'> {
  width: number
  height: number
}

function MatrixInner({ width, height, entities, matrix }: MatrixInnerProps) {
  const margin = { top: 40, right: 8, bottom: 8, left: 40 }
  const innerW = Math.max(0, width - margin.left - margin.right)
  const innerH = Math.max(0, height - margin.top - margin.bottom)
  const axis = scaleBand({
    domain: entities.map((e) => e.id),
    range: [0, Math.min(innerW, innerH)],
    padding: 0.08,
  })
  const band = axis.bandwidth()

  return (
    <svg width={width} height={height} role="img" aria-label="Head-to-head win probability matrix">
      <Group left={margin.left} top={margin.top}>
        {matrix.map((row, rowIdx) =>
          row.map((cell, colIdx) => {
            const a = entities[rowIdx]
            const b = entities[colIdx]
            if (!a || !b) return null
            const x = axis(b.id) ?? 0
            const y = axis(a.id) ?? 0
            if (cell == null) {
              return (
                <rect
                  key={`d-${a.id}-${b.id}`}
                  x={x}
                  y={y}
                  width={band}
                  height={band}
                  fill="var(--muted-bg)"
                  rx={3}
                />
              )
            }
            const p = Math.min(Math.max(cell, 0), 1)
            const t = Math.abs(p - 0.5) * 2
            const fill =
              p >= 0.5
                ? `color-mix(in srgb, var(--accent-primary) ${Math.round(t * 62 + 8)}%, var(--card-bg))`
                : `color-mix(in srgb, var(--accent-loss) ${Math.round(t * 62 + 8)}%, var(--card-bg))`
            return (
              <g key={`${a.id}-${b.id}`}>
                <rect
                  x={x}
                  y={y}
                  width={band}
                  height={band}
                  fill={fill}
                  stroke="var(--border-color)"
                  strokeWidth={0.5}
                  rx={3}
                >
                  <title>{`${a.label} beats ${b.label}: ${Math.round(p * 100)}%`}</title>
                </rect>
                {band > 26 && (
                  <text
                    x={x + band / 2}
                    y={y + band / 2}
                    className="tabular-nums"
                    fill="var(--text-primary)"
                    fontSize={10}
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="central"
                    pointerEvents="none"
                  >
                    {Math.round(p * 100)}
                  </text>
                )}
              </g>
            )
          }),
        )}
        <AxisTop
          scale={axis}
          stroke="var(--border-color)"
          tickStroke="var(--border-color)"
          tickComponent={makeTick(entities, 'top', band)}
        />
        <AxisLeft
          scale={axis}
          stroke="var(--border-color)"
          tickStroke="var(--border-color)"
          tickComponent={makeTick(entities, 'left', band)}
        />
      </Group>
    </svg>
  )
}

/**
 * N×N "row beats column" probability matrix with a diverging tint.
 *
 * Soccer usage: pairwise win probabilities between title contenders or a
 * cup-bracket pool. Cells above 50% mix towards `var(--accent-primary)`
 * (green, favourable for the row team), below 50% towards `var(--accent-loss)`
 * (red); intensity scales with distance from the coin flip. Axis ticks render
 * club crests when supplied and derived initials otherwise. Every cell carries
 * a native tooltip with the exact percentage.
 */
export function H2HMatrix({ entities, matrix, className }: H2HMatrixProps) {
  if (entities.length === 0) return null
  const heightPx = Math.max(280, 36 * entities.length + 72)
  return (
    <div className={cn('w-full max-w-md', className)} style={{ height: heightPx }}>
      <ParentSize debounceTime={10}>
        {({ width, height }) =>
          width > 0 ? (
            <MatrixInner width={width} height={height} entities={entities} matrix={matrix} />
          ) : null
        }
      </ParentSize>
    </div>
  )
}

export default H2HMatrix
