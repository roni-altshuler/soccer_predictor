import fs from 'fs'
import path from 'path'

import Link from 'next/link'
import {
  ArrowRight,
  BarChart3,
  Brain,
  Database,
  Eye,
  Gauge,
  History as HistoryIcon,
  LineChart,
  ShieldAlert,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react'

import { SectionHeader, StatCard } from '@/components/primitives'
import { Card } from '@/components/ui/card'

export const metadata = {
  title: 'About · Pitchwise',
  description:
    'Pitchwise turns live football coverage into calibrated predictions — a unified neural model, honest accuracy tracking, and a single dashboard for every league.',
}

// Re-read the committed training summaries on every request so the numbers
// track the latest retrain (mirrors /api/v1/ai/model-summary).
export const dynamic = 'force-dynamic'

interface ModelSummary {
  model_version: string
  trained_at: string
  n_parameters: number
  n_features: number
  vocab_sizes: { leagues: number; teams: number; referees: number; phases: number }
  holdout: { accuracy: number; brier: number; ece: number; n: number }
}

/**
 * Read a per-gender unified-model training summary from the committed
 * diagnostics JSON (same source as /api/v1/ai/model-summary). Returns null
 * when the file is missing, malformed, or the holdout sample is too small to
 * quote (rule 3: no metrics from windows with n < 10).
 */
function readModelSummary(file: string): ModelSummary | null {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), 'backend', 'data', 'diagnostics', file),
      'utf-8'
    )
    const summary = JSON.parse(raw) as ModelSummary
    const h = summary?.holdout
    if (
      !h ||
      typeof h.accuracy !== 'number' ||
      typeof h.brier !== 'number' ||
      typeof h.ece !== 'number' ||
      !(typeof h.n === 'number' && h.n >= 10)
    ) {
      return null
    }
    return summary
  } catch {
    return null
  }
}

function formatTrainedAt(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Cyan model chip — `unified-multitask…` displays as "Unified v2". */
function ModelChip() {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]"
      style={{
        color: 'var(--accent-ai)',
        backgroundColor: 'color-mix(in srgb, var(--accent-ai) 12%, transparent)',
      }}
    >
      Unified v2
    </span>
  )
}

const PRINCIPLES = [
  {
    Icon: Target,
    title: 'Calibration over hype',
    body: 'A 60% pick should win 60% of the time. We publish Brier score and ECE on every model so confidence is grounded in math, not vibes.',
  },
  {
    Icon: Eye,
    title: 'Honest by default',
    body: 'Every prediction is logged, every outcome is settled, every miss is visible on /history. No retroactive cherry-picking.',
  },
  {
    Icon: ShieldAlert,
    title: 'Educational only',
    body: 'Pitchwise is a research and visualisation tool. It is not a betting product. We do not optimise for odds.',
  },
]

const PIPELINE = [
  {
    Icon: Database,
    step: '01',
    title: 'Ingest',
    body: 'ESPN scoreboard, league standings, top scorers, and historical match records feed a unified SQLite warehouse.',
  },
  {
    Icon: Brain,
    step: '02',
    title: 'Predict',
    body: 'A per-gender unified neural model (men + women) blends with a Bradley-Terry baseline to produce home/draw/away probabilities and expected scorelines.',
  },
  {
    Icon: LineChart,
    step: '03',
    title: 'Audit',
    body: 'Every settled match updates accuracy, calibration, and per-league drift signals. The model is held to a sportsbook-style quality gate.',
  },
  {
    Icon: Zap,
    step: '04',
    title: 'Adapt',
    body: 'Three times a day, the online-learning pipeline retunes blend weights and draw thresholds per league, then rolls forward.',
  },
]

const FEATURES = [
  {
    href: '/predict',
    Icon: Brain,
    title: 'AI Predict',
    desc: 'Run a fixture through the unified model. Outcome probabilities, expected goals, and most-likely scoreline with calibrated confidence.',
  },
  {
    href: '/accuracy',
    Icon: BarChart3,
    title: 'Accuracy',
    desc: 'Public-facing model performance — Brier, calibration plot, confusion matrix, and the running win rate against the 33% random baseline.',
  },
  {
    href: '/diagnostics',
    Icon: Gauge,
    title: 'Diagnostics',
    desc: 'Engineer-facing quality gates, drift detection, league-by-league audit, and the continuous-learning loop.',
  },
  {
    href: '/simulator',
    Icon: Sparkles,
    title: 'Championship Simulator',
    desc: 'Monte Carlo league simulation with what-if fixture overrides. Watch how a single result reshapes the title race.',
  },
  {
    href: '/history',
    Icon: HistoryIcon,
    title: 'Prediction History',
    desc: 'Every pick the model has ever made. Filter by correct, incorrect, or pending. Export to CSV.',
  },
]

