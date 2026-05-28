'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Swords } from 'lucide-react'

import KnockoutSimulator from '@/components/knockout/KnockoutSimulator'
import LeagueChampionshipSimulator from '@/components/simulator/LeagueChampionshipSimulator'

type TournamentType = 'champions_league' | 'europa_league' | 'world_cup' | 'euro' | 'copa_america'
type SimulatorMode = 'tournament' | 'league'

const tournaments: { id: TournamentType; name: string; emoji: string }[] = [
  { id: 'champions_league', name: 'Champions League', emoji: '🏆' },
  { id: 'europa_league', name: 'Europa League', emoji: '🏆' },
  { id: 'world_cup', name: 'World Cup', emoji: '🌍' },
  { id: 'euro', name: 'Euros', emoji: '🏆' },
  { id: 'copa_america', name: 'Copa America', emoji: '🏆' },
]

export default function SimulatorPage() {
  const [mode, setMode] = useState<SimulatorMode>('tournament')
  const [selected, setSelected] = useState<TournamentType>('champions_league')

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Mode toggle — Tournament (knockout brackets) vs League (championship race) */}
      <div className="sticky top-0 z-50 bg-[var(--background)]/95 border-b border-[var(--border-color)] backdrop-blur-md">
        <div
          role="tablist"
          aria-label="Simulator mode"
          className="max-w-3xl mx-auto flex gap-1 px-4 py-3"
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
                className={`relative flex-1 sm:flex-initial sm:min-w-[180px] rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                  active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="simulator-mode-pill"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
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

        {/* Tournament sub-tabs only render in tournament mode */}
        {mode === 'tournament' && (
          <div className="max-w-3xl mx-auto flex">
            {tournaments.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelected(t.id)}
                className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                  selected === t.id
                    ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                    : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {t.emoji} {t.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        {mode === 'tournament' && (
          <div role="tabpanel" id="simulator-tournament">
            <KnockoutSimulator tournament={selected} />
          </div>
        )}

        {mode === 'league' && (
          <div role="tabpanel" id="simulator-league">
            <LeagueChampionshipSimulator />
          </div>
        )}

        {/* Methodology — context-specific */}
        <div className="mt-4 bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">Methodology</p>
          {mode === 'tournament' ? (
            <ul className="text-xs text-[var(--text-secondary)] space-y-1 list-disc list-inside">
              <li>Bradley-Terry model for match probability</li>
              <li>ELO ratings adjusted for home advantage &amp; form</li>
              <li>Monte Carlo: 10,000+ iterations</li>
              <li>Tournament-specific rules (two-legged ties, away goals)</li>
            </ul>
          ) : (
            <ul className="text-xs text-[var(--text-secondary)] space-y-1 list-disc list-inside">
              <li>Bradley-Terry match probability with home advantage (~1.35×)</li>
              <li>Team strength derived from current points-per-game (no ML retrain)</li>
              <li>League-specific draw rate calibration</li>
              <li>Monte Carlo over all remaining fixtures (ESPN scoreboard) — 1k–25k runs</li>
              <li>What-if mode: lock one fixture outcome and re-simulate the rest</li>
              <li>Title race table: pure mathematics (max possible vs leader&apos;s current)</li>
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
