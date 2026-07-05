import { Cpu, Database, GitBranch, Layers } from 'lucide-react'

import { NumberTicker } from '@/components/magicui/number-ticker'
import { Section, SectionHeader } from './primitives/Section'
import { Reveal, RevealGroup, RevealItem } from './primitives/Reveal'

const STATS: { value: number; dp: number; suffix?: string; prefix?: string; label: string; sub: string }[] = [
  { value: 60.5, dp: 1, suffix: '%', label: "Men's accuracy", sub: '11,661-match holdout' },
  { value: 51.45, dp: 2, suffix: '%', label: "Women's accuracy", sub: '482-match holdout' },
  { value: 52.1, dp: 1, suffix: '%', label: 'Top-5 scoreline hit', sub: 'score in 5 likeliest · holdout' },
  { value: 0.865, dp: 3, label: 'Log loss', sub: 'holdout · lower is better' },
  { value: 80, dp: 0, suffix: '+', label: 'Engineered features', sub: 'ELO · form · weather · refs' },
  { value: 21, dp: 0, suffix: '%', label: 'Draw recall', sub: 'holdout · the hardest class' },
]

const STACK = [
  {
    Icon: Layers,
    title: 'Unified neural model',
    body: 'A per-gender multi-task network predicts outcome, expected goals, and goal correlation jointly — with an ELO-Poisson (Dixon-Coles) baseline as a calibrated fallback.',
  },
  {
    Icon: Database,
    title: 'A single match warehouse',
    body: 'ESPN, FotMob, FBref, Understat, ClubElo and more are reconciled into one store, with a weekly data-quality gate that fails CI on stale or missing sources.',
  },
  {
    Icon: GitBranch,
    title: 'Continuous online learning',
    body: 'Three times a day the pipeline settles outcomes, generates the next week of picks, re-tunes per-league blend weights, and rolls the model forward — fully automated.',
  },
  {
    Icon: Cpu,
    title: 'Next.js 15 · FastAPI · PyTorch',
    body: 'Server-first React for data routes, a typed FastAPI inference layer, and a seeded Monte Carlo engine for league and tournament simulation.',
  },
]

export function TechnicalCredibility() {
  return (
    <Section id="technology" labelledBy="technology-heading" className="bg-[var(--background-secondary)]">
      <Reveal>
        <SectionHeader
          eyebrow="Under the hood"
          titleId="technology-heading"
          title={
            <>
              Numbers that hold up to <span className="mkt-headline-gradient">scrutiny</span>.
            </>
          }
          lede="We publish the metrics that matter for a probabilistic model — not just accuracy, but calibration and the classes everyone else gets wrong."
        />
      </Reveal>

      {/* Stat grid */}
      <RevealGroup className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--border-color)] md:grid-cols-3">
        {STATS.map((s) => (
          <RevealItem key={s.label} className="bg-[var(--card-bg)]">
            <div className="flex h-full flex-col gap-1 p-6">
              <span className="font-numeric text-3xl font-extrabold tabular-nums text-[var(--text-primary)] md:text-4xl">
                <NumberTicker value={s.value} decimalPlaces={s.dp} suffix={s.suffix} prefix={s.prefix} />
              </span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">{s.label}</span>
              <span className="text-xs text-[var(--text-tertiary)]">{s.sub}</span>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>

      {/* Architecture cards */}
      <RevealGroup className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
        {STACK.map(({ Icon, title, body }, idx) => (
          <RevealItem key={title}>
            <div className="relative h-full overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
              {idx === 0 ? (
                // Featured-card accent: static hairline (BorderBeam's mask
                // composite floods the card in some renderers — see followups).
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-ai)] to-transparent"
                />
              ) : null}
              <div className="flex items-start gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-ai)]/12 text-[var(--accent-ai)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">{body}</p>
                </div>
              </div>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  )
}
