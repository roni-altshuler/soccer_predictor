'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight, Brain, Sparkles } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { SectionHeader, StatCard } from '@/components/primitives'
import { ShimmerButton } from '@/components/magicui/shimmer-button'
import { Card } from '@/components/ui/card'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { cn } from '@/lib/utils'

/**
 * /ai — Model transparency dashboard.
 *
 * Shows exactly what the unified model for the active gender universe is
 * (version, size, calibration recipe), how it scored on its held-out test
 * split, and how it behaves in per-league walk-forward backtests. All data
 * comes from committed diagnostics JSON via two Node API routes — when a
 * file hasn't been generated yet the page says so honestly instead of
 * inventing numbers.
 */

/* ---------------- API payload types ---------------- */

interface CalibrationInfo {
  kind?: string
  temperature?: number | null
  alpha?: number | null
  isotonic_kept?: boolean
}

interface UncalibratedMetrics {
  accuracy?: number
  log_loss?: number
  brier?: number
  ece?: number
  draw_recall?: number
}

interface HoldoutMetrics {
  accuracy?: number
  log_loss?: number
  brier?: number
  ece?: number
  draw_recall?: number
  scoreline_exact_rate?: number
  scoreline_top5_rate?: number
  goals_mae?: number
  n?: number
  calibrated?: boolean
  uncalibrated?: UncalibratedMetrics
}

interface ModelSummary {
  gender?: string
  model_version?: string
  trained_at?: string
  n_parameters?: number
  n_features?: number
  vocab_sizes?: Record<string, number>
  calibration?: CalibrationInfo
  holdout?: HoldoutMetrics
}

interface ModelSummaryResponse {
  available: boolean
  summary?: ModelSummary
}

interface WalkforwardLeague {
  league: string
  accuracy_mean: number
  accuracy_std: number
  log_loss_mean: number
  brier_mean: number
  ece_mean: number
  n_test_seasons: number
}

interface WalkforwardResponse {
  available: boolean
  generated_at?: string | null
  leagues?: WalkforwardLeague[]
}

/* ---------------- formatting helpers ---------------- */

const pct = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—')
const num3 = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '—')
const intFmt = (v?: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v).toLocaleString() : '—'

function formatTrainedAt(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Standardized model chip label (design contract: `unified-multitask…`
 * always displays as "Unified v2"; anything else shows its raw version).
 */
function modelDisplayName(version?: string): string {
  if (!version) return 'Unified'
  return version.startsWith('unified-multitask') ? 'Unified v2' : version
}

const LEAGUE_DISPLAY: Record<string, string> = {
  premier_league: 'Premier League',
  la_liga: 'La Liga',
  bundesliga: 'Bundesliga',
  serie_a: 'Serie A',
  ligue_1: 'Ligue 1',
  eredivisie: 'Eredivisie',
  primeira_liga: 'Primeira Liga',
  mls: 'MLS',
  champions_league: 'Champions League',
  europa_league: 'Europa League',
  conference_league: 'Conference League',
  world_cup: 'FIFA World Cup',
  euro: 'UEFA Euro',
  copa_america: 'Copa América',
}

function leagueDisplayName(key: string): string {
  if (LEAGUE_DISPLAY[key]) return LEAGUE_DISPLAY[key]
  return key
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/* ---------------- shared chip ---------------- */

function ModelChip({ version, className }: { version?: string; className?: string }) {
  return (
    <span
      title={version}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-ai)]',
        className
      )}
    >
      <Brain className="h-3 w-3" aria-hidden="true" />
      {modelDisplayName(version)}
    </span>
  )
}

/* ---------------- holdout metric definitions ---------------- */

interface MetricDef {
  key: keyof HoldoutMetrics
  label: string
  format: (v?: number) => string
  explanation: string
  better: 'higher' | 'lower'
}

