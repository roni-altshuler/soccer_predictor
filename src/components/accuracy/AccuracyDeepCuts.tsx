'use client'

import { useMemo, useState } from 'react'

import { Card } from '@/components/ui/card'
import type { FlatAccuracyResponse } from '@/lib/types/accuracy'
import { cn } from '@/lib/utils'

import { ConfidenceTiers } from './ConfidenceTiers'
import { OutcomeBreakdown } from './OutcomeBreakdown'
import { RecentPicksFeed, type RecentPick } from './RecentPicksFeed'
import { ScorelineStats } from './ScorelineStats'

/**
 * Everything below the headline, behind one set of tabs.
 *
 * The old page stacked these as four full-width cards of equal visual
 * weight, which is what made the surface feel like a dump rather than a
 * report: ~3,600px of desktop scroll where nothing signalled what mattered.
 * The headline and the reliability chart now carry the page; these are the
 * deep cuts, and they live in one container the reader opts into.
 *
 * The per-competition table was the first of these tabs and is no longer:
 * both evidence pages are organised per competition now, so the breakdown a
 * reader most often wants is a section of the page rather than a tab they
 * have to know to open.
 *
 * A section with no data does not get a tab — an empty tab is worse than an
 * absent one.
 */

type TabKey = 'confidence' | 'scorelines' | 'picks'

interface AccuracyDeepCutsProps {
  metrics: FlatAccuracyResponse | null
  picks: RecentPick[]
  className?: string
}

export function AccuracyDeepCuts({ metrics, picks, className }: AccuracyDeepCutsProps) {
  const bins = metrics?.calibration_bins ?? []

  const tabs = useMemo(() => {
    const available: { key: TabKey; label: string }[] = []
    if (bins.length > 0) available.push({ key: 'confidence', label: 'Confidence' })
    if (metrics && metrics.completed_predictions > 0) {
      available.push({ key: 'scorelines', label: 'Scorelines' })
    }
    if (picks.length > 0) available.push({ key: 'picks', label: 'Recent picks' })
    return available
  }, [bins.length, metrics, picks.length])

  const [active, setActive] = useState<TabKey | null>(null)
  const current = active && tabs.some((t) => t.key === active) ? active : tabs[0]?.key

  if (tabs.length === 0 || !current) return null

  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      <div
        role="tablist"
        aria-label="Accuracy breakdowns"
        className="flex overflow-x-auto border-b border-[var(--border-color)]"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === current
          return (
            <button
              key={tab.key}
              role="tab"
              type="button"
              id={`deepcut-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`deepcut-panel-${tab.key}`}
              onClick={() => setActive(tab.key)}
              className={cn(
                'relative min-h-[44px] shrink-0 whitespace-nowrap px-4 text-[13px] font-semibold transition-colors',
                isActive
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              {tab.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 bottom-0 h-0.5 rounded-t bg-[var(--accent-primary)]"
                />
              )}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`deepcut-panel-${current}`}
        aria-labelledby={`deepcut-tab-${current}`}
      >
        {current === 'confidence' && metrics && (
          <div className="space-y-6 p-4 md:p-5">
            <ConfidenceTiers bins={bins} embedded />
            <div className="border-t border-[var(--border-color)] pt-5">
              <OutcomeBreakdown
                home={{
                  predicted: metrics.home_win_predicted,
                  correct: metrics.home_win_correct,
                }}
                draw={{ predicted: metrics.draw_predicted, correct: metrics.draw_correct }}
                away={{
                  predicted: metrics.away_win_predicted,
                  correct: metrics.away_win_correct,
                }}
                embedded
              />
            </div>
          </div>
        )}

        {current === 'scorelines' && metrics && (
          <div className="p-4 md:p-5">
            <ScorelineStats
              exactRate={metrics.exact_scoreline_rate}
              exactCount={metrics.exact_scoreline_count}
              completed={metrics.completed_predictions}
              top5Rate={metrics.scoreline_top5_rate ?? 0}
              top5Count={metrics.scoreline_top5_count ?? 0}
              top5Eligible={metrics.scoreline_top5_eligible ?? 0}
              avgGoalsError={
                metrics.avg_goals_difference > 0 ? metrics.avg_goals_difference : null
              }
              embedded
            />
          </div>
        )}

        {current === 'picks' && <RecentPicksFeed picks={picks} embedded />}
      </div>
    </Card>
  )
}
