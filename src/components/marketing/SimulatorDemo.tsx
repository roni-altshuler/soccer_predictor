'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'

import { SimulationDistributionChart } from '@/components/charts/SimulationDistributionChart'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { cn } from '@/lib/utils'
import { SIM_SCENARIOS, SIM_TITLE_ODDS } from './demoData'
import { CtaButton } from './primitives/CtaButton'

type Scenario = keyof typeof SIM_SCENARIOS

const TABS: { key: Scenario; label: string }[] = [
  { key: 'balanced', label: 'As-is' },
  { key: 'home', label: 'Home win' },
  { key: 'away', label: 'Away win' },
]

/**
 * Lightweight, fully client-side teaser of the Monte Carlo simulator. Toggling
 * a "what-if" result re-shapes the projected scoreline distribution and title
 * odds instantly — a taste of the real /simulator, with no backend dependency.
 */
export function SimulatorDemo() {
  const [scenario, setScenario] = useState<Scenario>('balanced')
  const odds = SIM_TITLE_ODDS[scenario]

  return (
    <div className="relative overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5 shadow-[var(--shadow-md)] md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mkt-eyebrow">What-if simulator</p>
          <h3 className="mt-1 text-lg font-bold text-[var(--text-primary)]">
            Change one result. Watch the season move.
          </h3>
        </div>
        <div
          role="tablist"
          aria-label="What-if scenario"
          className="flex gap-1.5 rounded-xl bg-[var(--muted-bg)] p-1"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={scenario === t.key}
              onClick={() => setScenario(t.key)}
              className={cn(
                'min-h-[40px] rounded-lg px-3 text-xs font-semibold transition-colors',
                scenario === t.key
                  ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <p className="mb-2 text-xs font-semibold text-[var(--text-tertiary)]">
            Projected scoreline distribution (1,000 simulations)
          </p>
          <SimulationDistributionChart buckets={SIM_SCENARIOS[scenario]} highlightTop={3} height={240} />
        </div>

        <div className="flex flex-col justify-center gap-4">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)]/50 p-4">
            <p className="text-xs font-semibold text-[var(--text-tertiary)]">Title probability — home side</p>
            <p className="mt-1 font-numeric text-3xl font-extrabold tabular-nums text-[var(--accent-primary)]">
              <NumberTicker key={`h-${scenario}`} value={odds.home} suffix="%" />
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)]/50 p-4">
            <p className="text-xs font-semibold text-[var(--text-tertiary)]">Title probability — away side</p>
            <p className="mt-1 font-numeric text-3xl font-extrabold tabular-nums text-[var(--accent-ai)]">
              <NumberTicker key={`a-${scenario}`} value={odds.away} suffix="%" />
            </p>
          </div>
          <CtaButton href="/simulator" variant="secondary" size="md" className="w-full">
            Open the full simulator
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </CtaButton>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-[var(--text-tertiary)]">
        Illustrative sample. The live simulator runs seeded Monte Carlo over real standings and fixtures.
      </p>
    </div>
  )
}
