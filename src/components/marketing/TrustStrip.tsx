import { Eye, ShieldAlert, Target } from 'lucide-react'

import { Section, SectionHeader } from './primitives/Section'
import { Reveal, RevealGroup, RevealItem } from './primitives/Reveal'

const PRINCIPLES = [
  {
    Icon: Target,
    title: 'Calibration over hype',
    body: 'A 60% pick should win 60% of the time. We publish Brier score and calibration on every model, so confidence is grounded in math — not vibes.',
  },
  {
    Icon: Eye,
    title: 'Honest by default',
    body: 'Every prediction is logged, every outcome is settled, every miss is visible. No retroactive cherry-picking, ever — and never a fabricated stat.',
  },
  {
    Icon: ShieldAlert,
    title: 'Educational only',
    body: 'Pitchwise is a research and visualisation tool, not a betting product. We do not optimise for odds and we never give betting advice.',
  },
]

export function TrustStrip() {
  return (
    <Section labelledBy="trust-heading">
      <Reveal>
        <SectionHeader
          eyebrow="What we stand for"
          titleId="trust-heading"
          title="Built to be trusted, not just believed"
          lede="Most prediction sites show you a number and ask you to take it on faith. Pitchwise shows you the track record behind it."
        />
      </Reveal>

      <RevealGroup className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
        {PRINCIPLES.map(({ Icon, title, body }) => (
          <RevealItem key={title}>
            <div className="h-full rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-lg font-bold text-[var(--text-primary)]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{body}</p>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>

      {/* Disclaimer banner */}
      <Reveal delay={0.1}>
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-[var(--accent-warn)]/30 bg-[var(--accent-warn)]/8 p-5 md:p-6">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-warn)]" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-[var(--text-primary)]">
              Educational only — not a betting product
            </p>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--text-secondary)]">
              Pitchwise is a personal research project for visualising calibrated football
              probabilities. It cannot model injuries, weather, red cards, or tactical changes —
              and even a well-calibrated model loses regularly. Do not use these outputs for
              betting or any financial decision.
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  )
}
