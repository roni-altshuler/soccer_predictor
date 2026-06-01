import { Brain, Database, LineChart, Zap } from 'lucide-react'

import { Section, SectionHeader } from './primitives/Section'
import { Reveal, RevealGroup, RevealItem } from './primitives/Reveal'

const STEPS = [
  {
    Icon: Database,
    step: '01',
    title: 'Ingest',
    body: 'Live ESPN scoreboards, standings, scorers, and decades of historical results feed a unified match warehouse — for the men’s and women’s game.',
    accent: 'var(--accent-ai)',
  },
  {
    Icon: Brain,
    step: '02',
    title: 'Predict',
    body: 'A per-gender unified neural model blends with an ELO-Poisson baseline to produce home/draw/away probabilities, expected goals, and a full scoreline distribution.',
    accent: 'var(--accent-primary)',
  },
  {
    Icon: LineChart,
    step: '03',
    title: 'Audit',
    body: 'Every settled match updates accuracy, calibration, and per-league drift. The model is held to a sportsbook-style quality gate — and every miss stays visible.',
    accent: 'var(--accent-warn)',
  },
  {
    Icon: Zap,
    step: '04',
    title: 'Adapt',
    body: 'Three times a day the online-learning pipeline re-tunes blend weights and draw thresholds per league, then rolls the improved model forward automatically.',
    accent: 'var(--accent-ai)',
  },
]

export function HowItWorks() {
  return (
    <Section id="how-it-works" labelledBy="how-it-works-heading" className="mkt-section-glow">
      <Reveal>
        <SectionHeader
          eyebrow="How the AI works"
          titleId="how-it-works-heading"
          title={
            <>
              Observe. Predict. Audit.{' '}
              <span className="mkt-headline-gradient">Adapt.</span>
            </>
          }
          lede="A closed loop that never stops learning. Each step is transparent — you can inspect the model's confidence, its accuracy, and how it changed after the whistle."
        />
      </Reveal>

      <RevealGroup className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(({ Icon, step, title, body, accent }) => (
          <RevealItem key={title}>
            <div className="group relative h-full overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lg)]">
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-0.5 opacity-60"
                style={{ background: accent }}
              />
              <div className="flex items-center justify-between">
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-numeric text-sm font-bold text-[var(--text-tertiary)]">{step}</span>
              </div>
              <h3 className="mt-5 text-lg font-bold text-[var(--text-primary)]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{body}</p>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  )
}
