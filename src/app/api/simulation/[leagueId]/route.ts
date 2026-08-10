import { NextRequest, NextResponse } from 'next/server'

import { getLeagueAccent } from '@/lib/leagueAccents'
import {
  logProbabilityAnomaly,
  logSimulationRun,
} from '@/lib/observability/simulationLogger'
import { PROBABILITY_SUM_TOLERANCE } from '@/lib/probabilityValidation'
import {
  runMonteCarloSimulationDetailed,
  type SimulationFixture,
  type Standing,
  type TeamData,
  type WhatIfOutcome,
} from '@/lib/simulation/leagueMonteCarlo'
import { loadProjectionCalibrator } from '@/lib/simulation/loadProjectionCalibrator'
import { calibrateProjection } from '@/lib/simulation/projectionCalibration'
import { getLeaguePriorPpg, lookupPriorPpg } from '@/lib/simulation/teamPriors'
import { ESPN_SITE, ESPN_V2 } from '@/lib/espnHost'

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

/**
 * Days of schedule to ask ESPN for. A domestic season runs ~10 months, so 330
 * days reaches the final matchday from any point in it — including the day
 * before it starts, which is exactly when the old +100-day window failed.
 */
const SCHEDULE_LOOKAHEAD_DAYS = 330

/**
 * ESPN's scoreboard defaults to **100 events** and says nothing about it.
 * Without an explicit limit, a 20-team league asking for its whole remaining
 * season silently got the next 100 fixtures, and the Monte Carlo happily
 * projected a "final table" from a quarter of a season. Anything at or above
 * one season of fixtures (380 for a 20-team league) is enough.
 */
const SCHEDULE_LIMIT = 1000

async function fetchRemainingFixtures(
  espnLeagueId: string,
  teams: TeamData[],
): Promise<SimulationFixture[]> {
  const lookup = new Map<string, number>()
  teams.forEach((team, idx) => {
    lookup.set(normalizeTeamName(team.name), idx)
  })

  const today = new Date()
  const future = new Date(today)
  future.setDate(future.getDate() + SCHEDULE_LOOKAHEAD_DAYS)
  const dateRange = `${formatESPNDate(today)}-${formatESPNDate(future)}`

  const response = await fetch(
    `${ESPN_SITE}/${espnLeagueId}/scoreboard?dates=${dateRange}&limit=${SCHEDULE_LIMIT}`,
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

  // Chronological, so the caller can take exactly the current season's tail
  // and drop anything ESPN has already published for the season after it.
  fixtures.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
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
      `${ESPN_V2}/${espnLeagueId}/standings`,
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

    // Historical strength priors from the committed artifact (may be null —
    // then every team simulates from the live table alone, as before).
    const leaguePriors = getLeaguePriorPpg(espnLeagueId)

    // Parse ESPN standings with full stats
    const teams: TeamData[] = entries.map((entry: any) => {
      const stats = entry.stats || []
      const getStat = (name: string) => stats.find((s: any) => s.name === name)?.value || 0
      const name = entry.team?.displayName || 'Unknown'
      const priorPpg = lookupPriorPpg(leaguePriors, name)
      return {
        name,
        points: getStat('points'),
        wins: getStat('wins'),
        draws: getStat('ties'),
        losses: getStat('losses'),
        gf: getStat('pointsFor'),
        ga: getStat('pointsAgainst'),
        gd: getStat('pointDifferential'),
        matchesPlayed: getStat('gamesPlayed'),
        // Absent prior stays absent — the engine's honest fallback.
        ...(priorPpg !== undefined ? { priorPpg } : {}),
      }
    })

    // Sort by current points (ESPN should already do this, but ensure)
    teams.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      return b.gd - a.gd
    })

    // How many matches the table says are still to be played. This is the
    // arithmetic truth and the yardstick the scheduled list is checked against.
    const expectedRemaining = Math.max(
      0,
      Math.round(
        teams.reduce(
          (sum, team) => sum + Math.max(0, totalMatchesPerSeason - team.matchesPlayed),
          0,
        ) / 2,
      ),
    )

    let scheduled: SimulationFixture[] = []
    try {
      scheduled = await fetchRemainingFixtures(espnLeagueId, teams)
    } catch {
      scheduled = []
    }

    // A partial schedule is the dangerous case, not the empty one. The engine
    // plays whatever list it is handed and reports the result as the final
    // table, so handing it 100 of 380 fixtures projects a season that stops in
    // November — silently, and looking entirely plausible. Two guards:
    //
    //   too many  → ESPN has already published next season; the current season
    //               is the first `expectedRemaining` fixtures by date.
    //   too few   → do not part-simulate. Fall back to the engine's generated
    //               schedule, which at least gives every team its real number
    //               of matches left.
    //
    // SCHEDULE_COVERAGE_FLOOR allows for the handful of cup-postponed fixtures
    // a provider carries as TBD mid-season without tipping into the fallback.
    const SCHEDULE_COVERAGE_FLOOR = 0.95
    const coverage = expectedRemaining > 0 ? scheduled.length / expectedRemaining : 0
    const scheduleUsable = expectedRemaining > 0 && coverage >= SCHEDULE_COVERAGE_FLOOR

    const remainingFixtures: SimulationFixture[] = scheduleUsable
      ? scheduled.slice(0, expectedRemaining)
      : []

    const availableFixtures = remainingFixtures
    const fixtureOverride = whatIfFixture && whatIfOutcome
      ? { fixtureKey: whatIfFixture, outcome: whatIfOutcome }
      : null

    const simStart = Date.now()
    const detailed = runMonteCarloSimulationDetailed(
      teams,
      totalMatchesPerSeason,
      nSimulations,
      leagueId,
      remainingFixtures,
      fixtureOverride,
    )
    // Apply the measured calibration before anything downstream reads the
    // probabilities. The backtest says this simulator's 85% happens 78% of the
    // time; that correction used to be printed as a caveat beside the table
    // and is now applied to it. The mapping is monotone and mass-preserving,
    // so the ordering and the "exactly one champion" invariant both survive —
    // `auditProbabilities` below still checks that, on the calibrated numbers.
    const standings = calibrateProjection(detailed.standings, loadProjectionCalibrator())
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

    // Either branch plays a whole season, so the count is the same either way.
    const remainingMatches = remainingFixtures.length > 0
      ? remainingFixtures.length
      : expectedRemaining
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
  } catch (err) {
    // Log the cause. A bare `catch {}` here is how an ESPN 403 spent weeks
    // surfacing to users as an unexplained "Simulation unavailable" with
    // nothing in the server output to point at the host.
    console.error(
      `[simulation] league=${leagueId} espn=${espnLeagueId} failed:`,
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json(
      { error: 'Failed to fetch league standings. Please try again later.' },
      { status: 500 }
    )
  }
}
