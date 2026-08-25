import { ESPN_SITE } from '@/lib/espnHost'
/**
 * Server-side ESPN team-overview fetch + normalization.
 *
 * Mirrors the payload shape of FastAPI's GET /api/v1/teams/{id}/overview so
 * team pages work on Vercel where the Python backend isn't deployed.
 * Injuries are returned empty here — ESPN's public soccer API never
 * populates them; the FastAPI route layers in the InjuryTracker scrape
 * locally. Absent provider data stays absent (no placeholders).
 */

const TEAM_META_URL = (teamId: string) =>
  `${ESPN_SITE}/all/teams/${teamId}`
const TEAM_SCHEDULE_URL = (slug: string, teamId: string) =>
  `${ESPN_SITE}/${slug}/teams/${teamId}/schedule`
const TEAM_ROSTER_URL = (slug: string, teamId: string) =>
  `${ESPN_SITE}/${slug}/teams/${teamId}/roster`

type Json = Record<string, unknown>

async function fetchJson(url: string): Promise<Json | null> {
  try {
    // One hour: team meta, schedule and roster barely move, and every expiry
    // is an ISR write per URL per team — quota is the binding constraint.
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) return null
    return (await res.json()) as Json
  } catch {
    return null
  }
}

function asRecord(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordStat(record: Json | null, name: string): number {
  const items = asArray(record?.items)
  const total = asRecord(items.find((item) => asRecord(item)?.type === 'total') ?? items[0])
  for (const rawStat of asArray(total?.stats)) {
    const stat = asRecord(rawStat)
    if (stat?.name === name && typeof stat.value === 'number') return Math.trunc(stat.value)
  }
  return 0
}

function positionFromSummary(summary: unknown): number {
  // e.g. "5th in English Premier League"
  if (typeof summary !== 'string') return 0
  const match = summary.match(/^(\d+)(st|nd|rd|th)\b/)
  return match ? Number(match[1]) : 0
}

interface OverviewMatch {
  match_id: string
  kickoff: unknown
  venue: unknown
  is_home: boolean
  opponent: { id: string; name: string }
  self_score: number | null
  opponent_score: number | null
  status: string
  status_detail: unknown
  completed: boolean
}

function transformEvent(rawEvent: unknown, teamId: string): OverviewMatch | null {
  const event = asRecord(rawEvent)
  if (!event) return null
  const comp = asRecord(asArray(event.competitions)[0]) ?? {}
  const competitors = asArray(comp.competitors).map(asRecord)
  const home = competitors.find((c) => c?.homeAway === 'home') ?? null
  const away = competitors.find((c) => c?.homeAway === 'away') ?? null
  const homeTeam = asRecord(home?.team)
  const isHome = String(homeTeam?.id ?? '') === String(teamId)
  const selfSide = isHome ? home : away
  const oppSide = isHome ? away : home
  const oppTeam = asRecord(oppSide?.team)
  const status = asRecord(asRecord(event.status)?.type) ?? {}

  const score = (side: Json | null): number | null => {
    const raw = side?.score
    // Schedule endpoints wrap scores as {value, displayValue}; scoreboard uses strings.
    const value = asRecord(raw)?.value ?? raw
    const parsed = Number.parseFloat(String(value))
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null
  }

  return {
    match_id: String(event.id ?? ''),
    kickoff: event.date,
    venue: asRecord(comp.venue)?.fullName,
    is_home: isHome,
    opponent: {
      id: String(oppTeam?.id ?? ''),
      name: (oppTeam?.displayName as string) || '',
    },
    self_score: score(selfSide),
    opponent_score: score(oppSide),
    status: (status.state as string) || 'pre',
    status_detail: status.detail,
    completed: Boolean(status.completed),
  }
}

function buildFormString(recent: OverviewMatch[]): string {
  const form: string[] = []
  for (const match of recent) {
    if (!match.completed || match.self_score === null || match.opponent_score === null) continue
    form.push(match.self_score > match.opponent_score ? 'W' : match.self_score < match.opponent_score ? 'L' : 'D')
    if (form.length >= 5) break
  }
  return form.join('')
}

function transformRosterPlayer(rawPlayer: unknown): Json | null {
  const player = asRecord(rawPlayer)
  if (!player) return null
  const position = asRecord(player.position)
  const name = (player.displayName ?? player.fullName) as string | undefined
  if (!name) return null
  const jersey = Number.parseInt(String(player.jersey ?? ''), 10)
  return {
    player_id: String(player.id ?? ''),
    name,
    position: (position?.abbreviation ?? position?.name ?? '') as string,
    number: Number.isFinite(jersey) ? jersey : null,
    nationality:
      (player.citizenship as string) || ((asRecord(player.birthPlace)?.country as string) ?? ''),
  }
}

export async function fetchTeamOverview(teamId: string): Promise<Json | null> {
  const metaPayload = await fetchJson(TEAM_META_URL(teamId))
  const team = asRecord(metaPayload?.team)
  if (!team || !team.displayName) return null

  const league = asRecord(team.defaultLeague)
  const slug = typeof league?.slug === 'string' ? league.slug : null

  const [schedulePayload, rosterPayload] = slug
    ? await Promise.all([
        fetchJson(TEAM_SCHEDULE_URL(slug, teamId)),
        fetchJson(TEAM_ROSTER_URL(slug, teamId)),
      ])
    : [null, null]

  const events = asArray(schedulePayload?.events)
    .map((event) => transformEvent(event, teamId))
    .filter((match): match is OverviewMatch => match !== null)
  const completed = events.filter((m) => m.completed)
  const upcoming = events.filter((m) => !m.completed)
  completed.sort((a, b) => String(b.kickoff ?? '').localeCompare(String(a.kickoff ?? '')))
  upcoming.sort((a, b) => String(a.kickoff ?? '').localeCompare(String(b.kickoff ?? '')))
  const recentResults = completed.slice(0, 5)
  const upcomingFixtures = upcoming.slice(0, 5)

  // Roster nests athletes either flat or grouped by position.
  const athletes = asArray(rosterPayload?.athletes)
  const flatAthletes =
    athletes.length > 0 && asRecord(athletes[0])?.items !== undefined
      ? athletes.flatMap((group) => asArray(asRecord(group)?.items))
      : athletes
  const squad = flatAthletes
    .map(transformRosterPlayer)
    .filter((player): player is Json => player !== null)

  const record = asRecord(team.record)
  const played = recordStat(record, 'gamesPlayed')
  const goalsFor = recordStat(record, 'pointsFor')
  const goalsAgainst = recordStat(record, 'pointsAgainst')

  const logos = asArray(team.logos)
  return {
    team: {
      id: String(teamId),
      name: team.displayName,
      abbreviation: team.abbreviation ?? '',
      logo: asRecord(logos[0])?.href ?? null,
      venue: null, // not exposed by the soccer/all team endpoint
      color: typeof team.color === 'string' && team.color ? `#${team.color}` : null,
      founded: null,
    },
    league: {
      id: slug,
      name: (league?.name as string) ?? '',
      season: null,
    },
    standing: {
      position: positionFromSummary(team.standingSummary),
      played,
      won: recordStat(record, 'wins'),
      drawn: recordStat(record, 'ties'),
      lost: recordStat(record, 'losses'),
      gf: goalsFor,
      ga: goalsAgainst,
      points: recordStat(record, 'points'),
      form_string: buildFormString(recentResults),
    },
    next_fixture: upcomingFixtures[0] ?? null,
    recent_results: recentResults,
    upcoming_fixtures: upcomingFixtures,
    squad,
    stats: {
      goals_per_match: played ? Math.round((goalsFor / played) * 100) / 100 : 0,
      conceded_per_match: played ? Math.round((goalsAgainst / played) * 100) / 100 : 0,
      clean_sheets: null,
      possession_avg: null,
    },
    injuries: [], // ESPN's public soccer API has no injury data; FastAPI adds InjuryTracker results locally
    generated_at: new Date().toISOString(),
  }
}
