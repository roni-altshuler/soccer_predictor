'use client'

import { motion } from 'framer-motion'

import { SectionHeader } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { CalibrationDotPoint } from '@/lib/types/accuracy'
import { cn, clamp, formatPct } from '@/lib/utils'

/**
 * Calibration plot — predicted probability vs observed frequency in
 * binned buckets. A perfectly calibrated model lies on the diagonal.
 *
 * Renders as a stylised SVG so it stays consistent with the rest of the
 * design system rather than dropping into a Recharts canvas. Each bucket
 * is a square plotted at its (predicted, actual) position; size scales
 * with how many predictions landed in the bucket.
 */

// Backwards-compat alias for the dot-plot bin shape. Canonical definition
// lives in src/lib/types/accuracy.ts so the route emitter and the
// component stay in lockstep.
export type CalibrationBin = CalibrationDotPoint

interface CalibrationPlotProps {
  bins: CalibrationBin[]
  className?: string
}

export function CalibrationPlot({ bins, className }: CalibrationPlotProps) {
  // Plot dimensions — fits comfortably inside a card on mobile.
  const width = 360
  const height = 360
  const padding = 40
  const inner = width - 2 * padding
  const maxCount = Math.max(1, ...bins.map((b) => b.count))

  const xScale = (v: number) => padding + clamp(v) * inner
  const yScale = (v: number) => height - padding - clamp(v) * inner

  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <SectionHeader
        kicker="Probability audit"
        title="Calibration"
        className="mb-3"
        action={
          <p className="text-[10px] text-[var(--text-tertiary)]">
            On the diagonal = perfectly calibrated
          </p>
        }
      />

      {bins.length === 0 ? (
        <div className="flex h-[360px] items-center justify-center rounded-lg border border-dashed border-[var(--border-color)] text-sm text-[var(--text-tertiary)]">
          Not enough completed predictions to plot calibration yet.
        </div>
      ) : (
        <TooltipProvider delayDuration={150}>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Model calibration plot" className="w-full">
            {/* Background grid */}
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line
                  x1={xScale(0)}
                  x2={xScale(1)}
                  y1={yScale(t)}
                  y2={yScale(t)}
                  stroke="var(--border-color)"
                  strokeOpacity="0.3"
                  strokeDasharray="2 4"
                />
                <line
                  x1={xScale(t)}
                  x2={xScale(t)}
                  y1={yScale(0)}
                  y2={yScale(1)}
                  stroke="var(--border-color)"
                  strokeOpacity="0.3"
                  strokeDasharray="2 4"
                />
                <text
                  x={xScale(t)}
                  y={height - padding + 14}
                  textAnchor="middle"
                  className="fill-[var(--text-tertiary)] text-[10px] tabular-nums"
                >
                  {formatPct(t)}
                </text>
                <text
                  x={padding - 6}
                  y={yScale(t) + 3}
                  textAnchor="end"
                  className="fill-[var(--text-tertiary)] text-[10px] tabular-nums"
                >
                  {formatPct(t)}
                </text>
              </g>
            ))}

            {/* Diagonal reference */}
            <line
              x1={xScale(0)}
              x2={xScale(1)}
              y1={yScale(0)}
              y2={yScale(1)}
              stroke="var(--accent-ai)"
              strokeOpacity="0.5"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />

            {/* Bucket markers */}
            {bins.map((b, idx) => {
              const r = 4 + 8 * (b.count / maxCount)
              const cx = xScale(b.avg_predicted)
              const cy = yScale(b.avg_actual)
              return (
                <Tooltip key={idx}>
                  <TooltipTrigger asChild>
                    <motion.circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="var(--accent-primary)"
                      fillOpacity="0.6"
                      stroke="var(--accent-primary)"
                      strokeWidth="1.5"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.3, delay: idx * 0.04, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-semibold">
                      Bucket {formatPct(b.bin_lower)} – {formatPct(b.bin_upper)}
                    </p>
                    <p className="text-[11px] opacity-80">
                      Predicted {formatPct(b.avg_predicted)} · happened {formatPct(b.avg_actual)} · {b.count} picks
                    </p>
                  </TooltipContent>
                </Tooltip>
              )
            })}

            {/* Axis labels */}
            <text
              x={width / 2}
              y={height - 6}
              textAnchor="middle"
              className="fill-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wider"
            >
              Predicted probability
            </text>
            <text
              x={-height / 2}
              y={12}
              textAnchor="middle"
              transform="rotate(-90)"
              className="fill-[var(--text-secondary)] text-[11px] font-semibold uppercase tracking-wider"
            >
              Observed frequency
            </text>
          </svg>
        </TooltipProvider>
      )}
    </Card>
  )
}
