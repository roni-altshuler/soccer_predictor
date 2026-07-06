'use client'

import { cn } from '@/lib/utils'

export interface FactorMeterDatum {
  /** Plain-language factor name ("Home form", "Injury list", "Rest days"). */
  label: string
  /** Relative emphasis of this factor, 0–1. */
  value: number
  /** `advantage` renders green; `risk` renders amber with a Risk tag. */
  tone: 'advantage' | 'risk'
  /** Optional one-line explanation under the bar. */
  detail?: string
}

interface FactorMetersProps {
  factors: FactorMeterDatum[]
  /** Tighter spacing for inline use (match-row expansions). */
  compact?: boolean
  className?: string
}

const TONE_VAR: Record<FactorMeterDatum['tone'], string> = {
  advantage: 'var(--accent-primary)',
  risk: 'var(--accent-warn)',
}

/**
 * Compact accessible factor bars — the plain-language "why" behind an AI pick.
 *
 * Soccer usage: render `PredictionFactors` on match detail / predict pages —
 * each factor is a `role="meter"` hairline track with a green (advantage) or
 * amber (risk) fill and an optional detail line. Risk factors carry a small
 * amber tag. Near-zero factors keep a 3% visible floor so "minor" doesn't
 * read as a rendering bug. Width animation respects reduced motion via the
 * `motion-reduce` variant.
 */
export function FactorMeters({ factors, compact, className }: FactorMetersProps) {
  if (!factors || factors.length === 0) return null
  return (
    <ul className={cn(compact ? 'space-y-2.5' : 'space-y-4', className)}>
      {factors.map((factor) => {
        const tone = TONE_VAR[factor.tone]
        const valuePct = Math.round(Math.min(Math.max(factor.value, 0), 1) * 100)
        const widthPct = factor.value > 0 ? Math.max(valuePct, 3) : 0
        return (
          <li key={factor.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  'uppercase tracking-[0.08em] text-[var(--text-secondary)]',
                  compact ? 'text-[10px]' : 'text-caption',
                )}
              >
                {factor.label}
              </span>
              {factor.tone === 'risk' && (
                <span
                  className="rounded px-1.5 py-px text-[9px] uppercase tracking-[0.1em]"
                  style={{
                    color: 'var(--accent-warn)',
                    border: '1px solid color-mix(in srgb, var(--accent-warn) 45%, transparent)',
                    background: 'color-mix(in srgb, var(--accent-warn) 12%, transparent)',
                  }}
                >
                  Risk
                </span>
              )}
            </div>
            <div
              className={cn('w-full rounded-full bg-[var(--muted-bg)]', compact ? 'h-[3px]' : 'h-1')}
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={valuePct}
              aria-label={`${factor.label} — relative emphasis ${valuePct}%${
                factor.tone === 'risk' ? ', working against this pick' : ''
              }`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${widthPct}%`, background: tone }}
              />
            </div>
            {factor.detail && (
              <p className={cn('mt-1 text-[var(--text-tertiary)]', compact ? 'text-[11px]' : 'text-meta')}>
                {factor.detail}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default FactorMeters
