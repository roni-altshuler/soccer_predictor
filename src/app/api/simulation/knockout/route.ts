import { NextRequest, NextResponse } from 'next/server'

import {
  runKnockoutSimulation,
  type KnockoutRoundKey,
  type KnockoutTeamInput,
} from '@/lib/simulation/knockoutMonteCarlo'

/**
 * POST /api/simulation/knockout
 *
 * Runs the pure TypeScript knockout Monte Carlo (the FastAPI
 * /api/v1/knockout/* routes are not deployed on Vercel — this route is the
 * production knockout engine).
 *
 * Body: {
 *   tournament: 'champions_league' | 'europa_league' | 'world_cup' | 'euro' | 'copa_america',
 *   teams: [{ name, elo?, group?, group_position?, country? }, ...]   (2–16),
 *   n_simulations?: number                                            (100–50,000)
 * }
 */

const CLUB_TOURNAMENTS = new Set(['champions_league', 'europa_league'])
const NATIONAL_TOURNAMENTS = new Set(['world_cup', 'euro', 'copa_america'])

/** Rating used when the caller supplies no team rating. */
const DEFAULT_ELO = 1800

interface RawTeam {
  name?: unknown
  elo?: unknown
  group?: unknown
  group_position?: unknown
  country?: unknown
}

function parseTeams(raw: unknown): KnockoutTeamInput[] {
  if (!Array.isArray(raw)) return []
  const teams: KnockoutTeamInput[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const t = entry as RawTeam
    const name = typeof t?.name === 'string' ? t.name.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    teams.push({
      name,
      elo:
        typeof t.elo === 'number' && Number.isFinite(t.elo)
          ? Math.max(800, Math.min(3000, t.elo))
          : DEFAULT_ELO,
      group: typeof t.group === 'string' ? t.group : undefined,
      group_position:
        typeof t.group_position === 'number' ? t.group_position : undefined,
      country: typeof t.country === 'string' ? t.country : undefined,
    })
  }
  return teams.slice(0, 16)
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const tournament = typeof body.tournament === 'string' ? body.tournament : ''
  const isClub = CLUB_TOURNAMENTS.has(tournament)
  const isNational = NATIONAL_TOURNAMENTS.has(tournament)
  if (!isClub && !isNational) {
    return NextResponse.json(
      {
        error:
          'Unknown tournament. Supported: champions_league, europa_league, world_cup, euro, copa_america',
      },
      { status: 400 },
    )
  }

  const teams = parseTeams(body.teams)
  if (teams.length < 2) {
    return NextResponse.json(
      { error: 'At least 2 teams are required' },
      { status: 400 },
    )
  }

  const nSimulations = Math.min(
    50000,
    Math.max(100, Math.floor(Number(body.n_simulations) || 10000)),
  )

  const result = runKnockoutSimulation(teams, {
    kind: isClub ? 'club' : 'national',
    nSimulations,
  })

  const roundProbabilities: Record<
    string,
    Partial<Record<KnockoutRoundKey, number>>
  > = {}
  for (const team of result.teams) {
    roundProbabilities[team.name] = team.reach
  }

  return NextResponse.json({
    tournament,
    n_simulations: result.n_simulations,
    bracket_size: result.bracket_size,
    rounds: result.rounds,
    most_likely_winner: result.most_likely_winner,
    winner_probability: result.winner_probability,
    round_probabilities: roundProbabilities,
  })
}
