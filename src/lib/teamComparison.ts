/** A read view of the existing season artifact; no new model or provider. */
export type ComparisonClub = {
  team: string
  played: number | null
  points: number | null
  projectedPoints: number | null
}

export type ComparisonSnapshot = {
  season: number
  generatedAt: string | null
  clubs: ComparisonClub[]
  excluded: number
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** Keep missing metrics missing. Duplicate names have no safe identity here. */
export function comparisonFromArtifact(artifact: unknown, competition: string): ComparisonSnapshot | null {
  const root = record(artifact)
  if (!root || root.available === false || !Array.isArray(root.leagues)) return null
  const leagues = root.leagues.map(record).filter((l) => l?.competition_id === competition)
  if (leagues.length !== 1) return null
  const league = leagues[0]!
  if (typeof league.season !== 'number' || !Number.isInteger(league.season) ||
    league.season < 1900 || league.season > 2200 || !Array.isArray(league.table)) return null
  const rows = league.table.map(record)
  const names = rows.map((r) => typeof r?.team === 'string' ? r.team.trim().toLowerCase() : '')
  const counts = new Map<string, number>()
  names.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1))
  const clubs: ComparisonClub[] = []
  rows.forEach((row, i) => {
    if (!row || !names[i] || counts.get(names[i]) !== 1) return
    const rawPlayed = number(row.played)
    const played = rawPlayed !== null && Number.isInteger(rawPlayed) && rawPlayed >= 0 ? rawPlayed : null
    const rawPoints = number(row.points)
    // Negative points can be a deduction; strings/nulls are never coerced to zero.
    const points = rawPoints !== null && Number.isInteger(rawPoints) &&
      (played === null || rawPoints <= played * 3) ? rawPoints : null
    const projected = number(row.exp_points)
    clubs.push({ team: (row.team as string).trim(), played, points,
      projectedPoints: projected !== null && (points === null || projected >= points) ? projected : null })
  })
  const generatedAt = typeof root.generated_at === 'string' && !Number.isNaN(Date.parse(root.generated_at))
    ? root.generated_at : null
  return { season: league.season, generatedAt, clubs: clubs.sort((a, b) => a.team.localeCompare(b.team)),
    excluded: rows.length - clubs.length }
}

export function pointsPerGame(club: ComparisonClub): number | null {
  return club.points !== null && club.played !== null && club.played > 0 ? club.points / club.played : null
}

/** Switching onto the other selected club swaps the pair; never compare itself. */
export function changeComparison(pair: [string, string], side: 0 | 1, team: string): [string, string] {
  if (pair[1 - side] === team) return [pair[1], pair[0]]
  return side === 0 ? [team, pair[1]] : [pair[0], team]
}
