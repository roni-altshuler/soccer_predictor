import { NextRequest, NextResponse } from 'next/server'

import { ESPN_V2 } from '@/lib/espnHost'
import { ALL_COMPETITION_IDS } from '@/lib/leagueAccents'

/**
 * The table for any competition the site covers, in any season it has one.
 *
 * Why a new route rather than `/api/standings`: that one takes a slug
 * (`premier_league`), flattens ESPN's `children` into a single list, and
 * carries a women's universe plus simulation fields. Flattening is exactly
 * what a tournament cannot survive — the Champions League league phase, a
 * World Cup group stage and MLS's two conferences are all `children`, and a
 * table that concatenates them is not a table of anything.
 *
 * Groups are preserved. A league comes back as one group and renders
 * identically; nothing needs to know which kind of competition it asked for.
 *
 * SEASONS ARE NEVER IN THE FUTURE. ESPN lists 2026-27 for the Premier League
 * with `hasStandings: true` months before a ball is kicked, and it answers
 * with twenty rows of zeroes. A season is offered here only if it has started,
 * so the explorer cannot walk forward into an empty table that looks like a
 * real one.
 */
export const dynamic = 'force-dynamic'

const COMPETITIONS = new Set<string>(ALL_COMPETITION_IDS)

// The forecast layer's spelling for the Conference League; ESPN's own is
// `uefa.europa.conf`. Same competition, two vocabularies — see leagueAccents.
const ESPN_ID: Record<string, string> = {
  'uefa.conference': 'uefa.europa.conf',
}

interface TeamRow {
  rank: number
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  /** ESPN's own qualification note, e.g. "Qualifies for round of 16". */
  note: string | null
  /** The colour ESPN attaches to that note, used to draw the band. */
  noteColor: string | null
}

interface Group {
  name: string
  teams: TeamRow[]
}

function stat(entry: Record<string, unknown>, name: string): number {
  const stats = (entry.stats as Array<Record<string, unknown>>) || []
  const found = stats.find((s) => s.name === name)
  const raw = found?.value
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0'))
  return Number.isFinite(n) ? n : 0
}

function toRow(entry: Record<string, unknown>, index: number): TeamRow {
  const team = (entry.team as Record<string, unknown>) || {}
  const note = (entry.note as Record<string, unknown>) || null
  // ESPN's `rank` is authoritative where it exists — it already applies the
  // competition's own tiebreakers, which are not the same in every league
  // (head-to-head in Serie A, goal difference in the Premier League). Deriving
  // a rank by re-sorting would quietly disagree with the official table.
  const rank = stat(entry, 'rank')
  return {
    rank: rank > 0 ? rank : index + 1,
    team: String(team.displayName || team.name || 'Unknown'),
    played: stat(entry, 'gamesPlayed'),
    won: stat(entry, 'wins'),
    drawn: stat(entry, 'ties'),
    lost: stat(entry, 'losses'),
    goalsFor: stat(entry, 'pointsFor'),
    goalsAgainst: stat(entry, 'pointsAgainst'),
    goalDifference: stat(entry, 'pointDifferential'),
    points: stat(entry, 'points'),
    note: note ? String(note.description || '') || null : null,
    noteColor: note && note.color ? `#${String(note.color).replace(/^#/, '')}` : null,
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const competition = params.get('competition') || 'eng.1'
  const seasonParam = params.get('season')

  if (!COMPETITIONS.has(competition)) {
    return NextResponse.json(
      { available: false, reason: `${competition} is not a competition this site covers` },
      { status: 200 },
    )
  }

  const espnId = ESPN_ID[competition] ?? competition
  const url = `${ESPN_V2}/${espnId}/standings${seasonParam ? `?season=${seasonParam}` : ''}`

  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      return NextResponse.json(
        { available: false, reason: `the standings provider answered ${res.status}` },
        { status: 200 },
      )
    }
    const data = await res.json()

    const groups: Group[] = ((data.children as Array<Record<string, unknown>>) || [])
      .map((child) => {
        const standings = (child.standings as Record<string, unknown>) || {}
        const entries = (standings.entries as Array<Record<string, unknown>>) || []
        return {
          name: String(child.name || ''),
          teams: entries.map(toRow).sort((a, b) => a.rank - b.rank),
        }
      })
      .filter((g) => g.teams.length > 0)

    const now = Date.now()
    const seasons = ((data.seasons as Array<Record<string, unknown>>) || [])
      .filter((s) => {
        // Started, not merely listed. See the note at the top of this file.
        const start = Date.parse(String(s.startDate || ''))
        return Number.isFinite(start) && start <= now
      })
      .map((s) => ({
        year: Number(s.year),
        label: String(s.seasonYears || s.year),
      }))
      .filter((s) => Number.isFinite(s.year))
      .sort((a, b) => b.year - a.year)

    const season = (data.season as Record<string, unknown>) || {}

    return NextResponse.json({
      available: groups.length > 0,
      reason: groups.length ? undefined : 'this season has no table yet',
      competition,
      name: String(data.name || competition),
      season: Number(season.year) || (seasonParam ? Number(seasonParam) : null),
      seasonLabel: String(season.displayName || ''),
      seasons,
      groups,
    })
  } catch {
    return NextResponse.json(
      { available: false, reason: 'the standings provider could not be reached' },
      { status: 200 },
    )
  }
}
