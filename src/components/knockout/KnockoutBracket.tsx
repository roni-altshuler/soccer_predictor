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
  tournament: 'champions_league' | 'europa_league' | 'world_cup' | 'conference_league'
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
    rounds: ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Third Place', 'Final'],
    isTwoLegged: [false, false, false, false, false],
  },
  conference_league: {
    name: 'UEFA Conference League',
    emoji: '🏆',
    gradient: 'from-green-600 to-emerald-500',
    color: 'green',
    textColor: 'text-green-500',
    bgColor: 'bg-green-500',
    borderColor: 'border-green-500',
    rounds: ['Round of 32', 'Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    isTwoLegged: [true, true, true, true, false],
  },
}

/* ------------------------------------------------------------------ */
/*  Group matches into two-legged ties                                 */
/* ------------------------------------------------------------------ */
interface Tie {
  teams: [string, string]
  legs: KnockoutMatch[]
  winner?: 'home' | 'away' | null
}

function groupIntoTies(matches: KnockoutMatch[]): Tie[] {
  const tieMap = new Map<string, KnockoutMatch[]>()
  for (const m of matches) {
    const teams = [m.homeTeam, m.awayTeam].sort()
    const key = teams.join('|')
    if (!tieMap.has(key)) tieMap.set(key, [])
    tieMap.get(key)!.push(m)
  }
  return Array.from(tieMap.values()).map(legs => {
    legs.sort((a, b) => {
      const legDiff = (a.leg || 0) - (b.leg || 0)
      if (legDiff !== 0) return legDiff
      return (a.date || '').localeCompare(b.date || '')
    })
    const first = legs[0]
    const seriesWinner = legs.find(l => l.winner)?.winner || null
    return {
      teams: [first.homeTeam, first.awayTeam] as [string, string],
      legs,
      winner: seriesWinner,
    }
  })
}

