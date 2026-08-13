'use client'

import { motion, useReducedMotion } from 'framer-motion'

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
 * design system. Each bucket is a dot at its (predicted, actual) position;
 * radius scales with bucket sample size, and colour encodes where the
 * bucket sits relative to the diagonal: on target (within ±5pts),
 * overconfident (delivered less than stated), or underconfident.
 */

// Backwards-compat alias for the dot-plot bin shape. Canonical definition
// lives in src/lib/types/accuracy.ts so the route emitter and the
// component stay in lockstep.
export type CalibrationBin = CalibrationDotPoint

/** Buckets within ±5pts of the diagonal count as "on target". */
const ON_TARGET_PTS = 0.05

interface CalibrationPlotProps {
  bins: CalibrationBin[]
  /** Expected calibration error 0..1 — renders the header chip when set. */
  ece?: number | null
  className?: string
}

type BinTone = 'onTarget' | 'over' | 'under'

function toneFor(b: CalibrationDotPoint): BinTone {
  const diff = b.avg_actual - b.avg_predicted
  if (Math.abs(diff) <= ON_TARGET_PTS) return 'onTarget'
  return diff < 0 ? 'over' : 'under'
}

const TONE_COLOR: Record<BinTone, string> = {
  onTarget: 'var(--accent-primary)',
  over: 'var(--accent-warn)',
  under: 'var(--accent-info)',
}

const TONE_LABEL: Record<BinTone, string> = {
  onTarget: 'on target',
  over: 'overconfident',
  under: 'underconfident',
}

export function CalibrationPlot({ bins, ece, className }: CalibrationPlotProps) {
  const reduce = useReducedMotion()
  // Plot dimensions — fits comfortably inside a card on mobile.
  const width = 360
  const height = 360
  const padding = 40
  const inner = width - 2 * padding
  const maxCount = Math.max(1, ...bins.map((b) => b.count))

  const xScale = (v: number) => padding + clamp(v) * inner
  const yScale = (v: number) => height - padding - clamp(v) * inner

  // ±5pt band around the diagonal, clipped to the unit square.
  const bandPoints = [
    `${xScale(0)},${yScale(ON_TARGET_PTS)}`,
    `${xScale(1 - ON_TARGET_PTS)},${yScale(1)}`,
    `${xScale(1)},${yScale(1)}`,
    `${xScale(1)},${yScale(1 - ON_TARGET_PTS)}`,
    `${xScale(ON_TARGET_PTS)},${yScale(0)}`,
    `${xScale(0)},${yScale(0)}`,
  ].join(' ')

  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <SectionHeader
        kicker="Reality check"
        title="Do the percentages hold up?"
        className="mb-3"
        action={
          typeof ece === 'number' && bins.length > 0 ? (
            <span className="inline-flex items-center rounded-full border border-[var(--border-color)] bg-[color-mix(in_srgb,var(--muted-bg)_60%,transparent)] px-2 py-1 text-[10px] font-semibold tabular-nums text-[var(--text-secondary)]">
              Calibration error ±{(ece * 100).toFixed(1)}pts
            </span>
          ) : (
            <p className="text-[10px] text-[var(--text-tertiary)]">
              On the diagonal = 60% picks win about 60% of the time
            </p>
          )
        }
      />

      {bins.length === 0 ? (
        <div className="flex h-[360px] items-center justify-center rounded-lg border border-dashed border-[var(--border-color)] text-sm text-[var(--text-tertiary)]">
          Not enough completed predictions to plot this yet.
        </div>
      ) : (
        <TooltipProvider delayDuration={150}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Stated confidence versus actual results, per confidence bucket"
            className="w-full"
          >
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

            {/* ±5pt tolerance band around the diagonal */}
            <polygon points={bandPoints} fill="var(--accent-primary)" fillOpacity="0.07" />

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
              const tone = toneFor(b)
              const color = TONE_COLOR[tone]
              return (
                <Tooltip key={idx}>
                  <TooltipTrigger asChild>
                    <motion.circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={color}
                      fillOpacity="0.55"
                      stroke={color}
                      strokeWidth="1.5"
                      initial={reduce ? false : { scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.3, delay: idx * 0.04, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-semibold">
                      Bucket {formatPct(b.bin_lower)} – {formatPct(b.bin_upper)}
                    </p>
                    <p className="text-[11px] opacity-80">
                      Predicted {formatPct(b.avg_predicted)} · happened {formatPct(b.avg_actual)} ·{' '}
                      {b.count} picks · {TONE_LABEL[tone]}
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

          {/* Dot-colour legend */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--text-tertiary)]">
            {(['onTarget', 'over', 'under'] as const).map((tone) => (
              <span key={tone} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: TONE_COLOR[tone] }}
                />
                {tone === 'onTarget' ? 'On target (±5pts)' : TONE_LABEL[tone][0].toUpperCase() + TONE_LABEL[tone].slice(1)}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full border border-[var(--text-tertiary)]" />
              Dot size = sample size
            </span>
          </div>
        </TooltipProvider>
      )}
    </Card>
  )
}
