'use client'

import { useState } from 'react'
import { Trophy, Swords } from 'lucide-react'

import { SectionHeader } from '@/components/primitives'
import KnockoutSimulatorPanel, {
  type KnockoutTournament,
} from '@/components/simulator/KnockoutSimulatorPanel'
import { TournamentCrest } from '@/components/tournament'
import LeagueChampionshipSimulator from '@/components/simulator/LeagueChampionshipSimulator'
import { cn } from '@/lib/utils'

type SimulatorMode = 'tournament' | 'league'

/** Knockout tournaments with their leagueAccents competition ids. */
const TOURNAMENTS: { id: KnockoutTournament; name: string; leagueId: string }[] = [
  { id: 'champions_league', name: 'Champions League', leagueId: 'uefa.champions' },
  { id: 'europa_league', name: 'Europa League', leagueId: 'uefa.europa' },
  { id: 'world_cup', name: 'World Cup', leagueId: 'fifa.world' },
  { id: 'euro', name: 'Euros', leagueId: 'uefa.euro' },
  { id: 'copa_america', name: 'Copa América', leagueId: 'conmebol.america' },
]

export default function SimulatorPage() {
  const [mode, setMode] = useState<SimulatorMode>('tournament')
  const [selected, setSelected] = useState<KnockoutTournament>('champions_league')

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto max-w-5xl space-y-5 px-4 pt-5 pb-12">
        {/* Compact page title — no marketing hero */}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
            Simulator
          </h1>
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
            Simulated knockout brackets and title-race maths — run thousands of seasons.
          </p>
        </div>

        {/* Mode toggle — underline tabs (Tournament brackets vs League race) */}
        <div
          role="tablist"
          aria-label="Simulator mode"
          className="flex items-center gap-6 border-b border-[var(--border-color)]"
        >
          {([
            { value: 'tournament' as const, label: 'Tournament', Icon: Swords },
            { value: 'league' as const, label: 'League', Icon: Trophy },
          ]).map((option) => {
            const active = mode === option.value
            const Icon = option.Icon
            return (
              <button
                key={option.value}
                role="tab"
                aria-selected={active}
                aria-controls={`simulator-${option.value}`}
                onClick={() => setMode(option.value)}
                className={cn(
                  'relative -mb-px inline-flex min-h-[44px] items-center gap-2 border-b-2 px-1 pt-1 text-sm font-semibold transition-colors',
                  active
                    ? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {option.label}
              </button>
            )
          })}
        </div>

        {/* Tournament picker — crest chips, ≥40px targets, no emoji */}
        {mode === 'tournament' && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tournament">
            {TOURNAMENTS.map((t) => {
              const active = selected === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelected(t.id)}
                  className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border bg-[var(--card-bg)] px-3.5 text-sm font-semibold text-[var(--text-primary)] transition-colors ${
                    active
                      ? 'border-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]'
                      : 'border-[var(--border-color)] hover:border-[var(--border-hover)]'
                  }`}
                  style={
                    active
                      ? {
                          backgroundColor:
                            'color-mix(in srgb, var(--accent-primary) 10%, var(--card-bg))',
                        }
                      : undefined
                  }
                >
                  <TournamentCrest tournamentId={t.leagueId} name={t.name} size={18} />
                  <span>{t.name}</span>
                </button>
              )
            })}
          </div>
        )}

        {mode === 'tournament' && (
          <div role="tabpanel" id="simulator-tournament">
            <KnockoutSimulatorPanel tournament={selected} />
          </div>
        )}

        {mode === 'league' && (
          <div role="tabpanel" id="simulator-league">
            <LeagueChampionshipSimulator />
          </div>
        )}

        {/* How it works — context-specific */}
        <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
          <SectionHeader kicker="Good to know" title="How it works" className="mb-3" />
          {mode === 'tournament' ? (
            <ul className="list-inside list-disc space-y-1 text-xs text-[var(--text-secondary)]">
              <li>Each bracket is played out thousands of times, match by match</li>
              <li>Team strength reflects long-run ratings, home advantage, and form</li>
              <li>Tournament-specific rules (two-legged ties, away goals) are respected</li>
            </ul>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-xs text-[var(--text-secondary)]">
              <li>Every remaining fixture is simulated thousands of times — 1k–25k runs</li>
              <li>Team strength is derived from current standings and points-per-game</li>
              <li>Draw rates are tuned per league</li>
              <li>What-if mode: lock one fixture outcome and re-simulate the rest</li>
              <li>Title race table: pure mathematics (max possible vs leader&apos;s current)</li>
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
