'use client'

import Link from 'next/link'
import { Brain, Database, Gauge } from 'lucide-react'

import { SectionHeader } from '@/components/primitives'
import { Card } from '@/components/ui/card'

/**
 * Plain-language section on the public accuracy page. Three short
 * cards explain WHAT the model is, WHAT data it learned from, and HOW
 * to read the accuracy number above. Designed for end-users, not
 * engineers — for the full audit see /diagnostics.
 */

export function ModelExplainer() {
  const cards = [
    {
      icon: Brain,
      title: 'One AI for every league',
      body:
        "We trained a single neural network on every match in our database. Instead of guessing each league separately, the model shares what it learns from the Premier League across La Liga, Bundesliga, the Champions League, NWSL — every competition we cover. A second model with the same shape powers the women's universe.",
      accent: 'var(--accent-ai)',
    },
    {
      icon: Database,
      title: '80,000+ matches of context',
      body:
        "The model sees a team's ELO rating, last-five form, head-to-head record, days of rest, weather, referee tendencies, and 75+ other contextual features before each prediction. We retrain regularly so recent results carry the right weight.",
      accent: 'var(--accent-primary)',
    },
    {
      icon: Gauge,
      title: 'How to read this page',
      body:
        "Accuracy is the share of matches where we picked the correct winner (home / draw / away). The Brier score and calibration plot measure whether our probabilities are honest — a 70% pick should win roughly 70% of the time. Football is messy, so even 60% is well above sportsbook-level calibration.",
      accent: 'var(--accent-warn)',
    },
  ]

  return (
    <Card className="p-4 md:p-5">
      <div className="mb-3">
        <SectionHeader kicker="Explainer" title="How it works" />
        <p className="mt-1 text-small text-[var(--text-tertiary)]">
          A quick tour of the model behind the number above. For the engineer-level audit (calibration
          drift, league-by-league quality gates, model versioning), see{' '}
          <Link href="/diagnostics" className="font-semibold text-[var(--accent-primary)] hover:underline">
            /diagnostics
          </Link>
          .
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <div
              key={c.title}
              className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)]/60 p-4"
            >
              <div
                className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: `${c.accent}1a`, color: c.accent }}
              >
                <Icon className="h-4 w-4" strokeWidth={2.4} />
              </div>
              <h4 className="text-sm font-bold text-[var(--text-primary)]">{c.title}</h4>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">{c.body}</p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
