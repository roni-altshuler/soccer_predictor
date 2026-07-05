'use client'

import { useEffect, useMemo, useState } from 'react'
import AccuracyDashboard from './AccuracyDashboard'
import DiagnosticsDashboard from './DiagnosticsDashboard'
import FanTrackingPanel from './FanTrackingPanel'
import { SectionHeader, StatCard } from '@/components/primitives'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import type { AccuracySummaryResponse } from '@/lib/types/accuracy'

type TrackingView = 'overview' | 'diagnostics' | 'learning' | 'fan'

type AlertSeverity = 'high' | 'medium' | 'low'

// TrackingCenter only reads `overall` headline metrics from the summary —
// alias keeps the local name stable while sharing the canonical shape.
type AccuracySummarySnapshot = Pick<AccuracySummaryResponse, 'overall'>

interface DiagnosticsLeague {
  sample_size: number
  accuracy: number
  expected_calibration_error: number
  draw_probability_gap: number
  tuning: {
    blend_nn_base: number
    draw_min_prob: number
    source_sample_size?: number
  }
}

interface DiagnosticsSnapshot {
  top_alerts: Array<{ severity: AlertSeverity }>
  leagues: Record<string, DiagnosticsLeague>
}

interface OutcomeStatusSnapshot {
  total_completed?: number
  total_pending?: number
  outcomes_since_retrain?: number
  retrain_threshold?: number
}

