/** Bounded observed MLS regular-season record. Forecast rows keep their own schema. */
export interface ObservedSeasonClub {
  team: string
  team_id: string
  group: string
  position: number
  played: number
  wins: number
  draws: number
  losses: number
  points: number
  gf: number
  ga: number
  gd: number
  qualified: boolean
}

export interface CompletedRegularSeason {
  competitionId: 'usa.1'
  season: 2026
  clubs: ObservedSeasonClub[]
  groups: Array<{ name: string; short: string; teams: number; qualify: number }>
  generatedAt: string | null
  observation: {
    source: 'espn'
    scope: 'regular-season'
    season_type: 1
    observed_at: string
    proof_checked_at: string
    latest_result_kickoff_at: string
    results_through: string
    matches_reconciled: 510
    schedule_fixtures: 510
    schedule_last_verified_at: string
    endpoint: string
  }
}

export type CompletedSeasonRead =
  | { kind: 'outside_scope' | 'active' | 'unavailable' }
  | { kind: 'completed'; season: CompletedRegularSeason }

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
const integer = (value: unknown, min = 0): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min
const calendarDate = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const timestamp = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) && calendarDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24
const endpoint = 'https://site.web.api.espn.com/apis/v2/sports/soccer/usa.1/standings?season=2026'
const rankFields = ['points', 'wins', 'gd', 'gf'] as const
const conferences = [
  { name: 'Eastern Conference', short: 'Eastern', teams: 15, qualify: 9 },
  { name: 'Western Conference', short: 'Western', teams: 15, qualify: 9 },
]

