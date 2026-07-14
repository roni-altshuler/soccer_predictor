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
  const [mode, setMode] = useState<SimulatorMode>('league')
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
            Title races and knockout brackets, played out thousands of times.
          </p>
        </div>

        {/* Mode toggle — underline tabs (Tournament brackets vs League race) */}
        <div
          role="tablist"
          aria-label="Simulator mode"
          className="flex items-center gap-6 border-b border-[var(--border-color)]"
        >
          {([
            { value: 'league' as const, label: 'League', Icon: Trophy },
            { value: 'tournament' as const, label: 'Tournament', Icon: Swords },
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

        {mode === 'league' && (
          <div role="tabpanel" id="simulator-league">
            <LeagueChampionshipSimulator />
          </div>
        )}

        {mode === 'tournament' && (
          <div role="tabpanel" id="simulator-tournament">
            <KnockoutSimulatorPanel tournament={selected} />
          </div>
        )}

        {/* How it works — context-specific */}
        <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
          <SectionHeader kicker="Good to know" title="How it works" className="mb-3" />
          {mode === 'tournament' ? (
            <ul className="list-inside list-disc space-y-1 text-xs text-[var(--text-secondary)]">
              <li>Each bracket is played out up to 50,000 times, match by match</li>
              <li>Team ratings set the chance of winning every tie</li>
              <li>Club rounds are two-legged with a one-off neutral final; national tournaments are single matches throughout</li>
              <li>Removing a team from the field reruns the bracket without them</li>
            </ul>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-xs text-[var(--text-secondary)]">
              <li>Plays out every remaining fixture up to 25,000 times and counts where each team lands</li>
              <li>Team strength comes from points per game in the current table, with home advantage and league-tuned draw rates</li>
              <li>The what-if lab locks a single result and reruns the season so you can see what one match is worth</li>
              <li>The title-race table is pure arithmetic: a team is out only when winning every match still leaves it short</li>
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
