'use client'

import dynamic from 'next/dynamic'

/** Shared skeleton — reserves height to avoid layout shift while the
 *  Recharts-heavy demo chunks load. */
function DemoSkeleton({ height = 480 }: { height?: number }) {
  return (
    <div
      className="w-full animate-pulse rounded-3xl border border-[var(--border-color)] bg-[var(--muted-bg)]/40"
      style={{ height }}
      aria-hidden="true"
    />
  )
}

/**
 * Lazy, client-only demo islands. Loading them with `ssr: false` keeps the
 * chart/inference code out of the server render and off the critical path —
 * they sit below the fold, so first paint and LCP are unaffected.
 */
export const PredictionDemoLazy = dynamic(
  () => import('./PredictionDemo').then((m) => m.PredictionDemo),
  { ssr: false, loading: () => <DemoSkeleton height={520} /> },
)

export const SimulatorDemoLazy = dynamic(
  () => import('./SimulatorDemo').then((m) => m.SimulatorDemo),
  { ssr: false, loading: () => <DemoSkeleton height={420} /> },
)

export const CalibrationShowcaseLazy = dynamic(
  () => import('./CalibrationShowcase').then((m) => m.CalibrationShowcase),
  { ssr: false, loading: () => <DemoSkeleton height={420} /> },
)
