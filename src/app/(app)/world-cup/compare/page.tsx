import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import TeamComparison from '@/components/worldcup/TeamComparison'
import { getBracketPaths } from '@/lib/server/worldCup'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Compare teams — World Cup 2026 · Pitchwise',
  description:
    'Head-to-head comparison of any two 2026 World Cup nations: Elo ratings, neutral-pitch win expectancy, and tournament advancement probabilities from calibrated Monte Carlo simulations.',
}

export default async function WorldCupComparePage() {
  const bracket = await getBracketPaths()
  const teams = bracket?.teams ?? []

  return (
    <div className="mx-auto max-w-3xl px-4 pb-14 pt-6">
      <Link
        href="/world-cup"
        className="inline-flex items-center gap-1.5 text-caption font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-primary)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> World Cup hub
      </Link>

      <h1 className="mt-3 font-display text-[clamp(1.6rem,4vw,2.4rem)] font-extrabold tracking-tight text-[var(--text-primary)]">
        Compare any two nations
      </h1>
      <p className="mt-2 max-w-2xl text-body text-[var(--text-secondary)]">
        Pick two teams to see their Elo ratings, a neutral-pitch win expectancy, and how
        far each is projected to go — straight from the tournament simulation.
      </p>

      <div className="mt-6">
        {teams.length > 1 ? (
          <TeamComparison teams={teams} />
        ) : (
          <p className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-5 text-small text-[var(--text-secondary)]">
            Team comparison is temporarily unavailable — the simulation snapshot has not been
            generated yet.
          </p>
        )}
      </div>

      {bracket ? (
        <p className="mt-6 text-center text-[10px] text-[var(--text-tertiary)]">
          {bracket.n_simulations.toLocaleString()} simulations
          {bracket.source === 'snapshot' ? ' · committed snapshot' : ' · live'} · ratings from
          historical international results. Educational use only.
        </p>
      ) : null}
    </div>
  )
}