const HOLDOUT_METRICS: MetricDef[] = [
  {
    key: 'accuracy',
    label: 'Accuracy',
    format: pct,
    explanation: 'How often the model’s pick (home / draw / away) was the actual result.',
    better: 'higher',
  },
  {
    key: 'log_loss',
    label: 'Log loss',
    format: num3,
    explanation: 'Penalises confident wrong probabilities hardest. The core probability-quality score.',
    better: 'lower',
  },
  {
    key: 'brier',
    label: 'Brier score',
    format: num3,
    explanation: 'Mean squared error of the full probability vector against what happened.',
    better: 'lower',
  },
  {
    key: 'ece',
    label: 'Calibration error (ECE)',
    format: num3,
    explanation: 'How far stated confidence drifts from the real hit-rate. 0 = perfectly calibrated.',
    better: 'lower',
  },
  {
    key: 'draw_recall',
    label: 'Draw recall',
    format: pct,
    explanation: 'Share of actual draws the model called. Draws are football’s hardest class.',
    better: 'higher',
  },
  {
    key: 'scoreline_exact_rate',
    label: 'Exact scoreline',
    format: pct,
    explanation: 'How often the single most-likely scoreline was the exact final score.',
    better: 'higher',
  },
  {
    key: 'scoreline_top5_rate',
    label: 'Top-5 scoreline',
    format: pct,
    explanation: 'How often the final score appeared among the model’s five most-likely scorelines.',
    better: 'higher',
  },
  {
    key: 'goals_mae',
    label: 'Goals MAE',
    format: num3,
    explanation: 'Average absolute error of the expected-goals head, in goals per team.',
    better: 'lower',
  },
]

/* ---------------- sections ---------------- */