// The warehouse's ingestion loaders (backend/services/data/) — real sources,
// each surfaced in the product via the data-provenance badge.
const DATA_SOURCES = [
  { name: 'ESPN', role: 'Live scores, fixtures, standings, and news' },
  { name: 'FotMob', role: 'Match detail and lineup enrichment' },
  { name: 'football-data.co.uk', role: 'Historical results archive' },
  { name: 'ClubElo', role: 'Long-run team strength ratings' },
  { name: 'OpenFootball', role: 'Open fixture and season data' },
  { name: 'FBref', role: 'Advanced team statistics' },
  { name: 'Understat', role: 'Expected-goals (xG) histories' },
  { name: 'Open-Meteo', role: 'Matchday weather conditions' },
]

export default function AboutPage() {
  const men = readModelSummary('unified_men_summary.json')
  const women = readModelSummary('unified_women_summary.json')
  const heroStat = men ?? women

  const modelRows = [
    { key: 'men', label: "Men's model", summary: men },
    { key: 'women', label: "Women's model", summary: women },
  ].filter((row): row is { key: string; label: string; summary: ModelSummary } => row.summary != null)

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[var(--shell-content-max)] space-y-10 px-4 py-6 md:px-8">
        {/* Compact hero band */}
        <section className="hero-band surface-elevated p-6 md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)]">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Calibrated football intelligence
              </span>
              <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight text-[var(--text-primary)] md:text-4xl">
                Pitchwise turns live football into{' '}
                <span className="bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-ai)] bg-clip-text text-transparent">
                  honest probabilities
                </span>
                .
              </h1>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)] md:text-base">
                One dashboard, every major league — a unified model that publishes its
                confidence, tracks every miss, and re-trains on outcomes three times a day,
                for both the men&apos;s and women&apos;s game.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link
                  href="/predict"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-on-primary)] shadow-md shadow-[var(--accent-primary)]/20 transition-all hover:translate-y-[-1px] hover:shadow-lg"
                >
                  Run a prediction <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
                <Link
                  href="/accuracy"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent-primary)] hover:bg-[var(--card-hover)]"
                >
                  See accuracy <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
            {heroStat && (
              <div className="flex-shrink-0 md:pl-6 md:text-right">
                <p className="text-4xl font-black leading-none tabular-nums text-[var(--accent-ai)]">
                  {Math.round(heroStat.holdout.accuracy * 100)}%
                </p>
                <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  Holdout accuracy
                </p>
                <p className="mt-0.5 text-xs tabular-nums text-[var(--text-tertiary)]">
                  {heroStat.holdout.n.toLocaleString('en-US')} unseen matches ·{' '}
                  {heroStat === men ? "men's model" : "women's model"}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Principles row */}
        <section>
          <SectionHeader
            kicker="What we stand for"
            title="Three principles"
            className="mb-4"
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PRINCIPLES.map(({ Icon, title, body }) => (
              <Card key={title} className="relative overflow-hidden p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-bold text-[var(--text-primary)]">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {body}
                </p>
              </Card>
            ))}
          </div>
        </section>

        {/* Pipeline */}
        <section>
          <SectionHeader
            kicker="How the AI works"
            title="Observe → Predict → Audit → Adapt"
            action={
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)] md:inline">
                Loop runs 3× daily
              </span>
            }
            className="mb-4"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map(({ Icon, step, title, body }, idx) => (
              <Card key={title} className="relative overflow-hidden p-5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-[var(--text-tertiary)]">
                    {step}
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-ai)]/12 text-[var(--accent-ai)]">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                </div>
                <h3 className="mt-3 text-base font-bold text-[var(--text-primary)]">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {body}
                </p>
                {idx < PIPELINE.length - 1 && (
                  <ArrowRight
                    aria-hidden="true"
                    className="absolute -right-2 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)] lg:block"
                  />
                )}
              </Card>
            ))}
          </div>
        </section>

        {/* The model at a glance — real holdout numbers from the training summary */}
        {modelRows.length > 0 && (
          <section>
            <SectionHeader
              kicker="Model transparency"
              title="The model at a glance"
              description="Holdout metrics from the latest training run — matches the model never saw in training, recomputed and republished on every retrain."
              className="mb-4"
            />
            <div className="space-y-6">
              {modelRows.map(({ key, label, summary }) => {
                const trained = formatTrainedAt(summary.trained_at)
                const { holdout, vocab_sizes: vocab, n_features: nFeatures } = summary
                return (
                  <div key={key}>
                    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <ModelChip />
                      <span className="text-sm font-bold text-[var(--text-primary)]">{label}</span>
                      <span className="text-xs tabular-nums text-[var(--text-tertiary)]">
                        {trained ? `retrained ${trained} · ` : ''}
                        {vocab.teams.toLocaleString('en-US')} teams · {nFeatures} features
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <StatCard
                        label="Holdout accuracy"
                        value={`${Math.round(holdout.accuracy * 100)}%`}
                        accent="ai"
                        sub="vs 33% random baseline"
                        size="sm"
                      />
                      <StatCard
                        label="Brier score"
                        value={holdout.brier.toFixed(3)}
                        sub="3-way outcome · lower is better"
                        size="sm"
                      />
                      <StatCard
                        label="Calibration error"
                        value={`${(holdout.ece * 100).toFixed(1)}%`}
                        sub="ECE after calibration"
                        size="sm"
                      />
                      <StatCard
                        label="Holdout matches"
                        value={holdout.n.toLocaleString('en-US')}
                        sub="settled, unseen in training"
                        size="sm"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Surfaces */}
        <section>
          <SectionHeader
            kicker="The product"
            title="Five surfaces, one model"
            description="The same unified prediction engine powers every page. Toggle between the men's and women's universes from the top bar at any time."
            className="mb-4"
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ href, Icon, title, desc }) => (
              <Link
                key={href}
                href={href}
                className="group relative block overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 transition-all hover:-translate-y-0.5 hover:border-[var(--accent-primary)]/45 hover:shadow-lg"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--muted-bg)] text-[var(--accent-primary)] transition-colors group-hover:bg-[var(--accent-primary)]/15">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
                      <ArrowRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent-primary)]"
                      />
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-tertiary)]">
                      {desc}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Data sources */}
        <section>
          <SectionHeader
            kicker="Where the numbers come from"
            title="Data sources"
            description="Dedicated ingestion loaders feed one SQLite warehouse; every match surface shows its provenance badge, and missing provider fields are never back-filled with placeholders."
            className="mb-4"
          />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {DATA_SOURCES.map(({ name, role }) => (
              <div
                key={name}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3.5"
              >
                <p className="text-sm font-semibold text-[var(--text-primary)]">{name}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-tertiary)]">{role}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Tech credits */}
        <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5 md:p-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                Frontend
              </p>
              <p className="mt-1.5 text-sm font-semibold text-[var(--text-primary)]">
                Next.js 15 · React 18 · Tailwind
              </p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                App Router, server components for data routes, client components for
                interactive surfaces. Magic UI primitives for hero polish.
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                Backend
              </p>
              <p className="mt-1.5 text-sm font-semibold text-[var(--text-primary)]">
                FastAPI · PyTorch · SQLite warehouse
              </p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Unified per-gender neural model, Bradley-Terry baseline, league-specific
                draw calibration, and a seeded Monte Carlo engine for league simulation.
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                Pipeline
              </p>
              <p className="mt-1.5 text-sm font-semibold text-[var(--text-primary)]">
                GitHub Actions · 3× daily online learning
              </p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                Settles outcomes, generates next-7-day picks, retunes blend weights per
                league, and auto-commits the predictions JSON back to main.
              </p>
            </div>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="rounded-2xl border border-[var(--accent-warn)]/30 bg-[var(--accent-warn)]/8 p-5 md:p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-warn)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-[var(--text-primary)]">
                Educational only — not a betting product
              </p>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--text-secondary)]">
                Pitchwise is a personal research project for visualising calibrated football
                probabilities. It cannot model injuries, weather, red cards, or tactical
                changes — and even a well-calibrated model loses regularly. Do not use these
                outputs for betting or any financial decision.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
