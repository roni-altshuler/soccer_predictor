'use client'

import { EmptyState } from '@/components/EmptyState'
import FormationDisplay, { PitchBackground, SubstitutesBench } from '@/components/lineup/FormationDisplay'
import { RatingPill } from '@/components/primitives'

import type { MatchDetails, MatchEvent, PlayerLineup } from './types'

interface PlayerMatchEvents {
  goal?: number
  assist?: number
  yellowCard?: boolean
  redCard?: boolean
  subOff?: number
  subOn?: number
}

/** Fold the match event feed into per-player badges for one side. */
function buildPlayerEvents(events: MatchEvent[], team: 'home' | 'away'): Map<string, PlayerMatchEvents> {
  const map = new Map<string, PlayerMatchEvents>()
  const upsert = (name: string | undefined, patch: (e: PlayerMatchEvents) => void) => {
    if (!name) return
    const entry = map.get(name) ?? {}
    patch(entry)
    map.set(name, entry)
  }

  for (const evt of events) {
    if (evt.team !== team) continue
    switch (evt.type) {
      case 'goal':
        upsert(evt.player, (e) => {
          e.goal = (e.goal ?? 0) + 1
        })
        upsert(evt.relatedPlayer, (e) => {
          e.assist = (e.assist ?? 0) + 1
        })
        break
      case 'yellow_card':
        upsert(evt.player, (e) => {
          e.yellowCard = true
        })
        break
      case 'red_card':
        upsert(evt.player, (e) => {
          e.redCard = true
        })
        break
      case 'substitution':
        // Feed convention: `player` goes off, `relatedPlayer` comes on.
        upsert(evt.player, (e) => {
          e.subOff = evt.minute
        })
        upsert(evt.relatedPlayer, (e) => {
          e.subOn = evt.minute
        })
        break
      default:
        break
    }
  }
  return map
}

interface SideData {
  teamName: string
  formation?: string
  coach?: string
  tint: string
  starters: Array<PlayerLineup & { events?: PlayerMatchEvents }>
  bench: Array<PlayerLineup & { events?: PlayerMatchEvents }>
}

function buildSide(match: MatchDetails, side: 'home' | 'away'): SideData {
  const all = side === 'home' ? match.lineups.home : match.lineups.away
  const declaredBench = side === 'home' ? match.lineups.homeBench : match.lineups.awayBench
  const events = buildPlayerEvents(match.events, side)

  // The API appends the bench after the XI; without an explicit bench the
  // legacy convention applies (first 11 = starters).
  const benchSize = declaredBench?.length ?? Math.max(0, all.length - 11)
  const starters = all.slice(0, all.length - benchSize)
  const bench = declaredBench ?? all.slice(all.length - benchSize)

  const attach = (p: PlayerLineup) => ({ ...p, events: events.get(p.name) })

  return {
    teamName: side === 'home' ? match.home_team : match.away_team,
    formation: side === 'home' ? match.lineups.homeFormation : match.lineups.awayFormation,
    coach: side === 'home' ? match.lineups.homeCoach : match.lineups.awayCoach,
    tint: side === 'home' ? 'var(--team-tint-home)' : 'var(--team-tint-away)',
    starters: starters.map(attach),
    bench: bench.map(attach),
  }
}

function SideCard({ side, showAvatars }: { side: SideData; showAvatars: boolean }) {
  return (
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-4 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="min-w-0 truncate font-semibold text-[var(--text-primary)]">{side.teamName}</h3>
        {side.formation && (
          <span
            className="shrink-0 rounded-full px-3 py-1 font-mono text-sm tabular-nums"
            style={{
              background: `color-mix(in srgb, ${side.tint} 18%, transparent)`,
              color: side.tint,
            }}
          >
            {side.formation}
          </span>
        )}
      </div>

      <PitchBackground>
        <FormationDisplay
          players={side.starters}
          formation={side.formation}
          teamName={side.teamName}
          teamTint={side.tint}
          showAvatars={showAvatars}
        />
      </PitchBackground>

      {side.bench.length > 0 && <SubstitutesBench players={side.bench} />}

      {side.coach && (
        <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <span className="text-xs text-[var(--text-tertiary)]">Coach</span>
          <span className="text-sm font-medium text-[var(--text-primary)]">{side.coach}</span>
        </div>
      )}

      {side.starters.length > 0 && (
        <div className="p-4 max-h-[240px] overflow-y-auto border-t" style={{ borderColor: 'var(--border-color)' }}>
          <p className="text-xs text-[var(--text-tertiary)] mb-2">Starting XI</p>
          <div className="space-y-1">
            {side.starters.map((player, idx) => (
              <div key={`${player.name}-${idx}`} className="flex items-center justify-between gap-2 py-1 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs tabular-nums text-[var(--accent-on-primary)]"
                    style={{ background: side.tint }}
                  >
                    {player.jersey || idx + 1}
                  </span>
                  <span className="truncate text-[var(--text-primary)]">
                    {player.name}
                    {player.captain && (
                      <span className="ml-1 text-[10px] font-bold text-[var(--text-tertiary)]" aria-label="Captain">
                        (C)
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {player.position && (
                    <span className="rounded bg-[var(--muted-bg)] px-2 py-0.5 text-xs text-[var(--text-tertiary)]">
                      {player.position}
                    </span>
                  )}
                  {player.rating != null && <RatingPill value={player.rating} compact />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Lineups tab — two pitches side-by-side on desktop, stacked on mobile.
 * Passes the enriched lineup fields through: formation string, per-player
 * event badges, rating chips, bench with sub-on minutes, captain marker and
 * coach when the feed carries them.
 */
export function LineupsTab({ match }: { match: MatchDetails }) {
  const home = buildSide(match, 'home')
  const away = buildSide(match, 'away')

  if (home.starters.length === 0 && away.starters.length === 0) {
    return (
      <EmptyState
        illustration="searching"
        title="Lineups not announced"
        description="Confirmed lineups usually land around an hour before kickoff."
      />
    )
  }

  // Headshots resolve through provider player ids; without ids the classic
  // tinted jersey circles render instead.
  const showAvatars = match.source === 'espn'

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <SideCard side={home} showAvatars={showAvatars} />
      <SideCard side={away} showAvatars={showAvatars} />
    </div>
  )
}
