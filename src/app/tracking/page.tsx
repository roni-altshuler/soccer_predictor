import AccuracyDashboard from '@/components/tracking/AccuracyDashboard'
import Link from 'next/link'

export default function TrackingPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden>
        <div className="absolute top-[-140px] left-[-120px] w-[340px] h-[340px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-[80px] right-[-100px] w-[300px] h-[300px] rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 pt-5 pb-10">
        <div className="mb-5 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)]/90 backdrop-blur p-5 md:p-6 animate-fadeIn">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[var(--text-tertiary)] mb-2">Model Reality Check</p>
              <h1 className="text-2xl md:text-3xl font-black text-[var(--text-primary)] leading-tight">
                Prediction Evaluation Center
              </h1>
              <p className="text-xs md:text-sm text-[var(--text-tertiary)] mt-2 max-w-2xl">
                Compare AI probabilities against real match outcomes, inspect confidence calibration, and monitor whether model certainty matches real-world accuracy.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">Outcome + Scoreline Audits</span>
              <span className="px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-400 font-semibold">Calibration Diagnostics</span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-[var(--border-color)]/60 flex items-center justify-between">
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Need walk-forward folds, confusion matrices, and drift alerts?
            </p>
            <Link
              href="/diagnostics"
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[var(--accent-primary)] text-white hover:opacity-90 transition-opacity"
            >
              Open Diagnostics
            </Link>
          </div>
        </div>

        <AccuracyDashboard />

        <div className="mt-5 bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 md:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Prediction Pipeline</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              { step: 'Dixon-Coles', desc: 'Calibrated scoreline baseline' },
              { step: 'Neural Ensemble', desc: '7-model stack · 66 engineered features' },
              { step: 'Outcome Sync', desc: 'Finished matches pulled from ESPN' },
              { step: 'Feedback Loop', desc: 'League params + online updates' },
            ].map((item) => (
              <div key={item.step} className="p-2.5 rounded-lg bg-[var(--muted-bg)] border border-[var(--border-color)]/50">
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
  title: 'Accuracy | FotPredict AI',
  description: 'Track prediction accuracy and model performance over time',
}
