import PredictionTracker from '@/components/tracking/PredictionTracker'
import AccuracyDashboard from '@/components/tracking/AccuracyDashboard'

export default function TrackingPage() {
  return (
    <div className="min-h-screen py-8 px-4" style={{ backgroundColor: 'var(--background)' }}>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
            📊 Prediction Accuracy Dashboard
          </h1>
          <p className="text-[var(--text-secondary)]">
            See how accurate the AI model is — and watch it improve over time
          </p>
        </div>

        {/* Accuracy Dashboard - Predicted vs Actual, trend, headline metrics */}
        <AccuracyDashboard />

        {/* Divider */}
        <div className="my-10 border-t" style={{ borderColor: 'var(--border-color)' }} />

        {/* Original Tracker with filters */}
        <PredictionTracker />

        {/* Info Card */}
        <div className="mt-8 p-4 bg-[var(--muted-bg)] rounded-xl">
          <h3 className="font-semibold text-[var(--text-primary)] mb-2">How It Works</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="font-medium text-[var(--text-primary)] mb-1">1. Dixon-Coles Model</p>
              <p className="text-[var(--text-tertiary)]">
                Predictions use a corrected Poisson model with league-specific draw rates and opponent-adjusted strengths
              </p>
            </div>
            <div>
              <p className="font-medium text-[var(--text-primary)] mb-1">2. ELO + ML Ensemble</p>
              <p className="text-[var(--text-tertiary)]">
                Dynamic ELO ratings blended with GradientBoosting classifier using 41 features per match
              </p>
            </div>
            <div>
              <p className="font-medium text-[var(--text-primary)] mb-1">3. Auto-Tracked</p>
              <p className="text-[var(--text-tertiary)]">
                Real results fetched from ESPN every 30 min — ELO and model weights auto-update from outcomes
              </p>
            </div>
            <div>
              <p className="font-medium text-[var(--text-primary)] mb-1">4. Self-Improving</p>
              <p className="text-[var(--text-tertiary)]">
                After 50 outcomes the model retrains. Brier score and draw calibration continuously optimized
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
