'use client'

import { Brain, Gauge, Target } from 'lucide-react'

import { SectionHeader } from '@/components/primitives'
import { Card } from '@/components/ui/card'

/**
 * Plain-language section at the bottom of /accuracy. Three short cards
 * explain how to read the results above in everyday terms — outcomes
 * only, no methodology or provenance (design-language copy policy).
 */

export function ModelExplainer() {
  const cards = [
    {
      icon: Brain,
      title: 'Every pick is on the record',
      body:
        'Picks are locked in before kick-off and never edited. When the final whistle goes, each one is scored as a hit or a miss and added to the totals on this page.',
      accent: 'var(--accent-ai)',
    },
    {
      icon: Gauge,
      title: 'What the headline number means',
      body:
        'It is the share of matches where the predicted result (home win, draw, or away win) came true. Football is messy — anything around 60% is a strong long-run hit rate.',
      accent: 'var(--accent-primary)',
    },
    {
      icon: Target,
      title: 'Probabilities, not certainties',
      body:
        'A 70% pick should come true roughly 70% of the time. The calibration chart above checks exactly that — when the dots hug the diagonal, the percentages mean what they say.',
      accent: 'var(--accent-warn)',
    },
  ]

  return (
    <Card className="p-4 md:p-5">
      <SectionHeader kicker="Explainer" title="How to read this page" className="mb-3" />
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
