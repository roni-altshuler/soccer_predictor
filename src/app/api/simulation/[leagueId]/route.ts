import { NextRequest, NextResponse } from 'next/server'

import { getLeagueAccent } from '@/lib/leagueAccents'
import {
  logProbabilityAnomaly,
  logSimulationRun,
} from '@/lib/observability/simulationLogger'
import { PROBABILITY_SUM_TOLERANCE } from '@/lib/probabilityValidation'
import {
  runMonteCarloSimulation,
  type SimulationFixture,
  type Standing,
  type TeamData,
  type WhatIfOutcome,
} from '@/lib/simulation/leagueMonteCarlo'

/**
 * Audit the standings array for the well-known probability invariants:
 *   - Σ title_probability  ≈ 1
 *   - Σ top_4_probability  ≈ 4
 *   - Σ relegation_probability ≈ 3
 *   - every probability is finite and non-negative
 *
 * Anomalies are reported via the observability sink. Outputs are NOT
 * modified — this is purely an audit, not a corrector.
 */
function auditProbabilities(standings: Standing[], leagueId: number): void {
  if (standings.length === 0) return

  const sumTitle = standings.reduce((s, row) => s + row.title_probability, 0)
  const sumTop4 = standings.reduce((s, row) => s + row.top_4_probability, 0)
  const sumRel = standings.reduce((s, row) => s + row.relegation_probability, 0)

  const tolTitle = PROBABILITY_SUM_TOLERANCE          // 1.0 ± 0.01
  const tolSlots = 0.05                                // wider for 4-slot/3-slot sums

  if (Math.abs(sumTitle - 1) > tolTitle) {
    logProbabilityAnomaly({
      source: 'monte_carlo_title_probabilities',
      reason: 'sum_off_tolerance',
      details: { leagueId, sum: sumTitle, expected: 1 },
    })
  }
  if (Math.abs(sumTop4 - 4) > tolSlots) {
    logProbabilityAnomaly({
      source: 'monte_carlo_top4_probabilities',
      reason: 'sum_off_tolerance',
      details: { leagueId, sum: sumTop4, expected: 4 },
    })
  }
  if (Math.abs(sumRel - 3) > tolSlots) {
    logProbabilityAnomaly({
      source: 'monte_carlo_relegation_probabilities',
      reason: 'sum_off_tolerance',
      details: { leagueId, sum: sumRel, expected: 3 },
    })
  }

  for (const row of standings) {
    const fields: Array<[string, number]> = [
      ['title_probability', row.title_probability],
      ['top_4_probability', row.top_4_probability],
      ['europa_probability', row.europa_probability],
      ['relegation_probability', row.relegation_probability],
    ]
    for (const [key, value] of fields) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        logProbabilityAnomaly({
          source: 'monte_carlo_probability_field',
          reason: 'out_of_range_or_nan',
          details: { leagueId, team: row.team_name, field: key, value },
        })
      }
    }
  }
}


function formatESPNDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(football club|fc|afc|cf|sc|club|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function resolveTeamIndex(candidates: string[], lookup: Map<string, number>): number | null {
  for (const candidate of candidates) {
    const normalized = normalizeTeamName(candidate)
    if (lookup.has(normalized)) return lookup.get(normalized) ?? null
  }
  return null
}

async function fetchRemainingFixtures(
  espnLeagueId: string,
  teams: TeamData[],
  leagueId: number,
): Promise<SimulationFixture[]> {
  const lookup = new Map<string, number>()
  teams.forEach((team, idx) => {
    lookup.set(normalizeTeamName(team.name), idx)
  })

  const today = new Date()
  const future = new Date(today)
  future.setDate(future.getDate() + (leagueId === 130 ? 240 : 100))
  const dateRange = `${formatESPNDate(today)}-${formatESPNDate(future)}`

  const response = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeagueId}/scoreboard?dates=${dateRange}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      next: { revalidate: 300 },
    },
  )

  if (!response.ok) return []

  const data = await response.json()
  const fixtures: SimulationFixture[] = []
  const seen = new Set<string>()

  for (const event of data.events || []) {
    const comp = event.competitions?.[0]
    if (!comp) continue

    const statusType = comp.status?.type || event.status?.type || {}
    const statusName = statusType.name || ''
    const isFinished = Boolean(statusType.completed) || statusName.includes('FINAL') || statusName.includes('FULL_TIME')
    const matchDate = new Date(event.date)
    if (isFinished || matchDate < today) continue

    const home = comp.competitors?.find((c: any) => c.homeAway === 'home')
    const away = comp.competitors?.find((c: any) => c.homeAway === 'away')
    if (!home || !away) continue

    const homeIdx = resolveTeamIndex([
      home.team?.displayName,
      home.team?.name,
      home.team?.shortDisplayName,
      home.team?.location,
      home.team?.abbreviation,
    ].filter(Boolean), lookup)
    const awayIdx = resolveTeamIndex([
      away.team?.displayName,
      away.team?.name,
      away.team?.shortDisplayName,
      away.team?.location,
      away.team?.abbreviation,
    ].filter(Boolean), lookup)

    if (homeIdx === null || awayIdx === null || homeIdx === awayIdx) continue

    const key = `${event.id || matchDate.toISOString()}-${homeIdx}-${awayIdx}`
    if (seen.has(key)) continue
    seen.add(key)
    fixtures.push({
      homeIdx,
      awayIdx,
      key,
      homeTeam: teams[homeIdx]?.name,
      awayTeam: teams[awayIdx]?.name,
      date: event.date,
    })
  }

  return fixtures
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId: leagueIdStr } = await params
  const leagueId = parseInt(leagueIdStr, 10)
  // Resolve the league via the single canonical registry. Passing the
  // raw FotMob numeric ID hits the nameAliases map in leagueAccents.ts.
  const accent = getLeagueAccent(String(leagueId))
  const espnLeagueId = accent.competitionId !== 'unknown' ? accent.competitionId : undefined
  const leagueName = accent.displayName !== 'Match' ? accent.displayName : 'Unknown League'

  const searchParams = request.nextUrl.searchParams
  const nSimulations = Math.min(50000, Math.max(100, parseInt(searchParams.get('n_simulations') || '10000', 10)))
  const whatIfFixture = searchParams.get('what_if_fixture') || ''
  const rawWhatIfOutcome = searchParams.get('what_if_outcome')
  const whatIfOutcome: WhatIfOutcome | null =
    rawWhatIfOutcome === 'home' || rawWhatIfOutcome === 'draw' || rawWhatIfOutcome === 'away'
      ? rawWhatIfOutcome
      : null

  if (!espnLeagueId) {
    return NextResponse.json({ error: 'Invalid league ID' }, { status: 400 })
  }

  const totalMatchesPerSeason = accent.matchesPerSeason ?? 38

  try {
    // Fetch current standings from ESPN
    const standingsRes = await fetch(
      `https://site.api.espn.com/apis/v2/sports/soccer/${espnLeagueId}/standings`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        next: { revalidate: 300 },
      }
    )

    if (!standingsRes.ok) {
      throw new Error('Failed to fetch standings from ESPN')
    }

    const standingsData = await standingsRes.json()
    const entries = standingsData.children?.[0]?.standings?.entries || []

    if (entries.length === 0) {
      throw new Error('No standings data available')
    }

    // Parse ESPN standings with full stats
    const teams: TeamData[] = entries.map((entry: any) => {
      const stats = entry.stats || []
      const getStat = (name: string) => stats.find((s: any) => s.name === name)?.value || 0
      return {
        name: entry.team?.displayName || 'Unknown',
        points: getStat('points'),
        wins: getStat('wins'),
        draws: getStat('ties'),
        losses: getStat('losses'),
        gf: getStat('pointsFor'),
        ga: getStat('pointsAgainst'),
        gd: getStat('pointDifferential'),
        matchesPlayed: getStat('gamesPlayed'),
      }
    })

    // Sort by current points (ESPN should already do this, but ensure)
    teams.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      return b.gd - a.gd
    })

    let remainingFixtures: SimulationFixture[] = []
    try {
      remainingFixtures = await fetchRemainingFixtures(espnLeagueId, teams, leagueId)
    } catch {
      remainingFixtures = []
    }

    const availableFixtures = remainingFixtures.length > 0
      ? remainingFixtures
      : []
    const fixtureOverride = whatIfFixture && whatIfOutcome
      ? { fixtureKey: whatIfFixture, outcome: whatIfOutcome }
      : null

    const simStart = Date.now()
    const standings = runMonteCarloSimulation(
      teams,
      totalMatchesPerSeason,
      nSimulations,
      leagueId,
      remainingFixtures,
      fixtureOverride,
    )
    const simDurationMs = Date.now() - simStart

    // Observability — record the run + audit probability invariants.
    // Pure observation; outputs are NOT mutated.
    logSimulationRun({
      leagueId,
      leagueName,
      espnLeagueId,
      nSimulations,
      numTeams: teams.length,
      fixtureSource: remainingFixtures.length > 0 ? 'espn_live' : 'generated_fallback',
      remainingFixtures: remainingFixtures.length,
      durationMs: simDurationMs,
      hasWhatIfOverride: fixtureOverride !== null,
    })
    auditProbabilities(standings, leagueId)

    const generatedRemainingMatches = Math.max(
      0,
      Math.round(teams.reduce((sum, team) => sum + Math.max(0, totalMatchesPerSeason - team.matchesPlayed), 0) / 2),
    )
    const remainingMatches = remainingFixtures.length > 0 ? remainingFixtures.length : generatedRemainingMatches
    const mostLikelyChampion = standings[0]?.team_name || 'Unknown'
    const championProbability = standings[0]?.title_probability || 0

    const sortedByTop4 = [...standings].sort((a, b) => b.top_4_probability - a.top_4_probability)
    const likelyTop4 = sortedByTop4.slice(0, 4).map(t => t.team_name)

    const sortedByRelegation = [...standings].sort((a, b) => b.relegation_probability - a.relegation_probability)
    const relegationCandidates = sortedByRelegation.slice(0, 3).map(t => t.team_name)

    return NextResponse.json({
      league_id: leagueId,
      league_name: leagueName,
      n_simulations: nSimulations,
      remaining_matches: remainingMatches,
      fixture_source: remainingFixtures.length > 0
        ? 'Remaining scheduled fixtures'
        : 'Generated fixture fallback from current standings',
      what_if: fixtureOverride
        ? {
          fixture_key: fixtureOverride.fixtureKey,
          outcome: fixtureOverride.outcome,
          applied: remainingFixtures.some((fixture) => fixture.key === fixtureOverride.fixtureKey),
        }
        : null,
      upcoming_fixtures: availableFixtures.slice(0, 30).map((fixture) => ({
        key: fixture.key,
        home_team: fixture.homeTeam || teams[fixture.homeIdx]?.name,
        away_team: fixture.awayTeam || teams[fixture.awayIdx]?.name,
        date: fixture.date || null,
      })),
      matches_per_season: totalMatchesPerSeason,
      most_likely_champion: mostLikelyChampion,
      champion_probability: championProbability,
      likely_top_4: likelyTop4,
      relegation_candidates: relegationCandidates,
      standings,
    })
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch league standings. Please try again later.' },
      { status: 500 }
    )
  }
}
