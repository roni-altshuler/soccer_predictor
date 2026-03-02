'use client'

import { useState } from 'react'
import KnockoutSimulator from '@/components/knockout/KnockoutSimulator'

type TournamentType = 'champions_league' | 'europa_league' | 'world_cup'

export default function SimulatorPage() {
  const [selectedTournament, setSelectedTournament] = useState<TournamentType>('champions_league')

  const tournaments: { id: TournamentType; name: string; emoji: string; color: string }[] = [
    { id: 'champions_league', name: 'Champions League', emoji: '🏆', color: 'from-blue-800 to-indigo-600' },
    { id: 'europa_league', name: 'Europa League', emoji: '🏆', color: 'from-orange-500 to-amber-500' },
    { id: 'world_cup', name: 'World Cup', emoji: '🌍', color: 'from-purple-900 to-red-800' },
  ]

  return (
    <div className="min-h-screen py-8 px-4" style={{ backgroundColor: 'var(--background)' }}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
            🎲 Tournament Simulator
          </h1>
          <p className="text-[var(--text-secondary)]">
            Monte Carlo simulation for knockout tournaments
          </p>
        </div>

        {/* Tournament Selection */}
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          {tournaments.map((tournament) => (
            <button
              key={tournament.id}
              onClick={() => setSelectedTournament(tournament.id)}
              className={`px-6 py-3 rounded-xl font-medium transition-all ${
                selectedTournament === tournament.id
                  ? `bg-gradient-to-r ${tournament.color} text-white shadow-lg scale-105`
                  : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border hover:bg-[var(--muted-bg)]'
              }`}
              style={{ borderColor: selectedTournament !== tournament.id ? 'var(--border-color)' : undefined }}
            >
              {tournament.emoji} {tournament.name}
            </button>
          ))}
        </div>

        {/* Simulator */}
        <KnockoutSimulator tournament={selectedTournament} />

        {/* Methodology Note */}
        <div className="mt-8 p-4 bg-[var(--muted-bg)] rounded-xl">
          <h3 className="font-semibold text-[var(--text-primary)] mb-2">📚 Methodology</h3>
          <p className="text-sm text-[var(--text-secondary)] mb-2">
            Our simulations use research-backed approaches:
          </p>
          <ul className="text-sm text-[var(--text-tertiary)] space-y-1 list-disc list-inside">
            <li>Bradley-Terry model for match probability estimation</li>
            <li>ELO ratings adjusted for home advantage and recent form</li>
            <li>Monte Carlo simulation with 10,000+ iterations for statistical stability</li>
            <li>Tournament-specific rules (two-legged ties, away goals, extra time)</li>
          </ul>
          <p className="text-xs text-[var(--text-tertiary)] mt-3">
            References: Csató (2020) &ldquo;Tournament Design&rdquo;, Berrar et al. (2019) &ldquo;ML for Soccer&rdquo;
          </p>
        </div>
      </div>
    </div>
  )
}
