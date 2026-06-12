/**
 * Server-side ESPN athlete fetch + normalization.
 *
 * Mirrors backend/api/v1/teams.py player routes so player pages work on
 * Vercel deployments where the FastAPI backend isn't running. ESPN's
 * overview payload has no minutes/xG/xA/ratings — those fields are
 * deliberately omitted rather than fabricated (data-provenance rule).
 */

import type { PlayerMatchLogEntry, PlayerProfile, PlayerStats } from '@/lib/api'

const CORE_ATHLETE_URL = (slug: string, id: string) =>
  `https://sports.core.api.espn.com/v2/sports/soccer/leagues/${slug}/athletes/${id}`
const ATHLETE_OVERVIEW_URL = (slug: string, id: string) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/soccer/${slug}/athletes/${id}/overview`
const TEAM_REF_URL = (id: number) =>
  `https://sports.core.api.espn.com/v2/sports/soccer/teams/${id}`

// The slug in athlete URLs is non-binding (any valid slug resolves any
// athlete id), so gendered defaults are just a sensible routing hint.
const GENDER_DEFAULT_SLUGS: Record<string, string> = { M: 'eng.1', F: 'eng.w.1' }

export function playerSlug(gender?: string | null): string {
  return GENDER_DEFAULT_SLUGS[(gender || 'M').toUpperCase()] ?? 'eng.1'
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 300 } })
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function extractRefId(ref: unknown): number | null {
  const refUrl = typeof ref === 'string' ? ref : (asRecord(ref)?.$ref as string | undefined)
  if (typeof refUrl !== 'string') return null
  const tail = refUrl.split('?')[0].replace(/\/$/, '').split('/').pop() ?? ''
  return /^\d+$/.test(tail) ? Number(tail) : null
}

function statValue(names: unknown[], stats: unknown[], name: string): number | undefined {
  const index = names.indexOf(name)
  if (index < 0 || index >= stats.length) return undefined
  const parsed = Number.parseFloat(String(stats[index]))
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined
}

export async function fetchPlayerProfile(
  playerId: number,
  slug: string,
): Promise<PlayerProfile | null> {
  const athlete = await fetchJson(CORE_ATHLETE_URL(slug, String(playerId)))
  const name = (athlete?.displayName ?? athlete?.fullName) as string | undefined
  if (!athlete || !name) return null

  const profile: PlayerProfile = { id: playerId, name }

  const position = asRecord(athlete.position)
  const positionName = (position?.displayName ?? position?.name) as string | undefined
  if (positionName) profile.position = positionName

  const jersey = String(athlete.jersey ?? '')
  if (/^\d+$/.test(jersey)) profile.shirtNumber = Number(jersey)

  if (typeof athlete.citizenship === 'string' && athlete.citizenship) {
    profile.nationality = athlete.citizenship
  }
  if (typeof athlete.age === 'number') profile.age = athlete.age
  if (typeof athlete.height === 'number' && athlete.height > 0) {
    profile.height = Math.round(athlete.height * 2.54) // ESPN sends inches
  }
  const headshot = asRecord(athlete.headshot)
  if (typeof headshot?.href === 'string') profile.imageUrl = headshot.href

  const teamId = extractRefId(athlete.defaultTeam ?? athlete.team)
  if (teamId !== null) {
    profile.teamId = teamId
    const team = await fetchJson(TEAM_REF_URL(teamId))
    if (typeof team?.displayName === 'string') profile.teamName = team.displayName
    if (typeof team?.color === 'string' && team.color) profile.teamColor = `#${team.color}`
  }

  return profile
}

export async function fetchPlayerStats(
  playerId: number,
  slug: string,
): Promise<PlayerStats | null> {
  const overview = await fetchJson(ATHLETE_OVERVIEW_URL(slug, String(playerId)))
  if (!overview) return null

  const result: PlayerStats = { player_id: playerId, season: '' }

  // Season splits: pick the primary competition (most starts).
  const statistics = asRecord(overview.statistics)
  const names = Array.isArray(statistics?.names) ? statistics.names : []
  const splits = Array.isArray(statistics?.splits) ? statistics.splits : []
  let primary: Record<string, unknown> | null = null
  let primaryStarts = -1
  for (const rawSplit of splits) {
    const split = asRecord(rawSplit)
    if (!split) continue
    const stats = Array.isArray(split.stats) ? split.stats : []
    const starts = statValue(names, stats, 'starts') ?? 0
    if (starts > primaryStarts) {
      primary = split
      primaryStarts = starts
    }
  }
  if (primary) {
    const stats = Array.isArray(primary.stats) ? primary.stats : []
    const seasonName = typeof primary.displayName === 'string' ? primary.displayName : ''
    result.season = seasonName
    result.competition = seasonName
    const mapping: Array<
      [
        'starts' | 'goals' | 'assists' | 'shots' | 'shotsOnTarget' | 'yellowCards' | 'redCards',
        string,
      ]
    > = [
      ['starts', 'starts'],
      ['goals', 'totalGoals'],
      ['assists', 'goalAssists'],
      ['shots', 'totalShots'],
      ['shotsOnTarget', 'shotsOnTarget'],
      ['yellowCards', 'yellowCards'],
      ['redCards', 'redCards'],
    ]
    for (const [outKey, espnName] of mapping) {
      const value = statValue(names, stats, espnName)
      if (value !== undefined) {
        result[outKey] = value
      }
    }
  }

  // Recent match log: join gameLog.events with its per-event stats.
  const gameLog = asRecord(overview.gameLog)
  const events = asRecord(gameLog?.events) ?? {}
  const perEventStats = new Map<string, { goals?: number; assists?: number }>()
  const statBlocks = Array.isArray(gameLog?.statistics) ? gameLog.statistics : []
  for (const rawBlock of statBlocks) {
    const block = asRecord(rawBlock)
    if (!block) continue
    const blockNames = Array.isArray(block.names) ? block.names : []
    const blockEvents = Array.isArray(block.events) ? block.events : []
    for (const rawEntry of blockEvents) {
      const entry = asRecord(rawEntry)
      if (!entry) continue
      const eventId = String(entry.eventId ?? '')
      const stats = Array.isArray(entry.stats) ? entry.stats : []
      if (eventId) {
        perEventStats.set(eventId, {
          goals: statValue(blockNames, stats, 'totalGoals'),
          assists: statValue(blockNames, stats, 'goalAssists'),
        })
      }
    }
  }

  const matches: PlayerMatchLogEntry[] = []
  for (const [eventId, rawEvent] of Object.entries(events)) {
    const event = asRecord(rawEvent)
    if (!event || typeof event.gameDate !== 'string') continue
    const opponent = asRecord(event.opponent)
    const entry: PlayerMatchLogEntry = {
      id: eventId,
      date: event.gameDate,
      opponent: {
        id: typeof opponent?.id === 'string' ? opponent.id : undefined,
        name:
          (typeof opponent?.displayName === 'string' && opponent.displayName) ||
          (typeof opponent?.abbreviation === 'string' && opponent.abbreviation) ||
          '',
      },
      score: typeof event.score === 'string' ? event.score : undefined,
      result:
        event.gameResult === 'W' || event.gameResult === 'D' || event.gameResult === 'L'
          ? event.gameResult
          : undefined,
      isHome: event.atVs === 'vs',
    }
    const joined = perEventStats.get(eventId)
    if (joined?.goals !== undefined) entry.goals = joined.goals
    if (joined?.assists !== undefined) entry.assists = joined.assists
    matches.push(entry)
  }
  matches.sort((a, b) => (a.date < b.date ? 1 : -1))
  result.matches = matches.slice(0, 10)

  return result
}
