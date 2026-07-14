'use client'

import { useMemo } from 'react'

import { SectionHeader } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import type { CalibrationDotPoint } from '@/lib/types/accuracy'
import { cn } from '@/lib/utils'

/**
 * Confidence tiers — answers "when the model is confident, is it right?"
 * with real numbers only. The tracker's calibration buckets (exact
 * per-decile stated-vs-delivered aggregates) are rolled up into three
 * bands, and each band renders a dual bar: stated confidence (muted) vs
 * delivered hit rate (toned), plus the sample size and the signed gap.
 *
 * Replaces the old confusion-matrix card, whose off-diagonal cells were
 * approximated — fabricated data has no place on this page.
 */

interface ConfidenceTiersProps {
  /** Per-decile calibration buckets from the tracking accuracy endpoint. */
  bins: CalibrationDotPoint[]
  className?: string
}

interface Tier {
  key: string
  label: string
  range: string
  n: number
  /** Weighted avg stated confidence 0..1. */
  stated: number
  /** Weighted avg delivered hit rate 0..1. */
  delivered: number
}

const TIER_DEFS = [
  { key: 'high', label: 'High confidence', range: '60%+ stated', min: 0.6, max: 1.01 },
  { key: 'medium', label: 'Medium confidence', range: '40–60% stated', min: 0.4, max: 0.6 },
  { key: 'low', label: 'Low confidence', range: 'under 40% stated', min: 0, max: 0.4 },
] as const

function rollUp(bins: CalibrationDotPoint[]): Tier[] {
  const tiers: Tier[] = []
  for (const def of TIER_DEFS) {
    const members = bins.filter((b) => b.bin_lower >= def.min && b.bin_lower < def.max && b.count > 0)
    const n = members.reduce((s, b) => s + b.count, 0)
    if (n === 0) continue
    const stated = members.reduce((s, b) => s + b.avg_predicted * b.count, 0) / n
    const delivered = members.reduce((s, b) => s + b.avg_actual * b.count, 0) / n
    tiers.push({ key: def.key, label: def.label, range: def.range, n, stated, delivered })
  }
  return tiers
}

export function ConfidenceTiers({ bins, className }: ConfidenceTiersProps) {
  const tiers = useMemo(() => rollUp(bins), [bins])

  if (tiers.length === 0) return null

  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <SectionHeader
        kicker="Confidence audit"
        title="Confident picks, honest results"
        description="Stated chance vs delivered hit rate, grouped by how sure each pick was."
        className="mb-4"
      />

      <div className="space-y-4">
        {tiers.map((tier) => (
          <TierRow key={tier.key} tier={tier} />
        ))}
      </div>
    </Card>
  )
}

function TierRow({ tier }: { tier: Tier }) {
  const statedPct = tier.stated * 100
  const deliveredPct = tier.delivered * 100
  const deltaPts = deliveredPct - statedPct
  // Delivered within 2pts of (or above) stated = holding up; further below = running hot.
  const holdingUp = deltaPts >= -2
  const deliveredTone = holdingUp ? 'var(--accent-primary)' : 'var(--accent-warn)'
  const deltaText = `${deltaPts >= 0 ? '+' : ''}${deltaPts.toFixed(1)}pts`

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {tier.label}{' '}
          <span className="font-normal text-[var(--text-tertiary)]">· {tier.range}</span>
        </p>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">
            n={tier.n.toLocaleString()}
          </span>
          <span
            className="rounded px-1.5 py-px text-[10px] font-semibold tabular-nums"
            style={{
              color: deliveredTone,
              background: `color-mix(in srgb, ${deliveredTone} 12%, transparent)`,
            }}
          >
            {deltaText}
          </span>
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
            Stated
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(2, statedPct))}%`,
                background: 'color-mix(in srgb, var(--text-tertiary) 45%, transparent)',
              }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-tertiary)]">
            {statedPct.toFixed(0)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
            Delivered
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{
                width: `${Math.min(100, Math.max(2, deliveredPct))}%`,
                background: deliveredTone,
              }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">
            {deliveredPct.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  )
}
