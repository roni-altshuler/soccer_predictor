import Link from 'next/link'

import TrackingCenter from '@/components/tracking/TrackingCenter'

type DiagnosticsView = 'overview' | 'diagnostics' | 'learning' | 'fan'

function resolveInitialView(value: string | string[] | undefined): DiagnosticsView {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === 'overview' || raw === 'learning' || raw === 'fan') return raw
  return 'diagnostics'
}

/**
 * Engineer-facing model audit. The public-facing "How accurate is the
 * AI?" view lives at /accuracy; this page keeps the deeper instruments
 * — quality gates, calibration drift, league-by-league audit, learning
 * loop visualisations — under their own URL so a casual visitor isn't
 * dropped into a dense dashboard by accident.
 *
 * Matchday v3: compact title line, then the dense flat dashboard — no
 * hero band.
 */
export default function DiagnosticsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const initialView = resolveInitialView(searchParams?.view)

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pb-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
            Model diagnostics
          </h1>
          <p className="max-w-xl text-[12px] text-[var(--text-tertiary)]">
            Quality gates, calibration drift, league-by-league audit, and the learning loop
            that retunes blend weights and draw thresholds.
          </p>
        </div>
        <Link
          href="/accuracy"
          className="inline-flex min-h-[44px] items-center text-[12px] font-semibold text-[var(--accent-primary)] hover:underline"
        >
          Simple version: Accuracy
        </Link>
      </div>

      <TrackingCenter initialView={initialView} />
    </div>
  )
}

export const metadata = {
  title: 'Model Diagnostics | Pitchwise',
  description: 'Engineer-facing view of the unified prediction model: quality gates, calibration drift, confusion matrices, and the continuous learning loop.',
}
