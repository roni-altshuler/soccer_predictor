'use client'

import { useEffect, useMemo, useState } from 'react'

type ReadinessPayload = {
  tournament: string
  dates: {
    opening_match: string
    final: string
  }
  model: {
    available: boolean
    model_version: string | null
    trained_at: string | null
    samples: number
    test_samples: number
    n_features: number
    ensemble_accuracy: number | null
    nn_accuracy: number | null
    ensemble_log_loss: number | null
    goals_mae_home: number | null
    goals_mae_away: number | null
    global_model_available: boolean
    global_model_trained_at: string | null
    global_model_last_online_update: string | null
    global_model_last_online_update_samples: number
  }
  diagnostics: {
    generated_at: string | null
    sample_size: number
    accuracy: number | null
    brier_score: number | null
    expected_calibration_error: number | null
    draw_actual_rate: number | null
    draw_predicted_rate: number | null
  } | null
  calibration: {
    league_params_available: boolean
    tuning_available: boolean
    avg_goals: number | null
    draw_rate: number | null
    home_adv: number | null
    blend_nn_base: number | null
    blend_nn_min: number | null
    blend_nn_max: number | null
  }
  data_integrity: {
    fixture_source: string
    prediction_source: string
    unavailable_fields_policy: string
    simulated_weather_enabled: boolean
  }
}

function pct(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return `${(value * 100).toFixed(digits)}%`
}

function num(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  return value.toFixed(digits)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-normal ${
      ok
        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
        : 'border-amber-500/35 bg-amber-500/10 text-amber-300'
    }`}>
      {label}
    </span>
  )
}

function ReadinessCard({
  title,
  value,
  detail,
  tone = 'neutral',
}: {
  title: string
  value: string
  detail: string
  tone?: 'neutral' | 'good' | 'watch'
}) {
  const toneClass = tone === 'good'
    ? 'border-emerald-500/25 bg-emerald-500/10'
    : tone === 'watch'
      ? 'border-amber-500/25 bg-amber-500/10'
      : 'border-[var(--border-color)] bg-[var(--muted-bg)]'

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">{title}</p>
      <p className="mt-1 text-lg font-black text-[var(--text-primary)]">{value}</p>
      <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">{detail}</p>
    </div>
  )
}

export default function WorldCupReadinessPanel({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<ReadinessPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/world-cup/readiness', { cache: 'no-store' })
        if (!response.ok) throw new Error('Readiness unavailable')
        const payload = await response.json() as ReadinessPayload
        if (!cancelled) setData(payload)
      } catch {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const readiness = useMemo(() => {
    if (!data) return null
    const modelOk = data.model.available && data.model.n_features === 66
    const calibrationOk = data.calibration.league_params_available && data.calibration.tuning_available
    const diagnosticsOk = Boolean(data.diagnostics && data.diagnostics.sample_size > 0)
    const integrityOk = !data.data_integrity.simulated_weather_enabled
    const score = [modelOk, calibrationOk, diagnosticsOk, integrityOk].filter(Boolean).length
    return { modelOk, calibrationOk, diagnosticsOk, integrityOk, score }
  }, [data])

  if (loading) {
    return (
      <section className={compact ? '' : 'max-w-3xl mx-auto px-4 pt-2 pb-2'}>
        <div className="fm-surface p-4">
          <div className="h-4 w-40 rounded bg-[var(--muted-bg)]" />
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-lg bg-[var(--muted-bg)]" />
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (!data || !readiness) return null

  return (
    <section className={compact ? '' : 'max-w-3xl mx-auto px-4 pt-2 pb-2'}>
      <div className="fm-surface overflow-hidden">
        <div className="border-b border-[var(--border-color)] px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">Prediction readiness</p>
              <h2 className="mt-1 text-lg font-black text-[var(--text-primary)]">World Cup model status</h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Opening match {formatDate(data.dates.opening_match)}. Final {formatDate(data.dates.final)}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill ok={readiness.modelOk} label={data.model.available ? 'Model ready' : 'Model missing'} />
              <StatusPill ok={readiness.integrityOk} label={readiness.integrityOk ? 'No fake data' : 'Sim weather on'} />
            </div>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <ReadinessCard
              title="Readiness"
              value={`${readiness.score}/4`}
              detail="Model, calibration, diagnostics, and data policy checks."
              tone={readiness.score >= 3 ? 'good' : 'watch'}
            />
            <ReadinessCard
              title="Model Sample"
              value={`${data.model.samples}`}
              detail={`${data.model.n_features || 0} features. Test set ${data.model.test_samples} matches.`}
              tone={readiness.modelOk ? 'good' : 'watch'}
            />
            <ReadinessCard
              title="Test Accuracy"
              value={pct(data.model.ensemble_accuracy)}
              detail={`Neural ${pct(data.model.nn_accuracy)}. Log loss ${num(data.model.ensemble_log_loss, 3)}.`}
              tone="neutral"
            />
            <ReadinessCard
              title="Audit Accuracy"
              value={pct(data.diagnostics?.accuracy)}
              detail={`Settled sample ${data.diagnostics?.sample_size || 0}. Brier ${num(data.diagnostics?.brier_score, 3)}.`}
              tone={readiness.diagnosticsOk ? 'good' : 'watch'}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">Calibration</p>
              <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">
                Avg goals {num(data.calibration.avg_goals, 2)}. Draw rate {pct(data.calibration.draw_rate)}. Neural blend {pct(data.calibration.blend_nn_min)}-{pct(data.calibration.blend_nn_max)}.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">Global Model</p>
              <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">
                {data.model.global_model_available
                  ? `Available. Trained ${formatDate(data.model.global_model_trained_at)}. Last online update ${formatDate(data.model.global_model_last_online_update)} (${data.model.global_model_last_online_update_samples || 0} matches).`
                  : 'Not trained yet. Per-league World Cup model remains primary.'}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">Data Policy</p>
              <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">
                {data.data_integrity.unavailable_fields_policy}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
