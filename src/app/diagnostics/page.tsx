import { Activity, Eye, RefreshCw, Repeat, TrendingUp, Wrench } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import TrackingCenter from '@/components/tracking/TrackingCenter'

type DiagnosticsView = 'overview' | 'diagnostics' | 'learning' | 'fan'

function resolveInitialView(value: string | string[] | undefined): DiagnosticsView {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === 'overview' || raw === 'learning' || raw === 'fan') return raw
  return 'diagnostics'
}

/**
 * Engineer-facing model audit. The public-facing "How accurate is the
 * AI?" view lives at /accuracy; this page keeps the deeper instruments
 * — quality gates, calibration drift, league-by-league audit, learning
 * loop visualisations — under their own URL so a casual visitor isn't
 * dropped into a dense dashboard by accident.
 */
export default function DiagnosticsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const initialView = resolveInitialView(searchParams?.view)

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[var(--shell-content-max)] space-y-5 px-4 py-6 md:px-8">
        {/* Hero — matches the language of /accuracy and /predict heros */}
        <section className="relative isolate overflow-hidden rounded-3xl border border-[var(--border-color)]">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[radial-gradient(55%_55%_at_12%_15%,color-mix(in_srgb,var(--accent-ai)_22%,transparent),transparent_60%),radial-gradient(45%_45%_at_88%_25%,color-mix(in_srgb,var(--accent-primary)_18%,transparent),transparent_60%)]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-ai)]/40 to-transparent"
          />
          <div className="relative z-10 flex flex-col gap-5 p-6 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <Badge
                  variant="outline"
                  className="border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]"
                >
                  <Wrench className="mr-1 h-3 w-3" aria-hidden="true" /> Engineer surface
                </Badge>
                <h1 className="font-display text-[clamp(1.8rem,3.8vw,2.8rem)] font-extrabold leading-[1.05] tracking-tight text-[var(--text-primary)]">
                  Model diagnostics
                </h1>
                <p className="max-w-2xl text-[15px] leading-relaxed text-[var(--text-secondary)]">
                  Quality gates, calibration drift, confusion matrices, league-by-league walk-forward
                  audit, and the continuous-learning loop that retunes blend weights and draw thresholds.
                  Looking for the simple version?{' '}
                  <a href="/accuracy" className="font-semibold text-[var(--accent-primary)] underline-offset-4 hover:underline">
                    See /accuracy
                  </a>
                  .
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <DomainChip tone="primary" Icon={Activity} label="Outcome + Scoreline" />
                <DomainChip tone="ai" Icon={TrendingUp} label="Calibration + Learning" />
                <DomainChip tone="violet" Icon={Eye} label="Personal Team Tracking" />
              </div>
            </div>
          </div>
        </section>

        <TrackingCenter initialView={initialView} />

        {/* Continuous learning pipeline */}
        <section className="bento-card p-5 md:p-6">
          <div className="mb-4 flex items-center gap-2">
            <Repeat className="h-4 w-4 text-[var(--accent-ai)]" aria-hidden="true" />
            <h2 className="text-h4 font-bold text-[var(--text-primary)]">
              Continuous learning pipeline
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            {[
              { Icon: Eye, step: 'Observe outcomes', desc: 'Finished matches synced and labelled by league + gender.', tone: 'ai' as const },
              { Icon: Activity, step: 'Diagnose drift', desc: 'Calibration, confusion, and walk-forward checks.', tone: 'warn' as const },
              { Icon: Wrench, step: 'Retune league bias', desc: 'Blend weights and draw thresholds auto-tuned.', tone: 'primary' as const },
              { Icon: RefreshCw, step: 'Predict better', desc: 'Next fixtures use updated league characteristics.', tone: 'ai' as const },
            ].map(({ Icon, step, desc, tone }, idx, arr) => (
              <div
                key={step}
                className="relative rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)]/70 p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={
                      tone === 'primary'
                        ? 'flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                        : tone === 'warn'
                          ? 'flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-warn)]/15 text-[var(--accent-warn)]'
                          : 'flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-ai)]/15 text-[var(--accent-ai)]'
                    }
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                    Step {idx + 1} / {arr.length}
                  </span>
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{step}</p>
                <p className="mt-1 text-[12px] leading-snug text-[var(--text-tertiary)]">{desc}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function DomainChip({
  tone,
  Icon,
  label,
}: {
  tone: 'primary' | 'ai' | 'violet'
  Icon: typeof Activity
  label: string
}) {
  const cls =
    tone === 'primary'
      ? 'border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]'
      : tone === 'ai'
        ? 'border-[var(--accent-ai)]/30 bg-[var(--accent-ai)]/12 text-[var(--accent-ai)]'
        : 'border-violet-500/30 bg-violet-500/12 text-violet-300'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${cls}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  )
}

export const metadata = {
  title: 'Model Diagnostics | FotPredict AI',
  description: 'Engineer-facing view of the unified prediction model: quality gates, calibration drift, confusion matrices, and the continuous learning loop.',
}
