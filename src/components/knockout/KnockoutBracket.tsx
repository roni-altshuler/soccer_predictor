'use client'

import { useState, useMemo } from 'react'

/* ==================================================================
   TYPES
   ================================================================== */

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

/* ==================================================================
   TOURNAMENT CONFIG
   ================================================================== */

const TOURNAMENT_CONFIG = {
  champions_league: {
    name: 'UEFA Champions League',
    emoji: '\u{1F3C6}',
    gradient: 'from-[#0D1B4A] to-[#1A3A8F]',
    accent: '#3B82F6',
    accentBg: 'rgba(59,130,246,0.12)',
    textColor: 'text-blue-400',
    rounds: ['KO Play-offs', 'Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    isTwoLegged: [true, true, true, true, false],
    roundShort: ['PO', 'R16', 'QF', 'SF', 'F'],
  },
  europa_league: {
    name: 'UEFA Europa League',
    emoji: '\u{1F3C6}',
    gradient: 'from-[#3D1F00] to-[#C2590A]',
    accent: '#F97316',
    accentBg: 'rgba(249,115,22,0.12)',
    textColor: 'text-orange-400',
    rounds: ['KO Play-offs', 'Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    isTwoLegged: [true, true, true, true, false],
    roundShort: ['PO', 'R16', 'QF', 'SF', 'F'],
  },
  world_cup: {
    name: 'FIFA World Cup',
    emoji: '\u{1F30D}',
    gradient: 'from-[#2D0A3E] to-[#7C1940]',
    accent: '#A855F7',
    accentBg: 'rgba(168,85,247,0.12)',
    textColor: 'text-purple-400',
    rounds: ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    isTwoLegged: [false, false, false, false],
    roundShort: ['R16', 'QF', 'SF', 'F'],
  },
  conference_league: {
    name: 'UEFA Conference League',
    emoji: '\u{1F3C6}',
    gradient: 'from-[#0A3D2A] to-[#10B981]',
    accent: '#10B981',
    accentBg: 'rgba(16,185,129,0.12)',
    textColor: 'text-emerald-400',
    rounds: ['KO Play-offs', 'Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    isTwoLegged: [true, true, true, true, false],
    roundShort: ['PO', 'R16', 'QF', 'SF', 'F'],
  },
}

/* ==================================================================
   HELPERS
   ================================================================== */

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

/* ==================================================================
   BRACKET MATCH CARD
   ================================================================== */

function BracketMatchCard({
  tie,
  accent,
  isTwoLegged,
  mirrored = false,
  onMatchClick,
}: {
  tie: Tie
  accent: string
  isTwoLegged: boolean
  mirrored?: boolean
  onMatchClick?: (m: KnockoutMatch) => void
}) {
  const first = tie.legs[0]
  const second = tie.legs[1]
  const hasResult = tie.legs.some(l => l.status === 'finished')
  const isLive = tie.legs.some(l => l.status === 'live')

  let aggHome = 0, aggAway = 0
  if (isTwoLegged && tie.legs.length >= 2) {
    aggHome = (first.homeScore ?? 0) + (second?.awayScore ?? 0)
    aggAway = (first.awayScore ?? 0) + (second?.homeScore ?? 0)
  }

  const displayMatch = tie.legs.find(l => l.status === 'live') || tie.legs.find(l => l.status === 'finished') || first
  const team1 = mirrored ? tie.teams[1] : tie.teams[0]
  const team2 = mirrored ? tie.teams[0] : tie.teams[1]
  const isTeam1Winner = mirrored ? tie.winner === 'away' : tie.winner === 'home'
  const isTeam2Winner = mirrored ? tie.winner === 'home' : tie.winner === 'away'

  const score1 = isTwoLegged
    ? (hasResult ? (mirrored ? aggAway : aggHome) : undefined)
    : mirrored ? first.awayScore : first.homeScore
  const score2 = isTwoLegged
    ? (hasResult ? (mirrored ? aggHome : aggAway) : undefined)
    : mirrored ? first.homeScore : first.awayScore

  const TeamRow = ({ name, score, isWinner }: { name: string; score?: number; isWinner: boolean }) => (
    <div
      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/[0.04] transition-colors"
      style={isWinner ? { background: `${accent}18` } : undefined}
      onClick={() => onMatchClick?.(displayMatch)}
    >
      <span
        className="w-1.5 self-stretch rounded-full"
        style={{ background: isWinner ? accent : 'transparent' }}
      />
      <span className={`text-[11px] flex-1 truncate leading-tight ${
        isWinner ? 'font-bold text-[var(--text-primary)]'
        : name === 'TBD' ? 'text-[var(--text-tertiary)] italic'
        : 'text-[var(--text-secondary)]'
      }`}>
        {name || 'TBD'}
      </span>
      <span className={`text-[11px] tabular-nums min-w-[16px] text-right font-bold ${
        isLive ? 'text-red-400'
        : isWinner ? 'text-[var(--text-primary)]'
        : 'text-[var(--text-tertiary)]'
      }`}>
        {score !== undefined ? score : '-'}
      </span>
    </div>
  )

  return (
    <div className={`rounded-xl border overflow-hidden transition-all w-full shadow-sm ${
      isLive ? 'ring-1 ring-red-500/60 border-red-500/40' : 'border-[var(--border-color)]'
    }`}
    style={{ background: 'linear-gradient(180deg, var(--muted-bg), color-mix(in srgb, var(--muted-bg) 82%, black 18%))' }}
    >
      <TeamRow name={team1} score={score1} isWinner={isTeam1Winner} />
      <div className="h-px" style={{ background: 'var(--border-color)', opacity: 0.4 }} />
      <TeamRow name={team2} score={score2} isWinner={isTeam2Winner} />
    </div>
  )
}

/* ==================================================================
   BRACKET COLUMN
   ================================================================== */

function BracketColumn({
  roundShort,
  ties,
  accent,
  isTwoLegged,
  mirrored = false,
  onMatchClick,
}: {
  roundShort: string
  ties: Tie[]
  accent: string
  isTwoLegged: boolean
  mirrored?: boolean
  onMatchClick?: (m: KnockoutMatch) => void
}) {
  return (
    <div className="flex flex-col items-center" style={{ minWidth: 0, flex: '1 1 0' }}>
      <div className="flex flex-col justify-around flex-1 w-full gap-2 px-1">
        {ties.length > 0 ? (
          ties.map((tie, i) => (
            <BracketMatchCard
              key={i}
              tie={tie}
              accent={accent}
              isTwoLegged={isTwoLegged}
              mirrored={mirrored}
              onMatchClick={onMatchClick}
            />
          ))
        ) : (
          <div className="flex items-center justify-center py-4">
            <span className="text-[10px] text-[var(--text-tertiary)] italic">TBD</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ==================================================================
   TROPHY CENTER
   ================================================================== */

function TrophyCenter({
  config,
  champion,
  finalTie,
  accent,
  onMatchClick,
}: {
  config: typeof TOURNAMENT_CONFIG.champions_league
  champion?: TeamProbability
  finalTie?: Tie
  accent: string
  onMatchClick?: (m: KnockoutMatch) => void
}) {
  return (
    <div className="flex flex-col items-center justify-center px-2" style={{ minWidth: 100 }}>
      <div className="relative mb-3">
        <div className="text-4xl sm:text-5xl drop-shadow-lg">{config.emoji}</div>
        <div
          className="absolute -inset-3 rounded-full blur-xl opacity-25"
          style={{ background: accent }}
        />
      </div>

      {finalTie && (
        <div className="w-full max-w-[140px] mb-2">
          <BracketMatchCard
            tie={finalTie}
            accent={accent}
            isTwoLegged={false}
            onMatchClick={onMatchClick}
          />
        </div>
      )}

      {champion && (
        <div className="mt-1 text-center">
          <span className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-wide block">Predicted</span>
          <span className="text-[11px] font-bold text-[var(--text-primary)]">{champion.team}</span>
          <span className={`text-[10px] font-semibold ml-1 ${config.textColor}`}>
            {(champion.probability * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}

/* ==================================================================
   MOBILE FALLBACK
   ================================================================== */

function MobileBracketView({
  config,
  roundTies,
  onMatchClick,
  simulationData,
}: {
  config: typeof TOURNAMENT_CONFIG.champions_league
  roundTies: { name: string; ties: Tie[]; isTwoLegged: boolean; short: string }[]
  onMatchClick?: (m: KnockoutMatch) => void
  simulationData?: SimulationData
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  const current = roundTies[activeIdx] || roundTies[0]

  return (
    <div>
      <div className="flex items-center border-b border-[var(--border-color)] overflow-x-auto">
        {roundTies.map((r, idx) => (
          <button
            key={r.short}
            onClick={() => setActiveIdx(idx)}
            className={`relative px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              idx === activeIdx ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {r.short}
            {idx === activeIdx && (
              <div
                className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] rounded-full"
                style={{ width: '60%', background: config.accent }}
              />
            )}
          </button>
        ))}
        <div className="ml-auto px-3 py-2 text-lg">{config.emoji}</div>
      </div>

      <div className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">{current.name}</h3>
          <span className="text-[10px] text-[var(--text-tertiary)] bg-[var(--muted-bg)] px-2 py-0.5 rounded-full">
            {current.ties.length} {current.ties.length === 1 ? 'tie' : 'ties'}
          </span>
          {current.isTwoLegged && (
            <span className="text-[10px] text-[var(--text-tertiary)] bg-[var(--muted-bg)] px-2 py-0.5 rounded-full">2 legs</span>
          )}
        </div>
        <div className={`grid gap-2.5 ${
          current.ties.length === 1 ? 'grid-cols-1 max-w-xs'
          : current.ties.length <= 2 ? 'grid-cols-1 sm:grid-cols-2'
          : 'grid-cols-1 sm:grid-cols-2'
        }`}>
          {current.ties.map((tie, i) => (
            <BracketMatchCard
              key={i}
              tie={tie}
              accent={config.accent}
              isTwoLegged={current.isTwoLegged}
              onMatchClick={onMatchClick}
            />
          ))}
        </div>
      </div>

      {simulationData?.champion?.[0] && (
        <div className="border-t border-[var(--border-color)] px-3 py-2 flex items-center justify-center gap-2">
          <span className="text-xs">{config.emoji}</span>
          <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Predicted:</span>
          <span className="text-xs font-bold text-[var(--text-primary)]">{simulationData.champion[0].team}</span>
          <span className={`text-[11px] font-semibold ${config.textColor}`}>
            {(simulationData.champion[0].probability * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}

/* ==================================================================
   MAIN COMPONENT - Road to the Final
   ================================================================== */

export default function KnockoutBracket({
  tournament,
  rounds = [],
  simulationData,
  showProbabilities = false,
  onMatchClick,
}: KnockoutBracketProps) {
  const config = TOURNAMENT_CONFIG[tournament]
  const displayRounds = rounds.length > 0 ? rounds : []

  const roundTies = useMemo(() =>
    displayRounds.map((r, idx) => ({
      name: r.name,
      ties: groupIntoTies(r.matches),
      isTwoLegged: config.isTwoLegged[idx] ?? false,
      short: config.roundShort[idx] ?? r.name.slice(0, 3),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayRounds.length, displayRounds.map(r => r.matches.length).join(',')]
  )

  if (displayRounds.length === 0) {
    return (
      <div
        className="rounded-xl border border-[var(--border-color)] p-8 text-center"
        style={{ background: 'var(--card-bg)' }}
      >
        <span className="text-4xl mb-3 block">{config.emoji}</span>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">{config.name} Knockout Stage</h3>
        <p className="text-xs text-[var(--text-tertiary)]">Bracket will appear once teams are confirmed</p>
      </div>
    )
  }

  /* Split rounds: everything except Final goes left+right, Final goes center */
  const allButFinal = roundTies.slice(0, -1)
  const finalRound = roundTies[roundTies.length - 1]
  const finalTie = finalRound?.ties?.[0]

  const leftRounds = allButFinal.map(r => ({
    ...r,
    ties: r.ties.slice(0, Math.ceil(r.ties.length / 2)),
  }))
  const rightRounds = allButFinal.map(r => ({
    ...r,
    ties: r.ties.slice(Math.ceil(r.ties.length / 2)),
  }))

  return (
    <div
      className="rounded-xl border border-[var(--border-color)] overflow-hidden"
      style={{ background: 'var(--card-bg)' }}
    >
      {/* Gradient header */}
      <div className={`bg-gradient-to-r ${config.gradient} px-4 py-3 flex items-center justify-center gap-3`}>
        <span className="text-base">{config.emoji}</span>
        <h2 className="text-xs font-extrabold text-white uppercase tracking-[0.15em]">
          Road to the Final
        </h2>
        <span className="text-base">{config.emoji}</span>
      </div>

      {/* Round labels header - desktop */}
      <div className="hidden md:flex items-center px-2 py-1.5 border-b" style={{ borderColor: 'var(--border-color)' }}>
        {leftRounds.map((r) => (
          <div key={`lh-${r.short}`} className="flex-1 text-center text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
            {r.name}
          </div>
        ))}
        <div className="text-center text-[9px] font-bold uppercase tracking-wider px-2" style={{ color: config.accent, minWidth: 100 }}>
          Final
        </div>
        {[...rightRounds].reverse().map((r) => (
          <div key={`rh-${r.short}`} className="flex-1 text-center text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
            {r.name}
          </div>
        ))}
      </div>

      {/* Desktop: Full bracket layout */}
      <div className="hidden md:flex items-stretch py-4 px-2 min-h-[360px]">
        {/* LEFT SIDE */}
        {leftRounds.map((r) => (
          <BracketColumn
            key={`left-${r.short}`}
            roundShort={r.short}
            ties={r.ties}
            accent={config.accent}
            isTwoLegged={r.isTwoLegged}
            onMatchClick={onMatchClick}
          />
        ))}

        {/* CENTER - Trophy + Final */}
        <TrophyCenter
          config={config}
          champion={simulationData?.champion?.[0]}
          finalTie={finalTie}
          accent={config.accent}
          onMatchClick={onMatchClick}
        />

        {/* RIGHT SIDE - mirrored, reversed order */}
        {[...rightRounds].reverse().map((r) => (
          <BracketColumn
            key={`right-${r.short}`}
            roundShort={r.short}
            ties={r.ties}
            accent={config.accent}
            isTwoLegged={r.isTwoLegged}
            mirrored={true}
            onMatchClick={onMatchClick}
          />
        ))}
      </div>

      {/* Mobile: Tab-based fallback */}
      <div className="md:hidden">
        <MobileBracketView
          config={config}
          roundTies={roundTies}
          onMatchClick={onMatchClick}
          simulationData={simulationData}
        />
      </div>

      {/* Predicted champion bar - desktop */}
      {simulationData?.champion?.[0] && (
        <div className="hidden md:flex border-t px-3 py-2 items-center justify-center gap-2" style={{ borderColor: 'var(--border-color)' }}>
          <span className="text-xs">{config.emoji}</span>
          <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Predicted Champion:</span>
          <span className="text-xs font-bold text-[var(--text-primary)]">{simulationData.champion[0].team}</span>
          <span className={`text-[11px] font-semibold ${config.textColor}`}>
            {(simulationData.champion[0].probability * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}

export type { SimulationData, TeamProbability }
