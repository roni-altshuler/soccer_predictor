'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Trophy, Swords, FlaskConical } from 'lucide-react'

import { SectionHeader } from '@/components/primitives'
import KnockoutSimulatorPanel, {
  type KnockoutTournament,
} from '@/components/simulator/KnockoutSimulatorPanel'
import { TournamentCrest } from '@/components/tournament'
import LeagueChampionshipSimulator from '@/components/simulator/LeagueChampionshipSimulator'
import { springSnappy } from '@/lib/motion'

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
  const reduceMotion = useReducedMotion()

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto max-w-5xl space-y-6 px-4 pt-6 pb-12">
        {/* Hero band */}
        <section className="hero-band surface-elevated flex flex-wrap items-end justify-between gap-4 p-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              Prediction lab
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text-primary)]">
              Simulator
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
              Monte Carlo knockout brackets and title-race maths — run thousands of seasons and
              see who lifts the trophy.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-ai)]">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
            Bradley-Terry · Monte Carlo
          </span>
        </section>

        {/* Mode toggle — Tournament (knockout brackets) vs League (championship race) */}
        <div
          role="tablist"
          aria-label="Simulator mode"
          className="flex gap-1 rounded-2xl border border-[var(--border-color)] bg-[var(--muted-bg)]/60 p-1"
        >
          {([
            { value: 'tournament' as const, label: 'Tournament', Icon: Swords, hint: 'Knockout brackets' },
            { value: 'league' as const, label: 'League', Icon: Trophy, hint: 'Championship race' },
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
                className={`relative min-h-[48px] flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition-colors sm:flex-initial sm:min-w-[190px] ${
                  active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="simulator-mode-pill"
                    transition={reduceMotion ? { duration: 0 } : springSnappy}
                    className="absolute inset-0 -z-[1] rounded-xl bg-[var(--card-bg)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--accent-primary)]/30"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-[1] inline-flex items-center gap-2">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="flex flex-col items-start leading-tight">
                    <span>{option.label}</span>
                    <span className="text-[10px] font-normal text-[var(--text-tertiary)]">
                      {option.hint}
                    </span>
                  </span>
                </span>
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

        {/* Methodology — context-specific */}
        <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
          <SectionHeader kicker="Under the hood" title="Methodology" className="mb-3" />
          {mode === 'tournament' ? (
            <ul className="list-inside list-disc space-y-1 text-xs text-[var(--text-secondary)]">
              <li>Bradley-Terry model for match probability</li>
              <li>ELO ratings adjusted for home advantage &amp; form</li>
              <li>Monte Carlo: 10,000+ iterations</li>
              <li>Tournament-specific rules (two-legged ties, away goals)</li>
            </ul>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-xs text-[var(--text-secondary)]">
              <li>Bradley-Terry match probability with home advantage (~1.35×)</li>
              <li>Team strength derived from current points-per-game (no ML retrain)</li>
              <li>League-specific draw rate calibration</li>
              <li>Monte Carlo over all remaining fixtures (ESPN scoreboard) — 1k–25k runs</li>
              <li>What-if mode: lock one fixture outcome and re-simulate the rest</li>
              <li>Title race table: pure mathematics (max possible vs leader&apos;s current)</li>
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
