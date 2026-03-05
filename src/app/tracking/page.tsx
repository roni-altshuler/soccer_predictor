import AccuracyDashboard from '@/components/tracking/AccuracyDashboard'

export default function TrackingPage() {
  return (
    <div className="min-h-screen py-8 px-4" style={{ backgroundColor: 'var(--background)' }}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
            Prediction Accuracy Dashboard
          </h1>
          <p className="text-[var(--text-secondary)]">
            Track model accuracy across leagues — outcome predictions and exact scorelines
          </p>
        </div>

        {/* Unified Accuracy Dashboard */}
        <AccuracyDashboard />

        {/* Info Card */}
        <div className="mt-8 p-4 bg-[var(--muted-bg)] rounded-xl">
          <h3 className="font-semibold text-[var(--text-primary)] mb-2">How It Works</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="font-medium text-[var(--text-primary)] mb-1">1. Dixon-Coles Model</p>
              <p className="text-[var(--text-tertiary)]">
                Corrected bivariate Poisson model produces scoreline predictions with league-specific draw rates
              </p>
            </div>
            <div>
              <p className="font-medium text-[var(--text-primary)] mb-1">2. Neural Ensemble</p>
              <p className="text-[var(--text-tertiary)]">
                Per-league MLP + XGBoost + LightGBM + GBT + RandomForest ensemble with 55 features per match
              </p>
            </div>
            <div>
              <p className="font-medium text-[var(--text-primary)] mb-1">3. Auto-Tracked</p>
              <p className="text-[var(--text-tertiary)]">
                Real results fetched from ESPN automatically — outcomes derived consistently from predicted scorelines
              </p>
            </div>
            <div>
              <p className="font-medium text-[var(--text-primary)] mb-1">4. Self-Improving</p>
              <p className="text-[var(--text-tertiary)]">
                After 50 new outcomes the model retrains. Brier score, draw calibration, and league params continuously optimized
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const metadata = {
  title: 'Prediction Tracking | Soccer Predictor',
  description: 'Track prediction accuracy and model performance over time',
}
