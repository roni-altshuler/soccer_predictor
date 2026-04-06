import TrackingCenter from '@/components/tracking/TrackingCenter'

type TrackingView = 'overview' | 'diagnostics' | 'learning'

function resolveInitialView(value: string | string[] | undefined): TrackingView {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === 'diagnostics' || raw === 'learning') return raw
  return 'overview'
}

export default function TrackingPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const initialView = resolveInitialView(searchParams?.view)

  return (
    <div className="min-h-screen bg-[var(--background)] relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden>
        <div className="absolute top-[-140px] left-[-120px] w-[340px] h-[340px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-[80px] right-[-100px] w-[300px] h-[300px] rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 pt-5 pb-10">
        <div className="mb-5 fm-surface p-5 md:p-6 animate-fadeIn">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[var(--text-tertiary)] mb-2">Model Reality Check</p>
              <h1 className="text-2xl md:text-3xl font-black text-[var(--text-primary)] leading-tight">
                Prediction Intelligence Center
              </h1>
              <p className="text-xs md:text-sm text-[var(--text-tertiary)] mt-2 max-w-2xl">
                Accuracy and diagnostics now live in one workspace so outcome audits, drift signals, and league-level adaptation stay connected.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
              <span className="px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 font-semibold">Outcome + Scoreline Audits</span>
              <span className="px-2.5 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/15 text-cyan-400 font-semibold">Diagnostics + League Learning</span>
            </div>
          </div>
        </div>

        <TrackingCenter initialView={initialView} />

        <div className="mt-5 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] p-4 md:p-5 shadow-[var(--shadow-sm)]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Continuous Learning Pipeline</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              { step: 'Observe Outcomes', desc: 'Finished matches synced and labeled by league' },
              { step: 'Diagnose Drift', desc: 'Calibration, confusion, and walk-forward checks' },
              { step: 'Retune League Bias', desc: 'Blend weights and draw thresholds auto-tuned' },
              { step: 'Predict Better', desc: 'Next fixtures use updated league characteristics' },
            ].map((item) => (
              <div key={item.step} className="p-2.5 rounded-xl bg-[var(--muted-bg)] border border-[var(--border-color)]">
                <p className="font-semibold text-[var(--text-primary)] mb-0.5">{item.step}</p>
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
  title: 'Tracking | FotPredict AI',
  description: 'Unified accuracy, diagnostics, and learning loop center for model evaluation.',
}
