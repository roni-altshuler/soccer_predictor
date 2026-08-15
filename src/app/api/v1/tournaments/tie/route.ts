import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

import { recordedForecast, type RecordedForecast } from '@/lib/server/recordedForecast'
import { matchCard, resolveTie, type MatchCard } from '@/lib/server/tieFixtures'

/**
 * One knockout tie, and the fixture(s) that decided it.
 *
 * Two sources, kept apart on purpose:
 *
 *   the tie      `tournaments.json` — ours. Who played whom, in which round,
 *                what the model gave the side it thought would advance. Always
 *                present, because it is a file on disk.
 *   the fixture  ESPN — theirs. Timeline, commentary, lineups, stats, the
 *                head-to-head record. Fetched live, and reached through a
 *                name join that resolves 99.2% of ties (see `tieFixtures.ts`).
 *
 * When the join fails the response still carries the tie. A page that can say
 * "these two played, this is what the model thought, and the match detail for
 * this one is unavailable" is honest; one that silently shows a different
 * fixture is not, and 0.8% of ties is roughly four of them.
 */
export const dynamic = 'force-dynamic'

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'predictions',
  'tournaments.json',
)

interface Tie {
  team_a: string
  team_b: string
  team_a_id: number
  team_b_id: number
  score: string | null
  winner: string | null
  winner_id: number | null
  p_team_a: number | null
  kickoff: string
  two_legged: boolean
  pending: boolean
  slot?: number | null
}

interface Round {
  slug: string
  label: string
  display: string
  slots?: number
  ties: Tie[]
}

interface Edition {
  competition_id: string
  name: string
  season: number
  status?: string
  is_current?: boolean
  bracket?: Round[]
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams
  const competition = q.get('competition') ?? ''
  const season = Number(q.get('season'))
  const roundSlug = q.get('round') ?? ''
  const a = Number(q.get('a'))
  const b = Number(q.get('b'))

  if (!competition || !Number.isFinite(season) || !roundSlug || !Number.isFinite(a) || !Number.isFinite(b)) {
    return NextResponse.json(
      { available: false, reason: 'competition, season, round and both team ids are required' },
      { status: 400 },
    )
  }

  let editions: Edition[]
  try {
    const parsed = JSON.parse(await fs.readFile(ARTIFACT, 'utf8')) as { tournaments?: Edition[] }
    editions = parsed.tournaments ?? []
  } catch {
    return NextResponse.json(
      { available: false, reason: 'tournaments.json has not been generated' },
      { status: 200 },
    )
  }

  const edition = editions.find(
    (e) => e.competition_id === competition && e.season === season,
  )
  const round = edition?.bracket?.find((r) => r.slug === roundSlug)
  // Either orientation: a link may name the two clubs in either order.
  const tie = round?.ties.find(
    (t) =>
      (t.team_a_id === a && t.team_b_id === b) || (t.team_a_id === b && t.team_b_id === a),
  )

  if (!edition || !round || !tie) {
    return NextResponse.json(
      { available: false, reason: 'no such tie in this edition' },
      { status: 404 },
    )
  }

  const base = {
    available: true,
    competition: { id: edition.competition_id, name: edition.name },
    season: edition.season,
    status: edition.status ?? null,
    round: { slug: round.slug, display: round.display, label: round.label },
    tie,
  }

  let resolution = null
  let legs: MatchCard[] = []
  let recorded: RecordedForecast[] = []
  try {
    resolution = await resolveTie({
      competitionId: competition,
      kickoff: tie.kickoff,
      teamA: tie.team_a,
      teamB: tie.team_b,
      twoLegged: tie.two_legged,
    })
    if (resolution) {
      const cards = await Promise.all(
        resolution.eventIds.map((id) => matchCard(competition, id)),
      )
      legs = cards.filter((c): c is MatchCard => c !== null)
      // One per leg, in the same order, so a two-legged tie can show what was
      // said about each match rather than one number for both.
      recorded = (
        await Promise.all(legs.map((leg) => recordedForecast(leg.eventId, leg.date)))
      ).filter((r): r is RecordedForecast => r !== null)
    }
  } catch {
    // ESPN being unreachable costs the match detail, never the tie.
    legs = []
    recorded = []
  }

  return NextResponse.json({
    ...base,
    legs,
    recorded,
    resolution: resolution ? { how: resolution.how, events: resolution.eventIds } : null,
    reason: legs.length
      ? null
      : 'This tie could not be matched to a fixture in ESPN’s record, so no match detail is shown.',
  })
}
