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
 */
export default function DiagnosticsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const initialView = resolveInitialView(searchParams?.view)

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto max-w-7xl px-4 pt-5 pb-10">
        <div className="mb-5 border border-[var(--border-color)] bg-[var(--card-bg)] p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                Engineer surface
              </p>
              <h1 className="text-h1 font-black leading-tight text-[var(--text-primary)]">
                Model diagnostics
              </h1>
              <p className="mt-2 max-w-2xl text-small text-[var(--text-tertiary)]">
                Quality gates, calibration drift, confusion matrices, league-by-league walk-forward
                audit, and the continuous-learning loop that retunes blend weights and draw thresholds.
                Looking for the simple version? See{' '}
                <a href="/accuracy" className="font-semibold text-[var(--accent-primary)] hover:underline">
                  /accuracy
                </a>
                .
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-secondary)]">
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-400">
                Outcome + Scoreline Audits
              </span>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/15 px-2.5 py-1 font-semibold text-cyan-400">
                Diagnostics + League Learning
              </span>
              <span className="rounded-full border border-violet-500/30 bg-violet-500/15 px-2.5 py-1 font-semibold text-violet-300">
                Personal Team Tracking
              </span>
            </div>
          </div>
        </div>

        <TrackingCenter initialView={initialView} />

        <div className="mt-5 border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5 shadow-[var(--shadow-sm)]">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            Continuous learning pipeline
          </p>
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            {[
              { step: 'Observe outcomes', desc: 'Finished matches synced and labelled by league + gender' },
              { step: 'Diagnose drift', desc: 'Calibration, confusion, and walk-forward checks' },
              { step: 'Retune league bias', desc: 'Blend weights and draw thresholds auto-tuned' },
              { step: 'Predict better', desc: 'Next fixtures use updated league characteristics' },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-2.5"
              >
                <p className="mb-0.5 font-semibold text-[var(--text-primary)]">{item.step}</p>
                <p className="text-[10px] text-[var(--text-tertiary)]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export const metadata = {
  title: 'Model Diagnostics | FotPredict AI',
  description: 'Engineer-facing view of the unified prediction model: quality gates, calibration drift, confusion matrices, and the continuous learning loop.',
}
