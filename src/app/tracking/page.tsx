import AccuracyDashboard from '@/components/tracking/AccuracyDashboard'

export default function TrackingPage() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-3xl mx-auto px-4 pt-4 pb-8">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-lg font-bold text-[var(--text-primary)]">Prediction Accuracy</h1>
          <p className="text-xs text-[var(--text-tertiary)]">
            Track model performance across leagues — outcomes &amp; exact scorelines
          </p>
        </div>

        <AccuracyDashboard />

        {/* Model Pipeline Info */}
        <div className="mt-4 bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Model Pipeline</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              { step: 'Dixon-Coles', desc: 'Bivariate Poisson scoreline model' },
              { step: 'Neural Ensemble', desc: '7-model stack · 66 features' },
              { step: 'Auto-Tracked', desc: 'Results fetched from ESPN' },
              { step: 'Self-Improving', desc: 'Retrains after 50 new outcomes' },
            ].map((item) => (
              <div key={item.step} className="p-2.5 rounded-lg bg-[var(--muted-bg)]">
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