/** Validate once at the artifact boundary. Never infer completion from zero fixtures alone. */
export function readCompletedRegularSeason(
  artifact: unknown,
  context: { competitionId: string; season: number; gender: string; now?: Date },
): CompletedSeasonRead {
  if (!['usa.1', 'mls'].includes(context.competitionId) || context.gender !== 'M' || context.season !== 2026) {
    return { kind: 'outside_scope' }
  }
  const root = record(artifact)
  if (!root || root.available === false || !Array.isArray(root.leagues)) return { kind: 'unavailable' }
  const matches = root.leagues.map(record).filter((league) => league?.competition_id === 'usa.1')
  if (matches.length !== 1) return { kind: 'unavailable' }
  const league = matches[0]!
  // Existing active/legacy records continue through the existing forecast reader.
  if (league.state === undefined && league.observed_table === undefined && league.observation === undefined) return { kind: 'active' }
  if (league.state !== 'regular_season_completed' || league.season !== 2026 || league.fixtures_remaining !== 0 ||
    league.teams !== 30 || league.relegation_places !== 0 || league.schedule_completeness !== null ||
    !Array.isArray(league.table) || league.table.length !== 0 ||
    !Array.isArray(league.observed_table) || league.observed_table.length !== 30 ||
    !Array.isArray(league.groups) || league.groups.length !== 2) return { kind: 'unavailable' }
  for (const expected of conferences) {
    const groups = league.groups.map(record).filter((group) => group?.name === expected.name)
    if (groups.length !== 1 || Object.entries(expected).some(([key, value]) => groups[0]?.[key] !== value)) return { kind: 'unavailable' }
  }
  const observation = record(league.observation)
  const now = (context.now ?? new Date()).getTime()
  if (!observation || observation.source !== 'espn' || observation.scope !== 'regular-season' ||
    observation.season_type !== 1 || observation.endpoint !== endpoint || observation.matches_reconciled !== 510 ||
    observation.schedule_fixtures !== 510 || !timestamp(root.generated_at) || Date.parse(root.generated_at) > now ||
    !timestamp(observation.observed_at) || Date.parse(observation.observed_at) < Date.parse('2026-11-08T00:00:00Z') ||
    Date.parse(observation.observed_at) > Date.parse(root.generated_at) ||
    !timestamp(observation.proof_checked_at) ||
    Date.parse(observation.proof_checked_at) < Date.parse(observation.observed_at) ||
    Date.parse(observation.proof_checked_at) > Date.parse(root.generated_at) ||
    Date.parse(observation.proof_checked_at) > now ||
    !timestamp(observation.latest_result_kickoff_at) ||
    !['2026-11-07', '2026-11-08'].includes(new Date(observation.latest_result_kickoff_at).toISOString().slice(0, 10)) ||
    Date.parse(observation.latest_result_kickoff_at) > Date.parse(observation.observed_at) ||
    Date.parse(observation.latest_result_kickoff_at) > Date.parse(observation.proof_checked_at) ||
    Date.parse(observation.latest_result_kickoff_at) > now ||
    !timestamp(observation.schedule_last_verified_at) || Date.parse(observation.observed_at) > now ||
    Date.parse(observation.schedule_last_verified_at) > now ||
    Date.parse(observation.schedule_last_verified_at) > Date.parse(root.generated_at) ||
    typeof observation.results_through !== 'string' || !['2026-11-07', '2026-11-08'].includes(observation.results_through) ||
    !Number.isFinite(Date.parse(observation.results_through)) ||
    new Date(observation.results_through).toISOString().slice(0, 10) !== observation.results_through ||
    observation.results_through > new Date(observation.observed_at).toISOString().slice(0, 10)) return { kind: 'unavailable' }
  const clubs: ObservedSeasonClub[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  const positions = new Set<string>()
  for (const raw of league.observed_table) {
    const row = record(raw)
    if (!row || typeof row.team !== 'string' || !row.team.trim() || row.team !== row.team.trim() ||
      typeof row.team_id !== 'string' || !/^[1-9][0-9]*$/.test(row.team_id) ||
      !conferences.some((group) => group.name === row.group) || !integer(row.position, 1) || row.position > 15 ||
      row.played !== 34 || !['wins', 'draws', 'losses', 'points', 'gf', 'ga'].every((key) => integer(row[key])) ||
      !integer(row.gd, -10000) || row.gd !== (row.gf as number) - (row.ga as number) ||
      (row.wins as number) + (row.draws as number) + (row.losses as number) !== 34 ||
      row.points !== (row.wins as number) * 3 + (row.draws as number) ||
      row.qualified !== (row.position <= 9) || Object.keys(row).some((key) => /^(p_|exp_)/.test(key))) return { kind: 'unavailable' }
    const normalizedName = row.team.toLowerCase()
    const position = `${row.group}:${row.position}`
    if (ids.has(row.team_id) || names.has(normalizedName) || positions.has(position)) return { kind: 'unavailable' }
    ids.add(row.team_id); names.add(normalizedName); positions.add(position)
    clubs.push(row as unknown as ObservedSeasonClub)
  }
  // Check the supplied conference positions against the known tiebreak prefix.
  // Equal prefixes retain the provider's position; fair-play data is not inferred.
  for (const group of conferences) {
    const members = clubs.filter((club) => club.group === group.name).sort((a, b) => a.position - b.position)
    for (let index = 1; index < members.length; index++) {
      const previous = members[index - 1]
      const current = members[index]
      const different = rankFields.find((field) => previous[field] !== current[field])
      if (different && previous[different] < current[different]) return { kind: 'unavailable' }
    }
  }
  const sum = (field: 'wins' | 'losses' | 'draws' | 'gf' | 'ga') => clubs.reduce((total, club) => total + club[field], 0)
  if (sum('wins') !== sum('losses') || sum('draws') % 2 !== 0 || sum('gf') !== sum('ga')) return { kind: 'unavailable' }
  return { kind: 'completed', season: {
    competitionId: 'usa.1', season: 2026, clubs, groups: conferences.map((group) => ({ ...group })),
    generatedAt: root.generated_at,
    observation: observation as unknown as CompletedRegularSeason['observation'],
  } }
}