interface ModelInfoSnapshot {
  summary?: {
    total_leagues?: number
    neural_ensemble_count?: number
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function statColor(value: number): string {
  if (value >= 0.62) return 'var(--accent-primary)'
  if (value >= 0.5) return 'var(--accent-warn)'
  return 'var(--accent-loss)'
}

function statAccent(value: number): 'primary' | 'warn' | 'loss' {
  if (value >= 0.62) return 'primary'
  if (value >= 0.5) return 'warn'
  return 'loss'
}

function severityCount(alerts: Array<{ severity: AlertSeverity }>, severity: AlertSeverity): number {
  return alerts.filter((alert) => alert.severity === severity).length
}

export default function TrackingCenter({ initialView = 'overview' }: { initialView?: TrackingView }) {
  const { gender, withParam } = useGenderQuery()
  const [activeView, setActiveView] = useState<TrackingView>(initialView)
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<AccuracySummarySnapshot | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null)
  const [status, setStatus] = useState<OutcomeStatusSnapshot | null>(null)
  const [modelInfo, setModelInfo] = useState<ModelInfoSnapshot | null>(null)

  useEffect(() => {
    setActiveView(initialView)
  }, [initialView])

  useEffect(() => {
    // Clear stale state on gender flip so the previous universe's numbers
    // don't flash through while the fresh snapshot is in flight.
    setSummary(null)
    setDiagnostics(null)
    setStatus(null)
    setModelInfo(null)

    async function loadSnapshot() {
      setLoading(true)
      try {
        const [summaryRes, diagnosticsRes, statusRes, modelRes] = await Promise.all([
          fetch(withParam('/api/v1/tracking/accuracy/summary')),
          fetch(withParam('/api/v1/tracking/diagnostics')),
          fetch(withParam('/api/v1/tracking/outcome-status')),
          fetch(withParam('/api/v1/tracking/model-info')),
        ])

        if (summaryRes.ok) setSummary((await summaryRes.json()) as AccuracySummarySnapshot)
        if (diagnosticsRes.ok) setDiagnostics((await diagnosticsRes.json()) as DiagnosticsSnapshot)
        if (statusRes.ok) setStatus((await statusRes.json()) as OutcomeStatusSnapshot)
        if (modelRes.ok) setModelInfo((await modelRes.json()) as ModelInfoSnapshot)
      } catch (error) {
        console.error('Failed to load tracking center snapshot:', error)
      } finally {
        setLoading(false)
      }
    }

    loadSnapshot()
  }, [gender, withParam])

  const retrainThreshold = status?.retrain_threshold ?? 50
  const outcomesSinceRetrain = status?.outcomes_since_retrain ?? 0
  const retrainProgress = retrainThreshold > 0
    ? Math.min(1, outcomesSinceRetrain / retrainThreshold)
    : 0

  const leagueRows = useMemo(() => {
    if (!diagnostics) return []

    return Object.entries(diagnostics.leagues)
      .map(([league, data]) => ({
        league,
        sample: data.sample_size,
        accuracy: data.accuracy,
        ece: data.expected_calibration_error,
        drawGap: data.draw_probability_gap,
        nnBase: data.tuning.blend_nn_base,
        drawMin: data.tuning.draw_min_prob,
      }))
      .sort((a, b) => b.sample - a.sample)
      .slice(0, 8)
  }, [diagnostics])

  const highAlerts = diagnostics ? severityCount(diagnostics.top_alerts, 'high') : 0
  const mediumAlerts = diagnostics ? severityCount(diagnostics.top_alerts, 'medium') : 0

  const viewTabs: Array<{ key: TrackingView; label: string; hint: string }> = [
    { key: 'overview', label: 'Accuracy + Outcomes', hint: 'What happened' },
    { key: 'diagnostics', label: 'Diagnostics + Drift', hint: 'Why it happened' },
    { key: 'learning', label: 'League Learning Loop', hint: 'How it adapts next' },
    { key: 'fan', label: 'Fan Team Tracker', hint: 'Who you follow' },
  ]

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Diagnostics hub</p>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ring-1 ${
                  gender === 'women'
                    ? 'bg-[var(--accent-women)]/12 text-[var(--accent-women)] ring-[var(--accent-women)]/30'
                    : 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)] ring-[var(--accent-primary)]/30'
                }`}
              >
                {gender === 'women' ? "Women's universe" : "Men's universe"}
              </span>
            </div>
            <h2 className="text-base font-bold text-[var(--text-primary)]">Accuracy, diagnostics, and learning in one loop</h2>
            <p className="text-xs text-[var(--text-tertiary)] mt-1 max-w-3xl">
              Completed matches feed league-specific diagnostics, tuning updates adjust model blending, and the next predictions reflect learned behavior.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full lg:w-auto">
            <StatCard
              size="sm"
              label="Outcome Accuracy"
              value={summary ? pct(summary.overall.winner_accuracy) : '…'}
              accent={summary ? statAccent(summary.overall.winner_accuracy) : 'none'}
              sub={summary ? `${summary.overall.completed_predictions} completed` : 'loading'}
            />
            <StatCard
              size="sm"
              label="Calibration ECE"
              value={summary ? (summary.overall.expected_calibration_error ?? 0).toFixed(3) : '…'}
              accent={summary ? 'ai' : 'none'}
              sub={summary ? 'lower is better' : 'loading'}
            />
            <StatCard
              size="sm"
              label="Drift Alerts"
              value={diagnostics ? String(diagnostics.top_alerts.length) : '…'}
              accent={!diagnostics ? 'none' : highAlerts > 0 ? 'loss' : mediumAlerts > 0 ? 'warn' : 'primary'}
              sub={!diagnostics ? 'loading' : highAlerts > 0 ? `${highAlerts} high` : mediumAlerts > 0 ? `${mediumAlerts} medium` : 'stable'}
            />
            <StatCard
              size="sm"
              label="Neural Leagues"
              value={modelInfo?.summary?.neural_ensemble_count !== undefined ? String(modelInfo.summary.neural_ensemble_count) : '…'}
              accent="ai"
              sub={modelInfo?.summary?.total_leagues !== undefined ? `of ${modelInfo.summary.total_leagues}` : 'loading'}
            />
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Diagnostics views"
          className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3"
        >
          {viewTabs.map((tab) => {
            const active = activeView === tab.key
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={active}
                aria-controls={`tracking-panel-${tab.key}`}
                onClick={() => setActiveView(tab.key)}
                className={`text-left rounded-xl border px-3 py-2.5 min-h-[44px] transition-colors ${
                  active
                    ? 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)] border-[var(--accent-primary)]/50'
                    : 'bg-[var(--muted-bg)] border-[var(--border-color)] hover:bg-[var(--card-hover)] text-[var(--text-primary)]'
                }`}
              >
                <p className="text-xs font-semibold">{tab.label}</p>
                <p className={`text-[10px] mt-0.5 ${active ? 'text-[var(--accent-primary)]/80' : 'text-[var(--text-tertiary)]'}`}>{tab.hint}</p>
              </button>
            )
          })}
        </div>

        <div className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[var(--text-secondary)] font-medium">Online learning cycle progress</span>
            <span className="text-[var(--text-primary)] font-semibold tabular-nums">{outcomesSinceRetrain}/{retrainThreshold} outcomes toward next tuning cycle</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-[var(--card-bg)] overflow-hidden">
            <div className="h-full bg-[var(--accent-primary)] transition-all duration-700" style={{ width: `${Math.max(2, retrainProgress * 100)}%` }} />
          </div>
        </div>
      </section>

      {activeView === 'overview' && (
        <div role="tabpanel" id="tracking-panel-overview">
          {/* key={gender} remounts the dashboard on gender switch so cached
              state from the previous universe is fully discarded. */}
          <AccuracyDashboard key={gender} />
        </div>
      )}

      {activeView === 'diagnostics' && (
        <div role="tabpanel" id="tracking-panel-diagnostics">
          <DiagnosticsDashboard key={gender} />
        </div>
      )}

      {activeView === 'learning' && (
        <section role="tabpanel" id="tracking-panel-learning" className="space-y-4">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
            <SectionHeader
              kicker="Learning loop"
              title="League adaptation"
              description="Per-league blend weights and draw thresholds, retuned as outcomes settle."
              className="mb-3"
            />
            {loading ? (
              <div className="h-40 rounded-xl bg-[var(--muted-bg)] animate-pulse" />
            ) : leagueRows.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">Need more completed matches to compute per-league adaptation trends.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[var(--text-tertiary)] uppercase text-[10px]">
                      <th className="text-left py-2 pr-2">League</th>
                      <th className="text-right py-2 px-2">Samples</th>
                      <th className="text-right py-2 px-2">Accuracy</th>
                      <th className="text-right py-2 px-2">ECE</th>
                      <th className="text-right py-2 px-2">Draw Gap</th>
                      <th className="text-right py-2 px-2">NN Base</th>
                      <th className="text-right py-2 px-2">Draw Min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leagueRows.map((row) => (
                      <tr key={row.league} className="border-t border-[var(--border-color)]/60 even:bg-[color-mix(in_srgb,var(--muted-bg)_40%,transparent)]">
                        <td className="py-2 pr-2 font-medium text-[var(--text-primary)]">{row.league}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{row.sample}</td>
                        <td className="py-2 px-2 text-right font-semibold tabular-nums" style={{ color: statColor(row.accuracy) }}>{pct(row.accuracy)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{row.ece.toFixed(3)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{pct(row.drawGap)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{row.nnBase.toFixed(3)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{row.drawMin.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <LearningCard
              title="1. Observe"
              body="Every finished match updates outcome labels and confidence audit signals."
            />
            <LearningCard
              title="2. Diagnose"
              body="Diagnostics detect calibration drift, draw bias, and league-specific instability."
            />
            <LearningCard
              title="3. Adapt"
              body="Blend weights and draw thresholds are tuned per league before future predictions."
            />
          </div>
        </section>
      )}

      {activeView === 'fan' && (
        <div role="tabpanel" id="tracking-panel-fan">
          <FanTrackingPanel />
        </div>
      )}
    </div>
  )
}

function LearningCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3.5">
      <p className="text-xs font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="text-[11px] leading-relaxed mt-1 text-[var(--text-secondary)]">{body}</p>
    </div>
  )
}
