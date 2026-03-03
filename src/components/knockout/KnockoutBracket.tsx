'use client'

import { useState, useMemo } from 'react'

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
    accent: '#3B82F6',
    color: 'blue',
    textColor: 'text-blue-500',
    rounds: ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    isTwoLegged: [true, true, true, false],
  },
  europa_league: {
    name: 'UEFA Europa League',
    emoji: '🏆',
    gradient: 'from-orange-500 to-amber-500',
    accent: '#F97316',
    color: 'orange',
    textColor: 'text-orange-500',
    rounds: ['Round of 32', 'Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    isTwoLegged: [true, true, true, true, false],
  },
  world_cup: {
    name: 'FIFA World Cup',
    emoji: '🌍',
    gradient: 'from-purple-900 to-red-800',
    accent: '#A855F7',
    color: 'purple',
    textColor: 'text-purple-500',
    rounds: ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Third Place', 'Final'],
    isTwoLegged: [false, false, false, false, false],
  },
  conference_league: {
    name: 'UEFA Conference League',
    emoji: '🏆',
    gradient: 'from-green-600 to-emerald-500',
    accent: '#10B981',
    color: 'green',
    textColor: 'text-green-500',
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
/*  Compact team row — FotMob-inspired                                 */
/* ------------------------------------------------------------------ */
function TeamRow({
  name,
  score,
  penalties,
  isWinner,
  isLive,
  position,
  accent,
}: {
  name: string
  score?: number
  penalties?: number
  isWinner: boolean
  isLive: boolean
  position: 'top' | 'bottom'
  accent: string
}) {
  return (
    <div
      className={`flex items-center justify-between gap-1 px-2 py-[5px] ${
        position === 'top' ? 'border-b border-[var(--border-color)]/40' : ''
      }`}
      style={isWinner ? { background: `${accent}0A` } : undefined}
    >
      <span
        className={`text-[11px] leading-tight truncate flex-1 ${
          isWinner
            ? 'font-semibold text-[var(--text-primary)]'
            : name === 'TBD'
              ? 'text-[var(--text-tertiary)] italic'
              : 'text-[var(--text-secondary)]'
        }`}
      >
        {name || 'TBD'}
      </span>
      <div className="flex items-center gap-0.5 shrink-0">
        <span
          className={`text-[11px] tabular-nums min-w-[12px] text-right ${
            isLive
              ? 'font-bold text-red-500'
              : isWinner
                ? 'font-bold text-[var(--text-primary)]'
                : score !== undefined ? 'text-[var(--text-secondary)]' : ''
          }`}
        >
          {score !== undefined ? score : ''}
        </span>
        {penalties !== undefined && (
          <span className="text-[8px] text-[var(--text-tertiary)]">({penalties})</span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Compact match card for bracket                                     */
/* ------------------------------------------------------------------ */
function BracketCard({
  match,
  accent,
  cardWidth,
  onMatchClick,
}: {
  match: KnockoutMatch
  accent: string
  cardWidth: number
  onMatchClick?: (m: KnockoutMatch) => void
}) {
  const isLive = match.status === 'live'
  const isFinished = match.status === 'finished'

  return (
    <div
      onClick={() => onMatchClick?.(match)}
      className={`rounded border overflow-hidden cursor-pointer transition-all
        hover:shadow-sm hover:border-[var(--accent-primary)]
        ${isLive ? 'ring-1 ring-red-500/40 border-red-500/50' : 'border-[var(--border-color)]'}`}
      style={{ width: cardWidth, background: 'var(--card-bg)' }}
    >
      <TeamRow name={match.homeTeam} score={match.homeScore} penalties={match.homePenalties} isWinner={match.winner === 'home'} isLive={isLive} position="top" accent={accent} />
      <TeamRow name={match.awayTeam} score={match.awayScore} penalties={match.awayPenalties} isWinner={match.winner === 'away'} isLive={isLive} position="bottom" accent={accent} />
      <div
        className={`text-center text-[8px] leading-tight py-[2px] ${
          isLive
            ? 'bg-red-500/15 text-red-500 font-bold'
            : 'bg-[var(--muted-bg)]/50 text-[var(--text-tertiary)]'
        }`}
      >
        {isLive ? (
          <span className="flex items-center justify-center gap-0.5">
            <span className="w-[5px] h-[5px] rounded-full bg-red-500 animate-pulse" />
            LIVE
          </span>
        ) : isFinished ? 'FT' : (match.date || 'TBD')}
        {match.leg ? <span className="ml-0.5">· L{match.leg}</span> : null}
      </div>
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

  const roundTies = useMemo(() =>
    displayRounds.map(r => ({
      name: r.name,
      ties: groupIntoTies(r.matches),
      matchCount: r.matches.length,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayRounds.length, displayRounds.map(r => r.matches.length).join(',')]
  )

  // Responsive sizing: more rounds → smaller cards
  const numRounds = roundTies.length
  const isCompact = numRounds >= 5
  const CARD_W = isCompact ? 120 : numRounds >= 4 ? 136 : 148
  const CARD_H = 46 // two 18px rows + 10px footer
  const CONNECTOR_W = isCompact ? 12 : 16
  const COL_W = CARD_W + CONNECTOR_W
  const GAP_BASE = 6

  // Empty state
  if (displayRounds.length === 0) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-6 text-center">
        <span className="text-3xl mb-2 block">🏆</span>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">{config.name} Knockout Stage</h3>
        <p className="text-xs text-[var(--text-tertiary)]">Bracket will appear once teams are confirmed</p>
      </div>
    )
  }

  const expectedMatchCount = (roundIndex: number) =>
    Math.max(1, Math.pow(2, numRounds - 1 - roundIndex))

  /* ---------------------------------------------------------------- */
  /*  BRACKET VIEW — compact horizontal, fits viewport                 */
  /* ---------------------------------------------------------------- */
  const renderBracketView = () => (
    <div className="overflow-x-auto">
      <div className="flex items-start min-w-max px-2 py-2" style={{ minHeight: Math.min(520, 60 + expectedMatchCount(0) * (CARD_H + GAP_BASE * 2)) }}>
        {roundTies.map((round, rIdx) => {
          const gapMultiplier = Math.pow(2, rIdx)
          const topPad = (gapMultiplier - 1) * (CARD_H / 2 + GAP_BASE / 2)
          const gap = gapMultiplier * (CARD_H + GAP_BASE * 2) - CARD_H
          const isLast = rIdx === roundTies.length - 1
          const expected = expectedMatchCount(rIdx)
          const items = round.ties.length > 0 ? round.ties : null

          return (
            <div key={round.name} className="flex items-start shrink-0">
              <div className="flex flex-col items-center" style={{ width: COL_W - CONNECTOR_W }}>
                {/* Round label pill */}
                <div className="mb-1.5 text-center">
                  <span
                    className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-[1px] rounded-full inline-block"
                    style={{ color: config.accent, background: `${config.accent}10` }}
                  >
                    {round.name.replace('Round of ', 'R').replace('Quarter-Finals', 'QF').replace('Semi-Finals', 'SF').replace('Third Place', '3rd')}
                  </span>
                </div>

                <div className="flex flex-col" style={{ paddingTop: topPad, gap }}>
                  {items
                    ? items.map((tie, tIdx) => {
                        const displayMatch =
                          tie.legs.find(l => l.status === 'finished') ||
                          tie.legs.find(l => l.status === 'live') ||
                          tie.legs[0]
                        return (
                          <BracketCard
                            key={tIdx}
                            match={displayMatch}
                            accent={config.accent}
                            cardWidth={CARD_W}
                            onMatchClick={onMatchClick}
                          />
                        )
                      })
                    : Array.from({ length: expected }).map((_, i) => (
                        <div
                          key={i}
                          className="rounded border border-dashed border-[var(--border-color)] flex items-center justify-center"
                          style={{ width: CARD_W, height: CARD_H }}
                        >
                          <span className="text-[8px] text-[var(--text-tertiary)]">TBD</span>
                        </div>
                      ))
                  }
                </div>
              </div>

              {/* Connector lines */}
              {!isLast && (
                <div
                  className="flex flex-col items-center justify-start shrink-0"
                  style={{ width: CONNECTOR_W, paddingTop: topPad + CARD_H / 2 + 20 }}
                >
                  {Array.from({ length: Math.max(1, Math.ceil((items?.length || expected) / 2)) }).map((_, cIdx) => {
                    const pairGap = gap + CARD_H
                    return (
                      <div key={cIdx} style={{ height: pairGap, marginBottom: gap > 0 ? gap : 6 }}>
                        <svg width={CONNECTOR_W} height={pairGap} className="text-[var(--border-color)]">
                          <line x1={0} y1={0} x2={CONNECTOR_W / 2} y2={0} stroke="currentColor" strokeWidth="1" />
                          <line x1={0} y1={pairGap} x2={CONNECTOR_W / 2} y2={pairGap} stroke="currentColor" strokeWidth="1" />
                          <line x1={CONNECTOR_W / 2} y1={0} x2={CONNECTOR_W / 2} y2={pairGap} stroke="currentColor" strokeWidth="1" />
                          <line x1={CONNECTOR_W / 2} y1={pairGap / 2} x2={CONNECTOR_W} y2={pairGap / 2} stroke="currentColor" strokeWidth="1" />
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
        <div className="flex flex-col items-center justify-center ml-1 pt-4">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shadow-md"
            style={{ background: `linear-gradient(135deg, ${config.accent}, ${config.accent}AA)` }}
          >
            <span className="text-sm">🏆</span>
          </div>
        </div>
      </div>
    </div>
  )

  /* ---------------------------------------------------------------- */
  /*  LIST VIEW — compact grid grouped by round                        */
  /* ---------------------------------------------------------------- */
  const renderListView = () => (
    <div className="p-3 space-y-3">
      {displayRounds.map(round => {
        const ties = groupIntoTies(round.matches)
        const finishedCount = round.matches.filter(m => m.status === 'finished').length
        return (
          <div key={round.name}>
            <div className="flex items-center gap-2 mb-1.5">
              <h3 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: config.accent }}>
                {round.name}
              </h3>
              <span className="text-[9px] text-[var(--text-tertiary)] bg-[var(--muted-bg)] px-1.5 py-0.5 rounded-full">
                {finishedCount}/{round.matches.length}
              </span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {ties.map((tie, i) => (
                <div key={i} className="border border-[var(--border-color)] rounded overflow-hidden bg-[var(--card-bg)]">
                  {tie.legs.map((match, li) => {
                    const isLive = match.status === 'live'
                    const isFinished = match.status === 'finished'
                    return (
                      <div
                        key={match.id}
                        onClick={() => onMatchClick?.(match)}
                        className={`flex items-center cursor-pointer hover:bg-[var(--muted-bg)] transition-colors text-[11px] ${
                          li > 0 ? 'border-t border-[var(--border-color)]/50' : ''
                        }`}
                      >
                        <div className="w-6 shrink-0 text-center text-[8px] text-[var(--text-tertiary)]">
                          {match.leg ? `L${match.leg}` : ''}
                        </div>
                        <div className={`flex-1 text-right pr-1 py-1 truncate ${match.winner === 'home' ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {match.homeTeam}
                        </div>
                        <div className="w-9 text-center shrink-0 py-1">
                          {isLive ? (
                            <span className="font-bold text-red-500">{match.homeScore ?? 0}-{match.awayScore ?? 0}</span>
                          ) : isFinished ? (
                            <span className="font-bold text-[var(--text-primary)]">{match.homeScore}-{match.awayScore}</span>
                          ) : (
                            <span className="text-[8px] text-[var(--text-tertiary)]">vs</span>
                          )}
                        </div>
                        <div className={`flex-1 pl-1 py-1 truncate ${match.winner === 'away' ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {match.awayTeam}
                        </div>
                        <div className="w-4 shrink-0 text-center">
                          {isFinished && <span className="text-[7px] text-[var(--text-tertiary)]">FT</span>}
                          {isLive && <span className="w-1 h-1 rounded-full bg-red-500 animate-pulse inline-block" />}
                        </div>
                      </div>
                    )
                  })}
                </div>
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
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
      {/* Slim gradient header */}
      <div className={`bg-gradient-to-r ${config.gradient} px-3 py-1.5 flex items-center justify-between`}>
        <h2 className="text-xs font-bold text-white flex items-center gap-1.5">
          <span>{config.emoji}</span>
          Knockout Stage
        </h2>
        <div className="flex bg-white/15 rounded p-[2px] gap-0.5">
          <button
            onClick={() => setView('bracket')}
            className={`px-2 py-[2px] rounded text-[9px] font-medium transition-colors ${
              view === 'bracket' ? 'bg-white/25 text-white' : 'text-white/60 hover:text-white/80'
            }`}
          >
            Bracket
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-2 py-[2px] rounded text-[9px] font-medium transition-colors ${
              view === 'list' ? 'bg-white/25 text-white' : 'text-white/60 hover:text-white/80'
            }`}
          >
            List
          </button>
        </div>
      </div>

      {view === 'bracket' ? renderBracketView() : renderListView()}

      {/* Predicted champion — slim bar */}
      {simulationData?.champion && simulationData.champion.length > 0 && (
        <div className="border-t border-[var(--border-color)] px-3 py-1.5 flex items-center justify-center gap-2">
          <span className="text-xs">🏆</span>
          <span className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-wide">Predicted:</span>
          <span className="text-[11px] font-bold text-[var(--text-primary)]">{simulationData.champion[0].team}</span>
          <span className={`text-[10px] font-semibold ${config.textColor}`}>
            {(simulationData.champion[0].probability * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}

// Export types
export type { SimulationData, TeamProbability }
