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

import { BorderBeam } from '@/components/magicui/border-beam'
import { Spotlight } from '@/components/magicui/spotlight'
import { Card } from '@/components/ui/card'

export const metadata = {
  title: 'About · Pitchwise',
  description:
    'Pitchwise turns live football coverage into calibrated predictions — a unified neural model, honest accuracy tracking, and a single dashboard for every league.',
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

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[var(--shell-content-max)] space-y-8 px-4 py-6 md:px-8">
        {/* Hero */}
        <Spotlight
          className="relative block rounded-3xl"
          size={520}
          color="color-mix(in srgb, var(--accent-primary) 18%, transparent)"
        >
          <section className="relative isolate overflow-hidden rounded-3xl border border-[var(--border-color)]">
            <BorderBeam size={1} duration={14} borderRadius={24} colorFrom="var(--accent-primary)" colorTo="var(--accent-ai)" />
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10 bg-[radial-gradient(55%_55%_at_15%_15%,color-mix(in_srgb,var(--accent-primary)_22%,transparent),transparent_60%),radial-gradient(45%_45%_at_85%_25%,color-mix(in_srgb,var(--accent-ai)_18%,transparent),transparent_60%)]"
            />
            <div className="relative z-10 flex flex-col gap-6 p-6 md:p-10">
              <div className="space-y-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)]">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Calibrated football intelligence
                </span>
                <h1 className="font-display text-[clamp(2rem,5vw,3.4rem)] font-extrabold leading-[1.02] tracking-tight text-[var(--text-primary)]">
                  Pitchwise turns live football <br className="hidden md:block" />
                  into{' '}
                  <span className="bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-ai)] bg-clip-text text-transparent">
                    honest probabilities
                  </span>
                  .
                </h1>
                <p className="max-w-2xl text-base leading-relaxed text-[var(--text-secondary)] md:text-lg">
                  One dashboard. Every major league. A unified model that publishes its
                  confidence, tracks every miss, and re-trains on outcomes — three times a day,
                  for both the men&apos;s and women&apos;s game.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/predict"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-on-primary)] shadow-md shadow-emerald-500/20 transition-all hover:translate-y-[-1px] hover:shadow-lg"
                >
                  Run a prediction <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
                <Link
                  href="/accuracy"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent-primary)] hover:bg-[var(--card-hover)]"
                >
                  See accuracy <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>
        </Spotlight>

        {/* Principles row */}
        <section>
          <header className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                What we stand for
              </p>
              <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-[var(--text-primary)]">
                Three principles
              </h2>
            </div>
          </header>
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
          <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                How the AI works
              </p>
              <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-[var(--text-primary)]">
                Observe → Predict → Audit → Adapt
              </h2>
            </div>
            <span className="hidden text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] md:inline">
              Loop runs 3× daily
            </span>
          </header>
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

        {/* Surfaces */}
        <section>
          <header className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              The product
            </p>
            <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-[var(--text-primary)]">
              Five surfaces, one model
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
              The same unified prediction engine powers every page. Toggle between the
              men&apos;s and women&apos;s universes from the top bar at any time.
            </p>
          </header>
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
