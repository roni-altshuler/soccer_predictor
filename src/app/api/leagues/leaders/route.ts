import { NextRequest, NextResponse } from 'next/server'

/**
 * Server-side proxy for ESPN's league leaders endpoints.
 *
 * The league home page used to call
 * `https://site.api.espn.com/.../leaders` straight from the browser, which
 * dies on CORS. This route performs the same fetch (plus the `/statistics`
 * fallback) on the server and returns a normalised scorer list.
 *
 * Query params:
 *   ?league — ESPN league slug, e.g. `eng.1` (required)
 *   ?season — 4-digit season year (optional; ESPN defaults to current)
 */

interface LeaderRow {
  rank: number
  name: string
  team: string
  goals: number
  assists: number | null
  matches: number | null
}

const LEAGUE_SLUG_RE = /^[a-z0-9._-]+$/i
const SEASON_RE = /^\d{4}$/

/* eslint-disable @typescript-eslint/no-explicit-any */

function extractLeaders(leadersData: any): any[] {
  let scorers: any[] = []

  // Path 1: leaders array with categories
  if (Array.isArray(leadersData?.leaders)) {
    const goalsCategory = leadersData.leaders.find(
      (cat: any) =>
        cat.name?.toLowerCase().includes('goal') ||
        cat.displayName?.toLowerCase().includes('goal') ||
        cat.abbreviation?.toLowerCase() === 'g' ||
        cat.name?.toLowerCase() === 'goals',
    )
    if (goalsCategory?.leaders) scorers = goalsCategory.leaders
    if (scorers.length === 0 && leadersData.leaders[0]?.leaders) {
      scorers = leadersData.leaders[0].leaders
    }
  }

  // Path 2: categories at the root
  if (scorers.length === 0 && leadersData?.categories) {
    const goalsCategory = leadersData.categories.find(
      (cat: any) =>
        cat.name?.toLowerCase().includes('goal') ||
        cat.displayName?.toLowerCase().includes('goal') ||
        cat.abbreviation?.toLowerCase() === 'g',
    )
    if (goalsCategory?.leaders) scorers = goalsCategory.leaders
    if (scorers.length === 0 && leadersData.categories[0]?.leaders) {
      scorers = leadersData.categories[0].leaders
    }
  }

  // Path 3: direct athletes array
  if (scorers.length === 0 && leadersData?.athletes) scorers = leadersData.athletes

  // Path 4: root-level array
  if (scorers.length === 0 && Array.isArray(leadersData)) scorers = leadersData

  // Path 5: nested sports structure
  if (scorers.length === 0 && leadersData?.sports?.[0]?.leagues?.[0]?.athletes) {
    scorers = leadersData.sports[0].leagues[0].athletes
  }

  return scorers
}

function normaliseLeader(leader: any, idx: number): LeaderRow {
  // e.g. shortDisplayValue "M: 35, G: 27: A: 8" — matches + assists ride
  // along in the display string on the statistics endpoint.
  const short = String(leader.shortDisplayValue ?? leader.displayValue ?? '')
  const matchesFromDisplay = short.match(/M(?:atches)?:\s*(\d+)/i)?.[1]
  const assistsFromDisplay = short.match(/A(?:ssists)?:\s*(\d+)/i)?.[1]

  const assistsRaw =
    leader.assists ?? leader.statistics?.assists ?? assistsFromDisplay
  const matchesRaw =
    leader.athlete?.statistics?.gamesPlayed ??
    leader.gamesPlayed ??
    leader.statistics?.gamesPlayed ??
    matchesFromDisplay

  return {
    rank: idx + 1,
    name:
      leader.athlete?.displayName ||
      leader.athlete?.fullName ||
      leader.displayName ||
      leader.name ||
      leader.fullName ||
      'Unknown',
    team:
      leader.athlete?.team?.displayName ||
      leader.team?.displayName ||
      leader.team?.name ||
      leader.teamName ||
      '',
    goals: parseInt(String(leader.value ?? leader.stat ?? leader.goals ?? leader.statistics?.goals ?? '0'), 10) || 0,
    assists: assistsRaw != null ? parseInt(String(assistsRaw), 10) || 0 : null,
    matches: matchesRaw != null ? parseInt(String(matchesRaw), 10) || null : null,
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

export async function GET(request: NextRequest) {
  const league = request.nextUrl.searchParams.get('league') ?? ''
  const season = request.nextUrl.searchParams.get('season') ?? ''

  if (!league || !LEAGUE_SLUG_RE.test(league)) {
    return NextResponse.json({ error: 'Invalid league slug' }, { status: 400 })
  }
  const seasonParam = SEASON_RE.test(season) ? `?season=${season}` : ''
  const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}`

  // Primary: the leaders endpoint.
  try {
    const res = await fetch(`${base}/leaders${seasonParam}`, {
      next: { revalidate: 3600 },
    })
    if (res.ok) {
      const data = await res.json()
      const scorers = extractLeaders(data)
      if (scorers.length > 0) {
        return NextResponse.json({
          source: 'espn_leaders',
          scorers: scorers.slice(0, 10).map(normaliseLeader),
        })
      }
    }
  } catch {
    // Fall through to the statistics endpoint.
  }

  // Fallback: the statistics endpoint occasionally has leaders when the
  // dedicated endpoint is empty.
  try {
    const res = await fetch(`${base}/statistics${seasonParam}`, {
      next: { revalidate: 3600 },
    })
    if (res.ok) {
      const data = await res.json()
      // Shape A (current): { stats: [{ name: 'goalsLeaders', leaders: [...] }] }
      const statsList = Array.isArray(data?.stats) ? data.stats : []
      const goalsCategory = statsList.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) =>
          s?.name?.toLowerCase().includes('goal') ||
          s?.abbreviation?.toLowerCase() === 'g',
      )
      // Shape B (legacy): { leaders: { categories: [...] } } / { categories: [...] }
      const leaders =
        goalsCategory?.leaders ||
        data.leaders?.categories?.[0]?.leaders ||
        data.categories?.[0]?.leaders ||
        []
      if (leaders.length > 0) {
        return NextResponse.json({
          source: 'espn_statistics',
          scorers: leaders.slice(0, 10).map(normaliseLeader),
        })
      }
    }
  } catch {
    // No provider data — return an honest empty payload.
  }

  return NextResponse.json({ source: 'none', scorers: [] })
}