function ModelIdentityCard({ summary, genderLabel }: { summary: ModelSummary; genderLabel: string }) {
  const cal = summary.calibration
  const calDescription = cal?.kind
    ? [
        cal.kind,
        typeof cal.temperature === 'number' ? `T=${cal.temperature.toFixed(3)}` : null,
        typeof cal.alpha === 'number' ? `α=${cal.alpha.toFixed(2)}` : null,
        cal.isotonic_kept ? '+ isotonic' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '—'

  const facts: { label: string; value: string }[] = [
    { label: 'Model version', value: summary.model_version ?? '—' },
    { label: 'Trained', value: formatTrainedAt(summary.trained_at) },
    { label: 'Parameters', value: intFmt(summary.n_parameters) },
    { label: 'Dense features', value: intFmt(summary.n_features) },
    { label: 'Calibration', value: calDescription },
  ]

  return (
    <Card variant="ai" className="p-4 md:p-5">
      <SectionHeader
        kicker="Active model"
        title={genderLabel}
        className="mb-3"
        action={<ModelChip version={summary.model_version} />}
      />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        {facts.map(({ label, value }) => (
          <StatCard
            key={label}
            label={label}
            size="sm"
            value={
              <span className="block truncate text-base" title={value}>
                {value}
              </span>
            }
          />
        ))}
      </div>
    </Card>
  )
}

function CalibrationDeltaStrip({ holdout }: { holdout: HoldoutMetrics }) {
  const uncal = holdout.uncalibrated
  if (!uncal) return null

  const rows: { label: string; before?: number; after?: number }[] = [
    { label: 'Log loss', before: uncal.log_loss, after: holdout.log_loss },
    { label: 'Calibration error', before: uncal.ece, after: holdout.ece },
  ].filter((r) => typeof r.before === 'number' && typeof r.after === 'number')

  if (rows.length === 0) return null

  return (
    <div className="mt-4 rounded-xl border border-[var(--accent-ai)]/30 bg-[var(--accent-ai)]/8 p-3.5">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-ai)]">
        What calibration bought us
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {rows.map((r) => {
          const delta = (r.after as number) - (r.before as number)
          const improved = delta < 0
          return (
            <div key={r.label} className="text-[12px] text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">{r.label}:</span>{' '}
              <span className="tabular-nums">{num3(r.before)}</span>
              <span aria-hidden="true"> → </span>
              <span className="tabular-nums font-semibold text-[var(--text-primary)]">{num3(r.after)}</span>{' '}
              <span
                className={cn(
                  'tabular-nums font-semibold',
                  improved ? 'text-[var(--accent-primary)]' : 'text-[var(--accent-loss)]'
                )}
              >
                ({delta >= 0 ? '+' : ''}
                {delta.toFixed(3)})
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
        Raw model outputs vs the served (temperature-scaled and blended) probabilities on the same
        holdout matches. Lower is better for both.
      </p>
    </div>
  )
}

function HoldoutMetricsGrid({ holdout }: { holdout: HoldoutMetrics }) {
  return (
    <Card className="p-4 md:p-5">
      <SectionHeader
        kicker="Committed diagnostics"
        title="Holdout performance"
        description={`Measured on ${typeof holdout.n === 'number' ? holdout.n.toLocaleString() : 'a set of'} held-out matches the model never saw during training.`}
        className="mb-4"
      />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {HOLDOUT_METRICS.map((m) => {
          const value = holdout[m.key]
          return (
            <StatCard
              key={m.key}
              label={m.label}
              accent={m.key === 'accuracy' ? 'ai' : 'none'}
              value={m.format(typeof value === 'number' ? value : undefined)}
              sub={
                <>
                  <span className="text-[9px] font-semibold uppercase tracking-wider">
                    {m.better === 'higher' ? 'higher = better' : 'lower = better'}
                  </span>
                  <span className="mt-0.5 block leading-snug">{m.explanation}</span>
                </>
              }
            />
          )
        })}
      </div>
      <CalibrationDeltaStrip holdout={holdout} />
    </Card>
  )
}

function WalkforwardTable({ data }: { data: WalkforwardResponse }) {
  const leagues = data.leagues ?? []
  return (
    <Card className="p-4 md:p-5">
      <SectionHeader
        kicker="Backtest"
        title="Walk-forward backtests"
        description="Season-by-season simulation: train on the past, predict the next season, roll forward. Harsher than a single holdout split — it shows how the approach generalises league by league. Tournaments without enough eligible seasons are omitted."
        className="mb-3"
      />
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[var(--card-bg)]">
            <tr className="border-b border-[var(--border-color)] text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              <th scope="col" className="py-2 pr-3">League</th>
              <th scope="col" className="py-2 pr-3 text-right">Accuracy</th>
              <th scope="col" className="py-2 pr-3 text-right">Log loss</th>
              <th scope="col" className="py-2 pr-3 text-right">Brier</th>
              <th scope="col" className="py-2 pr-3 text-right">ECE</th>
              <th scope="col" className="py-2 text-right">Seasons</th>
            </tr>
          </thead>
          <tbody>
            {leagues.map((l) => (
              <tr
                key={l.league}
                className="border-b border-[var(--border-color)]/60 last:border-0 even:bg-[color-mix(in_srgb,var(--muted-bg)_40%,transparent)]"
              >
                <td className="py-2 pr-3 text-[12px] font-semibold text-[var(--text-primary)]">
                  {leagueDisplayName(l.league)}
                </td>
                <td className="py-2 pr-3 text-right text-[12px] tabular-nums text-[var(--text-primary)]">
                  {pct(l.accuracy_mean)}
                  <span className="ml-1 text-[10px] tabular-nums text-[var(--text-tertiary)]">
                    ±{(l.accuracy_std * 100).toFixed(1)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right text-[12px] tabular-nums text-[var(--text-secondary)]">
                  {num3(l.log_loss_mean)}
                </td>
                <td className="py-2 pr-3 text-right text-[12px] tabular-nums text-[var(--text-secondary)]">
                  {num3(l.brier_mean)}
                </td>
                <td className="py-2 pr-3 text-right text-[12px] tabular-nums text-[var(--text-secondary)]">
                  {num3(l.ece_mean)}
                </td>
                <td className="py-2 text-right text-[12px] tabular-nums text-[var(--text-tertiary)]">
                  {l.n_test_seasons}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.generated_at ? (
        <p className="mt-3 text-[10px] text-[var(--text-tertiary)]">
          Backtest generated {formatTrainedAt(data.generated_at)}.
        </p>
      ) : null}
    </Card>
  )
}

function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <Card className="p-4 md:p-5">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-48 rounded bg-[var(--muted-bg)]" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-[var(--muted-bg)]" />
        ))}
      </div>
    </Card>
  )
}

/* ---------------- page ---------------- */

export default function ModelTransparencyPage() {
  const { gender, asQueryParam } = useGenderQuery()

  const [modelSummary, setModelSummary] = useState<ModelSummaryResponse | null>(null)
  const [walkforward, setWalkforward] = useState<WalkforwardResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [summaryRes, wfRes] = await Promise.all([
          fetch(`/api/v1/ai/model-summary?gender=${asQueryParam}`, { cache: 'no-store' }),
          fetch('/api/v1/ai/walkforward', { cache: 'no-store' }),
        ])
        if (!cancelled) {
          setModelSummary(summaryRes.ok ? await summaryRes.json() : { available: false })
          setWalkforward(wfRes.ok ? await wfRes.json() : { available: false })
        }
      } catch {
        if (!cancelled) {
          setModelSummary({ available: false })
          setWalkforward({ available: false })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [asQueryParam])

  const genderLabel = gender === 'women' ? "Women's unified model" : "Men's unified model"
  const summary = modelSummary?.available ? modelSummary.summary : undefined

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-12">
      {/* HERO — compact band, cyan (AI) accent per the design contract */}
      <section className="hero-band surface-elevated relative isolate overflow-hidden rounded-2xl">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(55%_60%_at_10%_15%,color-mix(in_srgb,var(--accent-ai)_12%,transparent),transparent_60%)]"
        />
        <div className="relative z-10 flex flex-col items-start gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Pitchwise · AI transparency
            </p>
            <h1 className="mt-1 text-display font-extrabold tracking-tight text-[var(--text-primary)]">
              Model transparency
            </h1>
            <p className="mt-2 max-w-xl text-small text-[var(--text-secondary)]">
              What the unified model is, how it was calibrated, and how it actually scores on
              data it never trained on — for the {gender === 'women' ? "women's" : "men's"}{' '}
              universe. No cherry-picking: these are the committed diagnostics.
            </p>
            {summary?.model_version ? (
              <ModelChip version={summary.model_version} className="mt-3" />
            ) : null}
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <Link href="/predict">
              <ShimmerButton
                background="linear-gradient(135deg, var(--accent-ai), color-mix(in srgb, var(--accent-ai) 70%, var(--background)))"
                borderRadius="0.75rem"
                className="min-h-[44px] text-sm"
              >
                Run a prediction
                <ArrowRight className="ml-1.5 inline h-3.5 w-3.5" />
              </ShimmerButton>
            </Link>
            <Link
              href="/accuracy"
              className="inline-flex min-h-[40px] items-center gap-1 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)] hover:underline"
            >
              Live accuracy tracking
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </section>

      {/* MODEL CARD + HOLDOUT */}
      <section className="mt-6 flex flex-col gap-4" aria-label="Model summary">
        {loading ? (
          <>
            <SectionSkeleton rows={1} />
            <SectionSkeleton rows={2} />
          </>
        ) : summary ? (
          <>
            <ModelIdentityCard summary={summary} genderLabel={genderLabel} />
            {summary.holdout ? (
              <HoldoutMetricsGrid holdout={summary.holdout} />
            ) : (
              <Card className="p-4 md:p-5">
                <EmptyState
                  illustration="searching"
                  title="Holdout metrics not published yet"
                  description="This model summary doesn't include holdout results. They are written alongside the summary on the next retrain."
                />
              </Card>
            )}
          </>
        ) : (
          <Card className="p-4 md:p-5">
            <EmptyState
              illustration="searching"
              title={`${genderLabel} summary not published yet`}
              description="The transparency summary is generated the next time the unified model is retrained. Until then this page won't guess — check the Accuracy page for live, settled-prediction metrics."
              action={
                <Link
                  href="/accuracy"
                  className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-primary)] hover:bg-[var(--card-hover)]"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  View live accuracy
                </Link>
              }
            />
          </Card>
        )}
      </section>

      {/* WALK-FORWARD */}
      <section className="mt-4" aria-label="Walk-forward backtests">
        {loading ? (
          <SectionSkeleton rows={3} />
        ) : walkforward?.available && (walkforward.leagues?.length ?? 0) > 0 ? (
          <WalkforwardTable data={walkforward} />
        ) : (
          <Card className="p-4 md:p-5">
            <EmptyState
              illustration="no-tracked"
              title="No walk-forward backtests available"
              description="Per-league walk-forward diagnostics haven't been generated yet, so there's nothing honest to show here."
            />
          </Card>
        )}
      </section>

      {/* FOOTNOTE */}
      <p className="mt-6 text-center text-[10px] text-[var(--text-tertiary)]">
        All figures come from committed diagnostics files — nothing on this page is estimated
        client-side. Predictions are for educational/entertainment purposes only.
      </p>
    </div>
  )
}