/* ------------------------------------------------------------------ */
/*  Team row inside a bracket match card                               */
/* ------------------------------------------------------------------ */
function TeamRow({
  name,
  score,
  penalties,
  isWinner,
  isLive,
  position,
}: {
  name: string
  score?: number
  penalties?: number
  isWinner: boolean
  isLive: boolean
  position: 'top' | 'bottom'
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 ${
        position === 'top' ? 'border-b' : ''
      } ${isWinner ? 'bg-green-500/8' : ''}`}
      style={{ borderColor: 'var(--border-color)' }}
    >
      <span
        className={`text-xs truncate flex-1 ${
          isWinner
            ? 'font-semibold text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)]'
        }`}
      >
        {name || 'TBD'}
      </span>
      <span
        className={`text-xs tabular-nums min-w-[18px] text-right ${
          isLive
            ? 'font-bold text-red-500'
            : isWinner
              ? 'font-bold text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)]'
        }`}
      >
        {score !== undefined ? score : '-'}
        {penalties !== undefined && (
          <span className="text-[10px] text-[var(--text-tertiary)]"> ({penalties})</span>
        )}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Single match card used in bracket columns                          */
/* ------------------------------------------------------------------ */
function BracketCard({
  match,
  onMatchClick,
}: {
  match: KnockoutMatch
  onMatchClick?: (m: KnockoutMatch) => void
}) {
  const isLive = match.status === 'live'
  const isFinished = match.status === 'finished'
  return (
    <div
      onClick={() => onMatchClick?.(match)}
      className={`w-[160px] rounded-lg border overflow-hidden cursor-pointer transition-all
        hover:shadow-md hover:border-[var(--accent-primary)]
        ${isLive ? 'ring-1 ring-red-500/40 border-red-500/60' : ''}`}
      style={{ borderColor: isLive ? undefined : 'var(--border-color)', background: 'var(--card-bg)' }}
    >
      <TeamRow
        name={match.homeTeam}
        score={match.homeScore}
        penalties={match.homePenalties}
        isWinner={match.winner === 'home'}
        isLive={isLive}
        position="top"
      />
      <TeamRow
        name={match.awayTeam}
        score={match.awayScore}
        penalties={match.awayPenalties}
        isWinner={match.winner === 'away'}
        isLive={isLive}
        position="bottom"
      />
      {/* Status / date footer */}
      <div
        className={`text-center text-[10px] py-0.5 ${
          isLive
            ? 'bg-red-500/15 text-red-500 font-semibold'
            : 'bg-[var(--muted-bg)] text-[var(--text-tertiary)]'
        }`}
      >
        {isLive ? (
          <span className="flex items-center justify-center gap-1">
            <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse" />
            LIVE
          </span>
        ) : isFinished ? (
          'FT'
        ) : (
          match.date || 'TBD'
        )}
        {match.leg && <span className="ml-1">• Leg {match.leg}</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Tie card used in the detail list view (shows both legs together)   */
/* ------------------------------------------------------------------ */
function TieDetailCard({
  tie,
  onMatchClick,
}: {
  tie: Tie
  onMatchClick?: (m: KnockoutMatch) => void
}) {
  return (
    <div
      className="border rounded-lg overflow-hidden"
      style={{ borderColor: 'var(--border-color)', background: 'var(--card-bg)' }}
    >
      {tie.legs.map((match, i) => {
        const isLive = match.status === 'live'
        const isFinished = match.status === 'finished'
        return (
          <div
            key={match.id}
            onClick={() => onMatchClick?.(match)}
            className={`flex items-center cursor-pointer hover:bg-[var(--muted-bg)] transition-colors ${
              i > 0 ? 'border-t' : ''
            }`}
            style={{ borderColor: 'var(--border-color)' }}
          >
            {/* Leg label */}
            <div className="w-12 shrink-0 text-center py-2">
              <span className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase">
                {match.leg ? `L${match.leg}` : match.date || '—'}
              </span>
            </div>
            {/* Home */}
            <div className="flex-1 text-right pr-2 py-2 min-w-0">
              <span className={`text-xs truncate ${match.winner === 'home' ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                {match.homeTeam}
              </span>
            </div>
            {/* Score */}
            <div className="w-14 text-center shrink-0 py-2">
              {isLive ? (
                <span className="text-xs font-bold text-red-500">
                  {match.homeScore ?? 0}-{match.awayScore ?? 0}
                </span>
              ) : isFinished ? (
                <span className="text-xs font-bold text-[var(--text-primary)]">
                  {match.homeScore}-{match.awayScore}
                </span>
              ) : (
                <span className="text-[10px] text-[var(--text-tertiary)]">{match.time || 'vs'}</span>
              )}
            </div>
            {/* Away */}
            <div className="flex-1 pl-2 py-2 min-w-0">
              <span className={`text-xs truncate ${match.winner === 'away' ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                {match.awayTeam}
              </span>
            </div>
            {/* Status */}
            <div className="w-8 shrink-0 text-center py-2">
              {isFinished && <span className="text-[9px] text-[var(--text-tertiary)]">FT</span>}
              {isLive && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ================================================================== */
/*  MAIN COMPONENT                                                     */
/* ================================================================== */
export default function KnockoutBracket({
  tournament,
  rounds = [],
  simulationData,
  showProbabilities = false,
  onMatchClick,
}: KnockoutBracketProps) {
  const config = TOURNAMENT_CONFIG[tournament]
  const displayRounds = rounds.length > 0 ? rounds : []
  const [view, setView] = useState<'bracket' | 'list'>('bracket')

  // Empty state
  if (displayRounds.length === 0) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-2xl p-8 text-center" style={{ borderColor: 'var(--border-color)' }}>
        <span className="text-5xl mb-4 block">🏆</span>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{config.name} Knockout Stage</h3>
        <p className="text-sm text-[var(--text-tertiary)]">Knockout bracket will appear once teams are confirmed</p>
      </div>
    )
  }

  /* ---------------------------------------------------------------- */
  /*  BRACKET TREE VIEW — horizontal flow left → right                 */
  /* ---------------------------------------------------------------- */
  const renderBracketView = () => {
    // For the bracket tree, we group ties per round
    const roundTies = displayRounds.map(r => ({
      name: r.name,
      ties: groupIntoTies(r.matches),
      matchCount: r.matches.length,
    }))

    // Layout constants for bracket positioning (must match BracketCard CSS dimensions)
    const CARD_H = 62  // height of a BracketCard: two 24px team rows + 14px footer
    const COL_W = 184   // column width: 160px card + 24px connector
    const CONNECTOR_W = 24

    /** Expected number of matches in a bracket round (halves each round from first) */
    const expectedMatchCount = (roundIndex: number) =>
      Math.max(1, Math.pow(2, displayRounds.length - 1 - roundIndex))

    return (
      <div className="overflow-x-auto pb-2">
        <div className="flex items-start min-w-max px-4 py-4">
          {roundTies.map((round, rIdx) => {
            // Calculate vertical spacing: doubles each round
            const gapMultiplier = Math.pow(2, rIdx)
            const topPad = (gapMultiplier - 1) * (CARD_H / 2 + 8)
            const gap = gapMultiplier * (CARD_H + 16) - CARD_H

            const isLast = rIdx === roundTies.length - 1

            return (
              <div key={round.name} className="flex items-start">
                {/* Round column */}
                <div className="flex flex-col items-center" style={{ width: COL_W - CONNECTOR_W }}>
                  {/* Round header label */}
                  <div className="mb-3 text-center">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                      {round.name}
                    </span>
                  </div>

                  {/* Match cards */}
                  <div
                    className="flex flex-col"
                    style={{ paddingTop: topPad, gap }}
                  >
                    {round.ties.length > 0
                      ? round.ties.map((tie, tIdx) => {
                          // For two-legged ties, show the first leg card (or most meaningful one)
                          const displayMatch = tie.legs.find(l => l.status === 'finished')
                            || tie.legs.find(l => l.status === 'live')
                            || tie.legs[0]
                          return (
                            <BracketCard
                              key={tIdx}
                              match={displayMatch}
                              onMatchClick={onMatchClick}
                            />
                          )
                        })
                      : Array.from({ length: expectedMatchCount(rIdx) }).map((_, i) => (
                          <div
                            key={i}
                            className="w-[160px] h-[62px] rounded-lg border-2 border-dashed flex items-center justify-center"
                            style={{ borderColor: 'var(--border-color)' }}
                          >
                            <span className="text-[10px] text-[var(--text-tertiary)]">TBD</span>
                          </div>
                        ))
                    }
                  </div>
                </div>

                {/* Connector lines between rounds */}
                {!isLast && (
                  <div
                    className="flex flex-col items-center justify-start shrink-0"
                    style={{
                      width: CONNECTOR_W,
                      paddingTop: topPad + CARD_H / 2,
                    }}
                  >
                    {Array.from({ length: Math.max(1, Math.ceil((round.ties.length || expectedMatchCount(rIdx)) / 2)) }).map((_, cIdx) => {
                      const pairGap = gap + CARD_H
                      return (
                        <div key={cIdx} style={{ height: pairGap, marginBottom: gap > 0 ? gap : 16 }}>
                          <svg width={CONNECTOR_W} height={pairGap} className="text-[var(--border-color)]">
                            {/* Top horizontal */}
                            <line x1={0} y1={0} x2={CONNECTOR_W / 2} y2={0} stroke="currentColor" strokeWidth="1.5" />
                            {/* Bottom horizontal */}
                            <line x1={0} y1={pairGap} x2={CONNECTOR_W / 2} y2={pairGap} stroke="currentColor" strokeWidth="1.5" />
                            {/* Vertical */}
                            <line x1={CONNECTOR_W / 2} y1={0} x2={CONNECTOR_W / 2} y2={pairGap} stroke="currentColor" strokeWidth="1.5" />
                            {/* Out horizontal */}
                            <line x1={CONNECTOR_W / 2} y1={pairGap / 2} x2={CONNECTOR_W} y2={pairGap / 2} stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* Trophy */}
          <div className="flex flex-col items-center justify-center ml-2 pt-8">
            <div className={`p-3 rounded-full bg-gradient-to-br ${config.gradient} shadow-lg`}>
              <span className="text-3xl">🏆</span>
            </div>
            <span className="text-[10px] font-semibold text-[var(--text-tertiary)] mt-1 uppercase tracking-wider">
              Champion
            </span>
          </div>
        </div>
      </div>
    )
  }

  /* ---------------------------------------------------------------- */
  /*  LIST VIEW — grouped by round with expandable tie detail          */
  /* ---------------------------------------------------------------- */
  const renderListView = () => (
    <div className="p-4 space-y-5">
      {displayRounds.map(round => {
        const ties = groupIntoTies(round.matches)
        const finishedCount = round.matches.filter(m => m.status === 'finished').length
        return (
          <div key={round.name}>
            {/* Round label */}
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                {round.name}
              </h3>
              <span className="text-[10px] text-[var(--text-tertiary)] bg-[var(--muted-bg)] px-1.5 py-0.5 rounded-full">
                {finishedCount}/{round.matches.length}
              </span>
            </div>
            {/* Tie cards */}
            <div className="grid gap-2 sm:grid-cols-2">
              {ties.map((tie, i) => (
                <TieDetailCard key={i} tie={tie} onMatchClick={onMatchClick} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )

  /* ---------------------------------------------------------------- */
  /*  RENDER                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      {/* Header with view toggle */}
      <div className={`bg-gradient-to-r ${config.gradient} px-5 py-3 flex items-center justify-between`}>
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>{config.emoji}</span>
          Knockout Stage
        </h2>
        {/* View toggle */}
        <div className="flex bg-white/15 rounded-lg p-0.5">
          <button
            onClick={() => setView('bracket')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              view === 'bracket' ? 'bg-white/25 text-white' : 'text-white/60 hover:text-white/80'
            }`}
          >
            Bracket
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              view === 'list' ? 'bg-white/25 text-white' : 'text-white/60 hover:text-white/80'
            }`}
          >
            List
          </button>
        </div>
      </div>

      {/* Content */}
      {view === 'bracket' ? renderBracketView() : renderListView()}

      {/* Predicted champion */}
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
