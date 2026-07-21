'use client'

import { useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { CalibrationDotPoint } from '@/lib/types/accuracy'
import { cn, clamp } from '@/lib/utils'

import { MIN_BIN_SAMPLE, calibrationVerdict, count, pct0, samplePhrase } from './accuracyMetrics'

/**
 * The page's one primary chart: stated chance against what actually
 * happened, with the sample behind every point shown directly underneath.
 *
 * Why this replaced the old scatter — the previous plot drew every
 * probability bucket as an equally authoritative dot, so a bucket holding
 * one match (0.8–0.9, delivered 0%) sat at the edge of the chart looking
 * exactly as meaningful as a bucket holding 657. Readers had no way to see
 * where the evidence actually was.
 *
 * Two fixes, both structural:
 *   - Buckets under MIN_BIN_SAMPLE draw hollow and are excluded from the
 *     headline read; they are visible but plainly marked as thin.
 *   - A sample histogram shares the chart's x-axis, so the distribution of
 *     evidence is part of the chart rather than a footnote.
 */

interface ReliabilityPanelProps {
  bins: CalibrationDotPoint[]
  /** Expected calibration gap 0..1. */
  gap: number | null
  /** Total settled picks — drives the honesty caveat. */
  settled: number
  className?: string
}

/** Within this distance of the diagonal a bucket counts as on target. */
const ON_TARGET = 0.05

export function ReliabilityPanel({ bins, gap, settled, className }: ReliabilityPanelProps) {
  const reduce = useReducedMotion()

  const { solid, thin, maxCount } = useMemo(() => {
    const usable = bins.filter((b) => b.count > 0)
    return {
      solid: usable.filter((b) => b.count >= MIN_BIN_SAMPLE),
      thin: usable.filter((b) => b.count < MIN_BIN_SAMPLE),
      maxCount: Math.max(1, ...usable.map((b) => b.count)),
    }
  }, [bins])

  // A verdict needs at least one group with real evidence behind it. In the
  // women's universe every group is under the threshold, so stating
  // "percentages drift from reality" there would be a conclusion drawn
  // entirely from groups the chart itself marks as unreadable.
  const verdict = solid.length > 0 ? calibrationVerdict(gap, settled) : null

  // Geometry — the plot area is kept square so the diagonal really is 45°
  // and "distance from the line" reads as distance. A sample rail sits
  // below it, separated by a gutter so it never collides with the axis.
  const PAD_L = 32
  const PAD_R = 12
  // Headroom so the 100% tick label and any dot sitting on the top edge
  // are not clipped by the viewBox.
  const PAD_T = 10
  const SQUARE = 250
  const W = PAD_L + SQUARE + PAD_R
  const GUTTER = 18
  const HIST = 34
  const PAD_B = 22
  const H = PAD_T + SQUARE + GUTTER + HIST + PAD_B
  const inner = SQUARE

  const x = (v: number) => PAD_L + clamp(v) * inner
  const y = (v: number) => PAD_T + SQUARE - clamp(v) * SQUARE
  const histTop = PAD_T + SQUARE + GUTTER

  const hasAny = solid.length > 0 || thin.length > 0

  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-[var(--text-primary)]">
            Stated chance vs what happened
          </h2>
          <p className="mt-0.5 max-w-md text-[12px] leading-snug text-[var(--text-secondary)]">
            Each point is a group of picks. Points on the dashed line mean a stated 60% chance came
            true about 60% of the time.
          </p>
        </div>
        {gap !== null && (
          <div className="shrink-0 text-right">
            <p className="text-[18px] font-bold leading-none tabular-nums text-[var(--text-primary)]">
              ±{(gap * 100).toFixed(1)} pts
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Average gap
            </p>
          </div>
        )}
      </div>

      {!hasAny ? (
        <p className="rounded-lg border border-dashed border-[var(--border-color)] px-4 py-8 text-center text-[12px] text-[var(--text-tertiary)]">
          No settled picks yet, so there is nothing to compare stated chances against.
        </p>
      ) : (
        <TooltipProvider delayDuration={150}>
          {/* Chart and its key sit side by side on wide screens. The plot is
              capped because it is square: unconstrained it inflated to the
              full card width and became a 660px-tall chart that was mostly
              empty space above the data. */}
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-7">
          <div className="mx-auto w-full max-w-[360px] shrink-0 lg:mx-0">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={`Stated chance against observed frequency across ${count(
                solid.length + thin.length
              )} groups of picks`}
              className="w-full"
            >
              {/* Grid + axis ticks */}
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <g key={t}>
                  <line
                    x1={x(0)}
                    x2={x(1)}
                    y1={y(t)}
                    y2={y(t)}
                    stroke="var(--border-color)"
                    strokeOpacity="0.4"
                  />
                  <text
                    x={PAD_L - 6}
                    y={y(t) + 3}
                    textAnchor="end"
                    className="fill-[var(--text-tertiary)] text-[9px] tabular-nums"
                  >
                    {pct0(t)}
                  </text>
                  <text
                    x={x(t)}
                    y={H - 12}
                    textAnchor="middle"
                    className="fill-[var(--text-tertiary)] text-[9px] tabular-nums"
                  >
                    {pct0(t)}
                  </text>
                </g>
              ))}

              {/* Perfect-agreement reference */}
              <line
                x1={x(0)}
                x2={x(1)}
                y1={y(0)}
                y2={y(1)}
                stroke="var(--accent-ai)"
                strokeOpacity="0.55"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />

              {/* Thin buckets first, so well-evidenced points draw on top. */}
              {thin.map((b, i) => (
                <Tooltip key={`thin-${i}`}>
                  <TooltipTrigger asChild>
                    <circle
                      cx={x(b.avg_predicted)}
                      cy={y(b.avg_actual)}
                      r={4}
                      fill="none"
                      stroke="var(--text-tertiary)"
                      strokeOpacity="0.5"
                      strokeDasharray="2 2"
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-semibold">
                      {pct0(b.bin_lower)}–{pct0(b.bin_upper)} stated
                    </p>
                    <p className="text-[11px] opacity-80">
                      Only {samplePhrase(b.count, 'pick')} — too few to read anything into.
                    </p>
                  </TooltipContent>
                </Tooltip>
              ))}

              {solid.map((b, i) => {
                const diff = b.avg_actual - b.avg_predicted
                const onTarget = Math.abs(diff) <= ON_TARGET
                const color = onTarget
                  ? 'var(--accent-primary)'
                  : diff < 0
                    ? 'var(--accent-warn)'
                    : 'var(--accent-info)'
                const r = 5 + 7 * (b.count / maxCount)
                return (
                  <Tooltip key={`solid-${i}`}>
                    <TooltipTrigger asChild>
                      <motion.circle
                        cx={x(b.avg_predicted)}
                        cy={y(b.avg_actual)}
                        r={r}
                        fill={color}
                        fillOpacity="0.5"
                        stroke={color}
                        strokeWidth="1.5"
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, delay: i * 0.05 }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-semibold">
                        {pct0(b.bin_lower)}–{pct0(b.bin_upper)} stated
                      </p>
                      <p className="text-[11px] opacity-80">
                        Came true {pct0(b.avg_actual)} of the time · {samplePhrase(b.count, 'pick')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )
              })}

              {/* Sample rail — where the evidence actually sits. Bars hang
                  from a baseline below the plot so the distribution reads
                  as part of the chart, not a separate figure. */}
              <line
                x1={x(0)}
                x2={x(1)}
                y1={histTop}
                y2={histTop}
                stroke="var(--border-color)"
              />
              {[...solid, ...thin].map((b, i) => {
                const h = Math.max(1.5, (b.count / maxCount) * HIST)
                const bw = Math.max(5, inner / 14)
                return (
                  <rect
                    key={`hist-${i}`}
                    x={x((b.bin_lower + b.bin_upper) / 2) - bw / 2}
                    y={histTop + 1}
                    width={bw}
                    height={h}
                    rx={1.5}
                    fill="var(--text-tertiary)"
                    fillOpacity={b.count >= MIN_BIN_SAMPLE ? 0.5 : 0.2}
                  />
                )
              })}
              <text
                x={PAD_L - 6}
                y={histTop + 9}
                textAnchor="end"
                className="fill-[var(--text-tertiary)] text-[9px]"
              >
                n
              </text>
            </svg>
          </div>

          {/* Key + honest read */}
          <div className="min-w-0 flex-1">
            {verdict ? (
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                <span
                  className={cn(
                    'font-semibold',
                    verdict.tone === 'good'
                      ? 'text-[var(--accent-primary)]'
                      : verdict.tone === 'fair'
                        ? 'text-[var(--accent-warn)]'
                        : 'text-[var(--accent-loss)]'
                  )}
                >
                  {verdict.label}
                </span>{' '}
                — measured across {samplePhrase(settled)}
                {thin.length > 0 &&
                  `, excluding ${thin.length} group${thin.length === 1 ? '' : 's'} too thin to read`}
                .
              </p>
            ) : (
              <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text-primary)]">
                  Not enough settled picks to judge this yet
                </span>{' '}
                — every group below holds fewer than {MIN_BIN_SAMPLE} picks, so the points are
                plotted but no read is drawn from them.
              </p>
            )}

            <dl className="mt-4 space-y-2 border-t border-[var(--border-color)] pt-4 text-[11px] text-[var(--text-tertiary)]">
              <LegendDot color="var(--accent-primary)" label="Within 5 pts of the stated chance" />
              <LegendDot
                color="var(--accent-warn)"
                label="Came true less often than stated"
              />
              <LegendDot
                color="var(--accent-info)"
                label="Came true more often than stated"
              />
              {thin.length > 0 && (
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-[var(--text-tertiary)]"
                  />
                  <span>Fewer than {MIN_BIN_SAMPLE} picks — shown, not read</span>
                </div>
              )}
              <p className="pt-1 leading-snug">
                Dot size and bar height both show how many picks sit behind a point.
              </p>
            </dl>
          </div>
          </div>
        </TooltipProvider>
      )}
    </Card>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
    </div>
  )
}
