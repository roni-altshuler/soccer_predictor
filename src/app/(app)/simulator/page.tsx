'use client'

import { SectionHeader } from '@/components/primitives'
import LeagueChampionshipSimulator from '@/components/simulator/LeagueChampionshipSimulator'

/**
 * Title & relegation projections.
 *
 * Knockout-bracket mode was removed with the Wave C tournaments
 * (docs/PIVOT_2026-08.md §5) — this page is now one of the three things the
 * product does: project how the season ends for the five Wave A leagues.
 *
 * NOTE: the projections rendered here are not yet calibrated. The matchday-by-
 * matchday backtest in backend/scripts/backtest_season_projections.py exists to
 * establish how many matchdays it takes before these numbers are trustworthy.
 * Until that convergence curve is published, this page must not imply more
 * confidence than has been measured.
 */
export default function SimulatorPage() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto max-w-5xl space-y-5 px-4 pt-5 pb-12">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
            Title &amp; Relegation
          </h1>
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
            How the season ends, played out thousands of times
          </p>
        </div>

        <LeagueChampionshipSimulator />

        <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
          <SectionHeader kicker="Good to know" title="How it works" className="mb-3" />
          <ul className="list-inside list-disc space-y-1 text-xs text-[var(--text-secondary)]">
            <li>Plays out every remaining fixture up to 25,000 times and counts where each team lands</li>
            <li>Team strength comes from points per game in the current table, with home advantage and league-tuned draw rates</li>
            <li>The what-if lab locks a single result and reruns the season so you can see what one match is worth</li>
            <li>The title-race table is pure arithmetic: a team is out only when winning every match still leaves it short</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
