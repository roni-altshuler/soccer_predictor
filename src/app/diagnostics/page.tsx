import DiagnosticsDashboard from '@/components/tracking/DiagnosticsDashboard'

export const metadata = {
  title: 'Diagnostics | FotPredict AI',
  description: 'League-level walk-forward, drift, and calibration diagnostics for model performance.',
}

export default function DiagnosticsPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden>
        <div className="absolute top-[-180px] left-[-120px] w-[360px] h-[360px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-[40px] right-[-140px] w-[340px] h-[340px] rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute bottom-[-180px] left-[30%] w-[340px] h-[340px] rounded-full bg-amber-400/10 blur-3xl" />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 pt-5 pb-10">
        <div className="mb-5 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)]/90 backdrop-blur p-5 md:p-6 animate-fadeIn">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[var(--text-tertiary)] mb-2">Advanced Model Audit</p>
              <h1 className="text-2xl md:text-3xl font-black text-[var(--text-primary)] leading-tight">
                Diagnostics and Drift Intelligence
              </h1>
              <p className="text-xs md:text-sm text-[var(--text-tertiary)] mt-2 max-w-2xl">
                Inspect league-specific confusion matrices, reliability gaps, and walk-forward stability to spot where probability estimates need retuning.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">Walk-forward Fold Analysis</span>
              <span className="px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-400 font-semibold">Per-League Drift Alerts</span>
            </div>
          </div>
        </div>

        <DiagnosticsDashboard />
      </div>
    </div>
  )
}
