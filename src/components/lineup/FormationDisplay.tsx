'use client'

import { useMemo } from 'react'
import { CircleDot, Footprints } from 'lucide-react'

import { PlayerAvatar, RatingPill } from '@/components/primitives'

interface PlayerLineup {
  name: string
  /** Stable player identifier — when paired with playerIds map, enables headshot lookup. */
  id?: number | string
  position?: string
  jersey?: number
  isSubstitute?: boolean
  rating?: number
  events?: {
    goal?: number
    assist?: number
    yellowCard?: boolean
    redCard?: boolean
    subOff?: number
    subOn?: number
  }
}

interface FormationDisplayProps {
  players: PlayerLineup[]
  formation?: string
  teamName: string
  /** Legacy palette key (kept for back-compat callers). When teamTint is set it wins. */
  teamColor?: 'blue' | 'orange' | 'red' | 'green'
  showStats?: boolean
  /**
   * v2 — single brand colour for the whole side; replaces the by-role palette.
   * Reads as `--team-tint-home` or `--team-tint-away` if a parent wraps the
   * pitch with an inline style — but this prop is explicit and wins regardless.
   */
  teamTint?: string
  /**
   * v2 — when set, the player node renders as PlayerAvatar (headshot ring tinted
   * to teamTint, falls back to monogram). The shirt number sits below the name.
   */
  showAvatars?: boolean
  /**
   * v2 — 0–10 AI impact scores keyed by player.id (or player.name as fallback).
   * When provided, each starter node gets a RatingPill in the top-right.
   */
  aiImpactScores?: Record<string, number>
}

// Comprehensive position mapping to formation roles
const POSITION_TO_ROLE: Record<string, 'GK' | 'DEF' | 'MID' | 'FWD'> = {
  // Goalkeepers
  'GK': 'GK', 'G': 'GK', 'Goalkeeper': 'GK',
  
  // Defenders
  'CB': 'DEF', 'LB': 'DEF', 'RB': 'DEF', 'LWB': 'DEF', 'RWB': 'DEF',
  'D': 'DEF', 'DF': 'DEF', 'SW': 'DEF', 'LCB': 'DEF', 'RCB': 'DEF',
  'Defender': 'DEF', 'Center Back': 'DEF', 'Left Back': 'DEF', 'Right Back': 'DEF',
  
  // Midfielders
  'CM': 'MID', 'CDM': 'MID', 'CAM': 'MID', 'LM': 'MID', 'RM': 'MID',
  'DM': 'MID', 'AM': 'MID', 'M': 'MID', 'MF': 'MID',
  'LCM': 'MID', 'RCM': 'MID', 'LDM': 'MID', 'RDM': 'MID',
  'Midfielder': 'MID', 'Attacking Midfielder': 'MID', 'Defensive Midfielder': 'MID',
  
  // Forwards
  'ST': 'FWD', 'LW': 'FWD', 'RW': 'FWD', 'CF': 'FWD', 'F': 'FWD', 'FW': 'FWD',
  'SS': 'FWD', 'LF': 'FWD', 'RF': 'FWD',
  'Forward': 'FWD', 'Striker': 'FWD', 'Left Wing': 'FWD', 'Right Wing': 'FWD',
}

// Common formation configurations
const FORMATION_CONFIGS: Record<string, number[][]> = {
  // 4 at back
  '4-3-3': [[1], [4], [3], [3]],
  '4-4-2': [[1], [4], [4], [2]],
  '4-2-3-1': [[1], [4], [2, 3], [1]],
  '4-1-4-1': [[1], [4], [1, 4], [1]],
  '4-5-1': [[1], [4], [5], [1]],
  '4-4-1-1': [[1], [4], [4, 1], [1]],
  '4-1-2-3': [[1], [4], [1, 2], [3]],
  '4-3-2-1': [[1], [4], [3, 2], [1]],
  
  // 3 at back
  '3-4-3': [[1], [3], [4], [3]],
  '3-5-2': [[1], [3], [5], [2]],
  '3-4-2-1': [[1], [3], [4, 2], [1]],
  '3-4-1-2': [[1], [3], [4, 1], [2]],
  '3-1-4-2': [[1], [3], [1, 4], [2]],
  
  // 5 at back
  '5-3-2': [[1], [5], [3], [2]],
  '5-4-1': [[1], [5], [4], [1]],
  '5-2-3': [[1], [5], [2], [3]],
}

