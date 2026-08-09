import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

import { Card } from '@/components/ui/card'

export const metadata = {
  title: 'About',
  description:
    'Pitchverse pairs live football scores with AI match predictions, honest accuracy tracking, and a single dashboard for every league.',
}

const PRINCIPLES = [
  {
    title: 'Calibration over hype',
    body: 'When we say 60%, it should happen about 60% of the time. The running track record — including every miss — is published openly so confidence is grounded in results, not vibes.',
  },
  {
    title: 'Honest by default',
    body: 'Every prediction is logged, every outcome is settled, every miss stays visible in the history. No retroactive cherry-picking.',
  },
  {
    title: 'Educational only',
    body: 'Pitchverse is a research and visualisation tool, not a betting product. It does not optimise for odds.',
  },
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
        About Pitchverse
      </h1>
      <p className="px-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
        Live scores for the men&apos;s and women&apos;s game, with AI match predictions
        alongside them. Every pick is logged and settled in public — see{' '}
        <Link href="/accuracy" className="font-semibold text-[var(--accent-primary)] hover:underline">
          how the predictions are doing
        </Link>
        .
      </p>

      <div className="mt-4 space-y-3">
        {/* How it works — short plain-language explainer */}
        <Card className="p-4">
          <SectionTitle>How predictions work</SectionTitle>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            Predictions come from a Dixon-Coles goal model fitted on years of match
            history in the five leagues Pitchverse covers. Every prediction is recorded
            before kick-off and publicly scored once the result is in — the running
            tally lives on the{' '}
            <Link href="/accuracy" className="font-semibold text-[var(--accent-primary)] hover:underline">
              Accuracy
            </Link>{' '}
            page, alongside the same numbers for the bookmaker&apos;s closing price. The
            model currently trails that closing price, and the page says so.
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
                Pitchverse is a personal research project for visualising football
                probabilities. Football is unpredictable — injuries, red cards, and
                tactical surprises happen, and even a strong prediction loses
                regularly. Do not use these outputs for betting or any financial
                decision.
              </p>
            </div>
          </div>
        </Card>

        {/* Where to go next — /about should open doors, not close them */}
        <Card className="overflow-hidden p-0">
          <p className="border-b border-[var(--border-color)]/40 bg-[var(--background-secondary)]/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            Explore Pitchverse
          </p>
          <ul className="divide-y divide-[var(--border-color)]/40">
            {[
              { href: '/', title: 'Match centre', desc: "Today's scores and fixtures with AI picks alongside" },
              { href: '/predict', title: 'AI predict', desc: 'Run the model on any matchup you like' },
              { href: '/accuracy', title: 'Accuracy', desc: 'The public track record, every miss included' },
              { href: '/history', title: 'History', desc: 'Every settled pick, day by day' },
              { href: '/leagues', title: 'Leagues', desc: 'Tables, form, and projections per competition' },
            ].map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex min-h-[48px] flex-col justify-center px-4 py-2 transition-colors hover:bg-[var(--card-hover)]"
                >
                  <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {item.title}
                  </span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">{item.desc}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
