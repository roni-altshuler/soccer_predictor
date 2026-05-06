'use client'

import { useState } from 'react'
import KnockoutSimulator from '@/components/knockout/KnockoutSimulator'

type TournamentType = 'champions_league' | 'europa_league' | 'world_cup' | 'euro' | 'copa_america'

const tournaments: { id: TournamentType; name: string; emoji: string }[] = [
  { id: 'champions_league', name: 'Champions League', emoji: '🏆' },
  { id: 'europa_league', name: 'Europa League', emoji: '🏆' },
  { id: 'world_cup', name: 'World Cup', emoji: '🌍' },
  { id: 'euro', name: 'Euros', emoji: '🏆' },
  { id: 'copa_america', name: 'Copa America', emoji: '🏆' },
]

export default function SimulatorPage() {
  const [selected, setSelected] = useState<TournamentType>('champions_league')

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Sticky tournament tabs */}
      <div className="sticky top-12 md:top-14 z-40 bg-[var(--nav-bg)] border-b border-[var(--border-color)] backdrop-blur-md">
        <div className="max-w-3xl mx-auto flex">
          {tournaments.map((t) => (
            <button key={t.id} onClick={() => setSelected(t.id)}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                selected === t.id
                  ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                  : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}>
              {t.emoji} {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4">
        <KnockoutSimulator tournament={selected} />

        {/* Methodology */}
        <div className="mt-4 bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">Methodology</p>
          <ul className="text-xs text-[var(--text-secondary)] space-y-1 list-disc list-inside">
            <li>Bradley-Terry model for match probability</li>
            <li>ELO ratings adjusted for home advantage &amp; form</li>
            <li>Monte Carlo: 10,000+ iterations</li>
            <li>Tournament-specific rules (two-legged ties, away goals)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
