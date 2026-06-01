'use client'

import { useEffect, useState } from 'react'
import { Wifi, WifiOff } from 'lucide-react'

import { CalibrationPlot } from '@/components/accuracy/CalibrationPlot'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { cn } from '@/lib/utils'
import type { CalibrationDotPoint, FlatAccuracyResponse } from '@/lib/types/accuracy'
import { FALLBACK_ACCURACY, FALLBACK_CALIBRATION } from './demoData'

interface Snapshot {
  bins: CalibrationDotPoint[]
  accuracy: number
  brier: number
  logLoss: number
  completed: number
  live: boolean
}

const FALLBACK: Snapshot = {
  bins: FALLBACK_CALIBRATION,
  accuracy: FALLBACK_ACCURACY.winner_accuracy,
  brier: FALLBACK_ACCURACY.brier_score,
  logLoss: FALLBACK_ACCURACY.log_loss,
  completed: FALLBACK_ACCURACY.completed_predictions,
  live: false,
}

const FETCH_TIMEOUT_MS = 6000

export function CalibrationShowcase() {
  const [snap, setSnap] = useState<Snapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    ;(async () => {
      try {
        const res = await fetch('/api/v1/tracking/accuracy?gender=M', { signal: controller.signal })
        if (!res.ok) throw new Error('bad status')
        const data = (await res.json()) as FlatAccuracyResponse
        const bins = Array.isArray(data.calibration_bins) ? data.calibration_bins : []
        if (cancelled) return
        // Only treat as live if we actually have enough settled data to plot.
        if (bins.length >= 3 && (data.completed_predictions ?? 0) > 0) {
          setSnap({
            bins,
            accuracy: data.winner_accuracy ?? data.accuracy ?? FALLBACK_ACCURACY.winner_accuracy,
            brier: data.brier_score ?? FALLBACK_ACCURACY.brier_score,
            logLoss: data.log_loss ?? FALLBACK_ACCURACY.log_loss,
            completed: data.completed_predictions ?? FALLBACK_ACCURACY.completed_predictions,
            live: true,
          })
        } else {
          setSnap(FALLBACK)
        }
      } catch {
        if (!cancelled) setSnap(FALLBACK)
      } finally {
        clearTimeout(timer)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [])

  const view = snap ?? FALLBACK
  const loading = snap === null

  const stats = [
    { value: view.accuracy * 100, dp: 2, suffix: '%', label: 'Outcome accuracy' },
    { value: view.brier, dp: 3, label: 'Brier score' },
    { value: view.logLoss, dp: 3, label: 'Log loss' },
    { value: view.completed, dp: 0, label: 'Settled picks' },
  ]

  return (
    <div className="grid items-center gap-8 lg:grid-cols-[0.9fr_1.1fr]">
      {/* Narrative + live stats */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              loading
                ? 'bg-[var(--muted-bg)] text-[var(--text-tertiary)]'
                : view.live
                  ? 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]'
                  : 'bg-[var(--accent-warn)]/12 text-[var(--accent-warn)]',
            )}
          >
            {view.live && !loading ? <Wifi className="h-3 w-3" aria-hidden="true" /> : <WifiOff className="h-3 w-3" aria-hidden="true" />}
            {loading ? 'Loading…' : view.live ? 'Live from the tracker' : 'Sample data'}
          </span>
        </div>

        <h3 className="font-display text-[clamp(1.6rem,3vw,2.25rem)] font-extrabold leading-tight tracking-tight text-[var(--text-primary)]">
          A 60% pick should win <span className="mkt-headline-gradient">about 60%</span> of the time.
        </h3>
        <p className="mt-3 max-w-md text-base leading-relaxed text-[var(--text-secondary)]">
          That&apos;s calibration — and it&apos;s the number most prediction sites quietly ignore. Every dot
          on this plot is a confidence bucket; the closer to the diagonal, the more honest the model.
        </p>

        <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--border-color)]">
          {stats.map((s) => (
            <div key={s.label} className="bg-[var(--card-bg)] p-4">
              <p className="font-numeric text-2xl font-extrabold tabular-nums text-[var(--text-primary)]">
                {loading ? (
                  <span className="inline-block h-7 w-20 animate-pulse rounded bg-[var(--muted-bg)]" />
                ) : (
                  <NumberTicker value={s.value} decimalPlaces={s.dp} suffix={s.suffix} />
                )}
              </p>
              <p className="mt-1 text-xs font-semibold text-[var(--text-secondary)]">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Calibration plot */}
      <div>
        {loading ? (
          <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--muted-bg)]/40 text-sm text-[var(--text-tertiary)]">
            Loading calibration…
          </div>
        ) : (
          <CalibrationPlot bins={view.bins} />
        )}
      </div>
    </div>
  )
}
