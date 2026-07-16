import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import TeamComparison from '@/components/worldcup/TeamComparison'
import { H2HMatrix, type H2HEntity } from '@/components/viz'
import { flagUrlForCountry } from '@/lib/flags'
import { getBracketPaths } from '@/lib/server/worldCup'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Compare teams — World Cup 2026 · Pitchverse',
  description:
    'Head-to-head comparison of any two 2026 World Cup nations: team ratings, neutral-pitch win expectancy, and tournament advancement probabilities from thousands of simulated tournament runs.',
}

/** Elo expected score on a neutral pitch — same quantity TeamComparison shows. */
function eloExpected(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400))
}

export default async function WorldCupComparePage() {
  const bracket = await getBracketPaths()
  const teams = bracket?.teams ?? []

  // Pairwise "if they met" grid for the strongest contenders. Pure Elo math
  // over the committed ratings — no fabricated matchup data.
  const contenders = [...teams]
    .filter((t) => typeof t.elo === 'number')
    .sort((a, b) => b.p_champion - a.p_champion)
    .slice(0, 8)
  const matrixEntities: H2HEntity[] = contenders.map((t) => ({
    id: t.team_id != null ? String(t.team_id) : t.name,
    label: t.name,
    // National sides get flagcdn flags (design rule 6); initials fall back.
    crestUrl: flagUrlForCountry(t.name),
  }))
  const matrix = contenders.map((rowTeam, i) =>
    contenders.map((colTeam, j) =>
      i === j ? null : eloExpected(rowTeam.elo as number, colTeam.elo as number)
    )
  )

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
        Pick two teams to see their ratings, a neutral-pitch win expectancy, and how
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

      {contenders.length >= 3 && (
        <div className="mt-8 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 sm:p-5">
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
            The contenders, head to head
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
            Chance the row team beats the column team on a neutral pitch, from team ratings.
            Green favours the row side, red the column side.
          </p>
          <div className="mt-3 flex justify-center">
            <H2HMatrix entities={matrixEntities} matrix={matrix} />
          </div>
        </div>
      )}

      {bracket ? (
        <p className="mt-6 text-center text-[10px] text-[var(--text-tertiary)]">
          {bracket.n_simulations.toLocaleString()} simulations · ratings from
          historical international results. Educational use only.
        </p>
      ) : null}
    </div>
  )
}
