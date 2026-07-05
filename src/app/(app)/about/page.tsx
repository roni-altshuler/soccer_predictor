import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

import { Card } from '@/components/ui/card'

export const metadata = {
  title: 'About · Pitchwise',
  description:
    'Pitchwise turns live football coverage into calibrated predictions — a unified neural model, honest accuracy tracking, and a single dashboard for every league.',
}

const PRINCIPLES = [
  {
    title: 'Calibration over hype',
    body: 'A 60% pick should win 60% of the time. Brier score and calibration error are published for every model so confidence is grounded in math, not vibes.',
  },
  {
    title: 'Honest by default',
    body: 'Every prediction is logged, every outcome is settled, every miss stays visible in the history. No retroactive cherry-picking.',
  },
  {
    title: 'Educational only',
    body: 'Pitchwise is a research and visualisation tool, not a betting product. It does not optimise for odds.',
  },
]

const HOW_IT_WORKS = [
  {
    title: 'Ingest',
    body: 'Live scoreboards, standings, scorers, and historical match records feed a single match warehouse.',
  },
  {
    title: 'Predict',
    body: 'A per-gender neural model — one for the men’s game, one for the women’s — produces home/draw/away probabilities and expected scorelines for upcoming fixtures.',
  },
  {
    title: 'Audit',
    body: 'Every settled match updates accuracy and calibration. Results are published openly on the accuracy page.',
  },
  {
    title: 'Adapt',
    body: 'Three times a day the pipeline settles outcomes, refreshes picks for the week ahead, and retunes itself per league.',
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
      {children}
    </h2>
  )
}

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-4">
      <h1 className="px-1 pb-1 text-lg font-bold tracking-tight text-[var(--text-primary)]">
        About Pitchwise
      </h1>
      <p className="px-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
        Live scores for the men&apos;s and women&apos;s game, with calibrated AI match
        predictions alongside them. Every pick is logged and settled in public — see{' '}
        <Link href="/accuracy" className="font-semibold text-[var(--accent-primary)] hover:underline">
          how the model is doing
        </Link>
        .
      </p>

      <div className="mt-4 space-y-3">
        {/* How it works */}
        <Card className="p-4">
          <SectionTitle>How predictions work</SectionTitle>
          <ol className="mt-2 space-y-2">
            {HOW_IT_WORKS.map(({ title, body }, i) => (
              <li key={title} className="flex gap-3 text-[13px] leading-relaxed">
                <span className="w-4 shrink-0 text-right font-semibold tabular-nums text-[var(--text-tertiary)]">
                  {i + 1}
                </span>
                <span className="text-[var(--text-secondary)]">
                  <span className="font-semibold text-[var(--text-primary)]">{title}.</span>{' '}
                  {body}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-[var(--border-color)]/40 pt-3 text-[12px] text-[var(--text-tertiary)]">
            Model quality — accuracy, Brier score, calibration — is published on{' '}
            <Link href="/accuracy" className="font-semibold text-[var(--accent-primary)] hover:underline">
              Accuracy
            </Link>{' '}
            and updated after every settled match.
          </p>
        </Card>

        {/* Principles */}
        <Card className="p-4">
          <SectionTitle>Principles</SectionTitle>
          <ul className="mt-2 space-y-2">
            {PRINCIPLES.map(({ title, body }) => (
              <li key={title} className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text-primary)]">{title}.</span> {body}
              </li>
            ))}
          </ul>
        </Card>

        {/* Data provenance credits */}
        <Card className="overflow-hidden p-0">
          <div className="p-4 pb-2">
            <SectionTitle>Where the numbers come from</SectionTitle>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
              Dedicated ingestion loaders feed one match warehouse; every match surface
              shows its provenance badge, and missing provider fields are never
              back-filled with placeholders.
            </p>
          </div>
          <ul className="divide-y divide-[var(--border-color)]/40 border-t border-[var(--border-color)]/40">
            {DATA_SOURCES.map(({ name, role }) => (
              <li key={name} className="flex items-baseline gap-3 px-4 py-2">
                <span className="w-40 shrink-0 truncate text-[13px] font-semibold text-[var(--text-primary)]">
                  {name}
                </span>
                <span className="min-w-0 text-[12px] text-[var(--text-tertiary)]">{role}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Educational disclaimer */}
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-warn)]"
              aria-hidden="true"
            />
            <div>
              <p className="text-[13px] font-bold text-[var(--text-primary)]">
                Educational only — not a betting product
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                Pitchwise is a personal research project for visualising calibrated
                football probabilities. It cannot model injuries, weather, red cards, or
                tactical changes — and even a well-calibrated model loses regularly. Do
                not use these outputs for betting or any financial decision.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
