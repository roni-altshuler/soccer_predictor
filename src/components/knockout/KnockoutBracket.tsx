'use client'

import { useState } from 'react'

// Types for knockout bracket
export interface KnockoutMatch {
  id: string
  homeTeam: string
  awayTeam: string
  homeScore?: number
  awayScore?: number
  homePenalties?: number
  awayPenalties?: number
  date?: string
  time?: string
  status: 'scheduled' | 'live' | 'finished'
  venue?: string
  round: string
  leg?: 1 | 2
  aggregateHome?: number
  aggregateAway?: number
  winner?: 'home' | 'away' | null
}

export interface BracketRound {
  name: string
  matches: KnockoutMatch[]
}

interface TeamProbability {
  team: string
  probability: number
}

interface SimulationData {
  champion: TeamProbability[]
  final: TeamProbability[]
  semi_finals: TeamProbability[]
  quarter_finals: TeamProbability[]
  round_of_16?: TeamProbability[]
}

interface KnockoutBracketProps {
  tournament: 'champions_league' | 'europa_league' | 'world_cup'
  rounds?: BracketRound[]
  simulationData?: SimulationData
  showProbabilities?: boolean
  onMatchClick?: (match: KnockoutMatch) => void
}

const TOURNAMENT_CONFIG = {
  champions_league: {
    name: 'UEFA Champions League',
    emoji: '🏆',
    gradient: 'from-blue-800 to-indigo-600',
    color: 'blue',
    textColor: 'text-blue-500',
    bgColor: 'bg-blue-500',
    borderColor: 'border-blue-500',
    accentRing: 'ring-blue-500/30',
    rounds: ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    isTwoLegged: [true, true, true, false],
  },
  europa_league: {
    name: 'UEFA Europa League',
    emoji: '🏆',
    gradient: 'from-orange-500 to-amber-500',
    color: 'orange',
    textColor: 'text-orange-500',
    bgColor: 'bg-orange-500',
    borderColor: 'border-orange-500',
    accentRing: 'ring-orange-500/30',
    rounds: ['Round of 32', 'Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    isTwoLegged: [true, true, true, true, false],
  },
  world_cup: {
    name: 'FIFA World Cup',
    emoji: '🌍',
    gradient: 'from-purple-900 to-red-800',
    color: 'purple',
    textColor: 'text-purple-500',
    bgColor: 'bg-purple-500',
    borderColor: 'border-purple-500',
    accentRing: 'ring-purple-500/30',
    rounds: ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Third Place', 'Final'],
    isTwoLegged: [false, false, false, false, false],
  },
}

/** Group matches into two-legged ties */
interface Tie {
  teams: [string, string]
  legs: KnockoutMatch[]
  winner?: 'home' | 'away' | null
}

function groupIntoTies(matches: KnockoutMatch[]): Tie[] {
  const tieMap = new Map<string, KnockoutMatch[]>()

  for (const m of matches) {
    // Create a canonical key from the two teams (alphabetically sorted)
    const teams = [m.homeTeam, m.awayTeam].sort()
    const key = teams.join('|')
    if (!tieMap.has(key)) tieMap.set(key, [])
    tieMap.get(key)!.push(m)
  }

  return Array.from(tieMap.values()).map(legs => {
    // Sort legs by leg number, then by date as secondary sort
    legs.sort((a, b) => {
      const legDiff = (a.leg || 0) - (b.leg || 0)
      if (legDiff !== 0) return legDiff
      return (a.date || '').localeCompare(b.date || '')
    })
    const first = legs[0]
    // Determine tie winner from completed series
    const seriesWinner = legs.find(l => l.winner)?.winner || null
    return {
      teams: [first.homeTeam, first.awayTeam] as [string, string],
      legs,
      winner: seriesWinner,
    }
  })
}

/** Compact match row for a single leg */
function LegRow({
  match,
  config,
  onMatchClick,
}: {
  match: KnockoutMatch
  config: typeof TOURNAMENT_CONFIG.champions_league
  onMatchClick?: (match: KnockoutMatch) => void
}) {
  const isFinished = match.status === 'finished'
  const isLive = match.status === 'live'
  const homeWon = match.winner === 'home'
  const awayWon = match.winner === 'away'

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-[var(--muted-bg)] ${
        isLive ? 'bg-red-500/5 ring-1 ring-red-500/30' : ''
      }`}
      onClick={() => onMatchClick?.(match)}
    >
      {/* Date / Leg label */}
      <div className="w-14 shrink-0 text-center">
        {match.leg ? (
          <span className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase">Leg {match.leg}</span>
        ) : (
          <span className="text-[10px] text-[var(--text-tertiary)]">{match.date || 'TBD'}</span>
        )}
      </div>

      {/* Home team */}
      <div className="flex-1 min-w-0 text-right">
        <span className={`text-sm truncate ${homeWon ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
          {match.homeTeam}
        </span>
      </div>

      {/* Score / Status */}
      <div className="w-16 shrink-0 text-center">
        {isLive ? (
          <div className="flex items-center justify-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-bold text-red-500">
              {match.homeScore ?? 0} - {match.awayScore ?? 0}
            </span>
          </div>
        ) : isFinished ? (
          <span className="text-sm font-bold text-[var(--text-primary)]">
            {match.homeScore} - {match.awayScore}
          </span>
        ) : (
          <span className="text-xs text-[var(--text-tertiary)]">
            {match.time || 'vs'}
          </span>
        )}
      </div>

      {/* Away team */}
      <div className="flex-1 min-w-0">
        <span className={`text-sm truncate ${awayWon ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
          {match.awayTeam}
        </span>
      </div>

      {/* Status badge */}
      <div className="w-10 shrink-0 text-center">
        {isFinished ? (
          <span className="text-[10px] text-[var(--text-tertiary)]">FT</span>
        ) : isLive ? (
          <span className="text-[10px] font-bold text-red-500">LIVE</span>
        ) : null}
      </div>
    </div>
  )
}

/** Compact tie card (groups both legs of a matchup) */
function TieCard({
  tie,
  config,
  onMatchClick,
}: {
  tie: Tie
  config: typeof TOURNAMENT_CONFIG.champions_league
  onMatchClick?: (match: KnockoutMatch) => void
}) {
  return (
    <div
      className="bg-[var(--card-bg)] border rounded-xl overflow-hidden"
      style={{ borderColor: 'var(--border-color)' }}
    >
      {/* Tie header – date range */}
      <div className="px-3 py-1.5 bg-[var(--muted-bg)] flex items-center justify-between">
        <span className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
          {tie.legs.length > 1
            ? (tie.legs[0].date && tie.legs[tie.legs.length - 1].date
                ? `${tie.legs[0].date} – ${tie.legs[tie.legs.length - 1].date}`
                : tie.legs[0].date || tie.legs[tie.legs.length - 1].date || 'TBD')
            : tie.legs[0].date || 'TBD'}
        </span>
        {tie.winner && (
          <span className="text-[10px] text-green-500 font-medium">✓ Decided</span>
        )}
      </div>

      {/* Leg rows */}
      <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
        {tie.legs.map(match => (
          <LegRow
            key={match.id}
            match={match}
            config={config}
            onMatchClick={onMatchClick}
          />
        ))}
      </div>
    </div>
  )
}

// Main bracket visualization — FotMob-style compact layout
export default function KnockoutBracket({
  tournament,
  rounds = [],
  simulationData,
  showProbabilities = false,
  onMatchClick,
}: KnockoutBracketProps) {
  const config = TOURNAMENT_CONFIG[tournament]
  const displayRounds = rounds.length > 0 ? rounds : []
  const [activeRound, setActiveRound] = useState(0)

  // If no rounds provided, show placeholder
  if (displayRounds.length === 0) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-2xl p-8 text-center" style={{ borderColor: 'var(--border-color)' }}>
        <span className="text-5xl mb-4 block">🏆</span>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{config.name} Knockout Stage</h3>
        <p className="text-sm text-[var(--text-tertiary)]">Knockout bracket will appear once teams are confirmed</p>
      </div>
    )
  }

  const currentRound = displayRounds[activeRound]
  const ties = currentRound ? groupIntoTies(currentRound.matches) : []

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      {/* Header */}
      <div className={`bg-gradient-to-r ${config.gradient} px-5 py-3`}>
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>{config.emoji}</span>
          <span>Knockout Stage</span>
        </h2>
      </div>

      {/* Round navigation tabs — horizontally scrollable pills */}
      <div className="border-b px-4 py-2 overflow-x-auto" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex gap-2 min-w-max">
          {displayRounds.map((round, idx) => {
            const isActive = idx === activeRound
            const matchCount = round.matches.length
            const finishedCount = round.matches.filter(m => m.status === 'finished').length

            return (
              <button
                key={round.name}
                onClick={() => setActiveRound(idx)}
                className={`
                  px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all
                  ${isActive
                    ? `bg-gradient-to-r ${config.gradient} text-white shadow-sm`
                    : 'text-[var(--text-secondary)] hover:bg-[var(--muted-bg)]'
                  }
                `}
              >
                {round.name}
                {matchCount > 0 && (
                  <span className={`ml-1.5 ${isActive ? 'text-white/70' : 'text-[var(--text-tertiary)]'}`}>
                    {finishedCount}/{matchCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Active round matches */}
      <div className="p-4">
        {ties.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {ties.map((tie, idx) => (
              <TieCard
                key={idx}
                tie={tie}
                config={config}
                onMatchClick={onMatchClick}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--text-tertiary)]">No matches scheduled yet for this round</p>
          </div>
        )}
      </div>

      {/* Champion display if simulation data exists */}
      {simulationData?.champion && simulationData.champion.length > 0 && (
        <div className="border-t px-5 py-3 flex items-center justify-center gap-3" style={{ borderColor: 'var(--border-color)' }}>
          <span className="text-xl">🏆</span>
          <div className="text-center">
            <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Predicted Champion</p>
            <p className="text-sm font-bold text-[var(--text-primary)]">{simulationData.champion[0].team}</p>
            <p className={`text-xs ${config.textColor}`}>{(simulationData.champion[0].probability * 100).toFixed(1)}%</p>
          </div>
        </div>
      )}
    </div>
  )
}

// Export types
export type { SimulationData, TeamProbability }