// Color schemes for teams
const TEAM_COLORS = {
  blue: {
    gk: 'bg-[var(--accent-warn)]',
    def: 'bg-[var(--accent-info)]',
    mid: 'bg-[var(--accent-info)]',
    fwd: 'bg-[var(--accent-info)]',
  },
  orange: {
    gk: 'bg-[var(--accent-warn)]',
    def: 'bg-[var(--accent-warn)]',
    mid: 'bg-[var(--accent-warn)]',
    fwd: 'bg-[var(--accent-loss)]',
  },
  red: {
    gk: 'bg-[var(--accent-warn)]',
    def: 'bg-[var(--accent-loss)]',
    mid: 'bg-[var(--accent-loss)]',
    fwd: 'bg-[var(--accent-loss)]',
  },
  green: {
    gk: 'bg-[var(--accent-warn)]',
    def: 'bg-[var(--accent-primary)]',
    mid: 'bg-[var(--accent-primary)]',
    fwd: 'bg-[var(--accent-primary)]',
  },
}

export default function FormationDisplay({
  players,
  formation,
  teamName,
  teamColor = 'blue',
  showStats = true,
  teamTint,
  showAvatars,
  aiImpactScores,
}: FormationDisplayProps) {
  // teamName is part of the public contract and may be surfaced by callers later
  // (e.g. screen-reader labels). Reference it explicitly so the linter doesn't
  // flag it as unused while still allowing callers to pass it.
  void teamName
  const colors = TEAM_COLORS[teamColor]
  
  // Parse and organize players into formation rows
  const formationRows = useMemo(() => {
    const starters = players.slice(0, 11)
    
    if (starters.length === 0) return null
    
    // Try to identify players by their positions first
    const gk: PlayerLineup[] = []
    const def: PlayerLineup[] = []
    const mid: PlayerLineup[] = []
    const fwd: PlayerLineup[] = []
    const unassigned: PlayerLineup[] = []
    
    starters.forEach(player => {
      const role = player.position ? POSITION_TO_ROLE[player.position] : undefined
      
      switch (role) {
        case 'GK': gk.push(player); break
        case 'DEF': def.push(player); break
        case 'MID': mid.push(player); break
        case 'FWD': fwd.push(player); break
        default: unassigned.push(player)
      }
    })
    
    const hasPositionData = gk.length > 0 || def.length > 0 || mid.length > 0 || fwd.length > 0
    
    // If we have position data, use it
    if (hasPositionData && gk.length === 1) {
      // Distribute unassigned players intelligently
      unassigned.forEach((player, idx) => {
        // Try to fit into the formation
        if (def.length < 5) def.push(player)
        else if (mid.length < 5) mid.push(player)
        else fwd.push(player)
      })
      
      return {
        rows: [
          { players: fwd, color: colors.fwd, label: 'FWD' },
          { players: mid, color: colors.mid, label: 'MID' },
          { players: def, color: colors.def, label: 'DEF' },
          { players: gk, color: colors.gk, label: 'GK' },
        ].filter(row => row.players.length > 0),
        formation: `${def.length}-${mid.length}-${fwd.length}`,
      }
    }
    
    // Parse formation string and distribute players
    const parseFormation = (formationStr: string | undefined): number[] => {
      if (!formationStr) return [4, 3, 3] // Default
      
      // Clean and parse
      const cleaned = formationStr.replace(/[^0-9-]/g, '')
      const parts = cleaned.split('-').map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0)
      
      if (parts.length >= 2) {
        // Ensure total is 10 (excluding GK)
        const total = parts.reduce((a, b) => a + b, 0)
        if (total === 10) return parts
        
        // Adjust if needed
        if (total < 10) {
          parts[parts.length - 1] += (10 - total)
        }
        return parts
      }
      
      return [4, 3, 3]
    }
    
    const formationNumbers = parseFormation(formation)
    
    // Distribute players by formation
    const rows: { players: PlayerLineup[]; color: string; label: string }[] = []
    let playerIndex = 1 // Start after GK
    
    // Build formation rows (from defense to attack)
    const rowLabels = ['DEF', 'MID', 'FWD', 'FWD'] // For formations with 4 rows
    const rowColors = [colors.def, colors.mid, colors.fwd, colors.fwd]
    
    formationNumbers.forEach((count, idx) => {
      const rowPlayers = starters.slice(playerIndex, playerIndex + count)
      if (rowPlayers.length > 0) {
        rows.push({
          players: rowPlayers,
          color: rowColors[Math.min(idx, rowColors.length - 1)],
          label: rowLabels[Math.min(idx, rowLabels.length - 1)],
        })
      }
      playerIndex += count
    })
    
    // Reverse so FWD is at top
    rows.reverse()
    
    // Add GK at bottom
    rows.push({
      players: starters.slice(0, 1),
      color: colors.gk,
      label: 'GK',
    })
    
    return {
      rows,
      formation: formationNumbers.join('-'),
    }
  }, [players, formation, colors])
  
  // Render a player node with jersey and name. v2 layers: if showAvatars is
  // set, use PlayerAvatar; if aiImpactScores is provided, surface a RatingPill.
  const renderPlayer = (player: PlayerLineup, idx: number, bgColor: string) => {
    const lastName = player.name.split(' ').pop() || player.name
    const hasEvents = player.events && (
      player.events.goal || player.events.assist ||
      player.events.yellowCard || player.events.redCard
    )

    // Resolve AI impact score by id then by name.
    const impactKey = player.id != null ? String(player.id) : player.name
    const impactScore = aiImpactScores?.[impactKey]

    return (
      <div
        key={`${player.name}-${idx}`}
        className="flex flex-col items-center group relative"
      >
        {/* Player avatar / circle */}
        {showAvatars ? (
          <PlayerAvatar
            playerId={player.id}
            name={player.name}
            size={44}
            teamColor={teamTint}
          />
        ) : (
          <div
            className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full ${bgColor} flex items-center justify-center text-white font-bold text-sm shadow-lg border-2 border-white/60 transition-transform group-hover:scale-110`}
            style={teamTint ? { background: teamTint, borderColor: 'var(--headshot-ring)' } : undefined}
          >
            {player.jersey || (idx + 1)}
          </div>
        )}

        {/* Player name */}
        <p className="text-[10px] sm:text-xs text-white mt-1 max-w-[60px] sm:max-w-[70px] truncate text-center drop-shadow-md font-medium">
          {lastName}
        </p>

        {/* Top-right cluster: AI impact pill (priority) → event indicators */}
        {impactScore != null ? (
          <div className="absolute -top-1 -right-1">
            <RatingPill value={impactScore} compact />
          </div>
        ) : (
          hasEvents && showStats && (
            <div className="absolute -top-2 -right-1 flex gap-0.5">
              {player.events?.goal && (
                <span className="bg-white rounded-full w-4 h-4 flex items-center justify-center shadow">
                  <CircleDot className="h-3 w-3 text-[var(--accent-primary)]" aria-hidden />
                </span>
              )}
              {player.events?.assist && (
                <span className="bg-white rounded-full w-4 h-4 flex items-center justify-center shadow">
                  <Footprints className="h-3 w-3 text-[var(--text-secondary)]" aria-hidden />
                </span>
              )}
              {player.events?.yellowCard && (
                <span className="w-2 h-3 bg-[var(--accent-warn)] rounded-sm shadow" />
              )}
              {player.events?.redCard && (
                <span className="w-2 h-3 bg-[var(--accent-loss)] rounded-sm shadow" />
              )}
            </div>
          )
        )}

        {/* Hover tooltip with full name */}
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
          {player.name}
          {player.position && <span className="ml-1 text-white/70">({player.position})</span>}
        </div>
      </div>
    )
  }
  
  if (!formationRows) {
    return (
      <div className="flex items-center justify-center h-[300px] text-white/60">
        Lineup not available
      </div>
    )
  }
  
  return (
    <div className="relative h-full min-h-[320px] flex flex-col justify-between py-3 gap-4">
      {formationRows.rows.map((row, rowIdx) => (
        <div
          key={rowIdx}
          className="flex justify-center items-center gap-3 sm:gap-4 px-2"
          style={{
            // Distribute evenly across the pitch
            flex: row.label === 'GK' ? '0 0 auto' : 1,
          }}
        >
          {row.players.map((player, playerIdx) => 
            renderPlayer(player, playerIdx, row.color)
          )}
        </div>
      ))}
    </div>
  )
}

// Separate component for the pitch background. v2 reads `--pitch-bg` and
// `--accent-pitch-line*` (Phase 0.A) instead of hardcoded green / white-40.
export function PitchBackground({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative p-4 min-h-[350px] overflow-hidden"
      style={{
        background: `linear-gradient(to bottom,
          var(--pitch-bg),
          color-mix(in srgb, var(--pitch-bg) 88%, white 12%),
          var(--pitch-bg)
        )`,
      }}
    >
      {/* Pitch pattern stripes */}
      <div className="absolute inset-0 opacity-20">
        {[...Array(10)].map((_, i) => (
          <div
            key={i}
            className={`h-[10%] ${i % 2 === 0 ? 'bg-black/10' : ''}`}
          />
        ))}
      </div>

      {/* Pitch lines — strong tier for outer border + centre features */}
      <div
        className="absolute inset-4 rounded-lg border-2"
        style={{ borderColor: 'var(--accent-pitch-line-strong)' }}
      >
        {/* Halfway line */}
        <div className="absolute left-0 right-0 top-1/2 h-0.5" style={{ background: 'var(--accent-pitch-line-strong)' }} />

        {/* Centre circle */}
        <div
          className="absolute left-1/2 top-1/2 w-20 h-20 -ml-10 -mt-10 rounded-full border-2"
          style={{ borderColor: 'var(--accent-pitch-line-strong)' }}
        />
        <div
          className="absolute left-1/2 top-1/2 w-2 h-2 -ml-1 -mt-1 rounded-full"
          style={{ background: 'var(--accent-pitch-line-strong)' }}
        />

        {/* Goal areas — soft tier */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-12 border-2 border-t-0"
          style={{ borderColor: 'var(--accent-pitch-line)' }}
        />
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-4 border-2 border-t-0"
          style={{ borderColor: 'var(--accent-pitch-line)' }}
        />
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-32 h-12 border-2 border-b-0"
          style={{ borderColor: 'var(--accent-pitch-line)' }}
        />
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-4 border-2 border-b-0"
          style={{ borderColor: 'var(--accent-pitch-line)' }}
        />

        {/* Corner arcs */}
        <div
          className="absolute top-0 left-0 w-4 h-4 border-b-2 border-r-2 rounded-br-full"
          style={{ borderColor: 'var(--accent-pitch-line)' }}
        />
        <div
          className="absolute top-0 right-0 w-4 h-4 border-b-2 border-l-2 rounded-bl-full"
          style={{ borderColor: 'var(--accent-pitch-line)' }}
        />
        <div
          className="absolute bottom-0 left-0 w-4 h-4 border-t-2 border-r-2 rounded-tr-full"
          style={{ borderColor: 'var(--accent-pitch-line)' }}
        />
        <div
          className="absolute bottom-0 right-0 w-4 h-4 border-t-2 border-l-2 rounded-tl-full"
          style={{ borderColor: 'var(--accent-pitch-line)' }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 h-full">{children}</div>
    </div>
  )
}

// Substitutes bench component
export function SubstitutesBench({ players }: { players: PlayerLineup[] }) {
  if (players.length === 0) return null
  
  return (
    <div className="p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Substitutes</h4>
      <div className="flex flex-wrap gap-2">
        {players.map((player, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--muted-bg)]"
          >
            <span className="w-5 h-5 rounded-full bg-[var(--text-tertiary)] text-white text-[10px] flex items-center justify-center">
              {player.jersey || (idx + 12)}
            </span>
            <span className="text-xs text-[var(--text-primary)]">
              {player.name}
            </span>
            {player.position && (
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {player.position}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
