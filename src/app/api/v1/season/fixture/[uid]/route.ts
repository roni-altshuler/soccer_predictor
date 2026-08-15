import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

import { recordedForecast, type RecordedForecast } from '@/lib/server/recordedForecast'
import { matchCard, resolveTie, type MatchCard } from '@/lib/server/tieFixtures'

/**
 * One fixture's forecast, and the match itself.
 *
 * The forecast comes from the published artifact — the same object `/season`
 * renders. The `match` comes from ESPN, resolved by the SAME join a knockout
 * tie uses, so a Premier League fixture and a Champions League tie reach the
 * identical card. A league fixture is a single match, which is the easy case of
 * that join: one competition, one date, two clubs.
 *
 * The match is best-effort and the forecast never depends on it. An upcoming
 * fixture legitimately has no timeline and no team sheets — ESPN files those
 * about an hour before kickoff — so an empty `match` is normal rather than a
 * fault.
 */
export const dynamic = 'force-dynamic'

const FIXTURES = path.join(
  process.cwd(),
  'backend',
  'data',
  'predictions',
  'season_fixtures.json',
)

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const { uid } = await params
  try {
    const parsed = JSON.parse(await fs.readFile(FIXTURES, 'utf8'))
    const fixture = (parsed.fixtures ?? []).find(
      (f: { fixture_uid?: string }) => f.fixture_uid === uid,
    )
    if (!fixture) {
      return NextResponse.json(
        { available: false, reason: 'no forecast for that fixture' },
        { status: 404 },
      )
    }
    let match: MatchCard | null = null
    let recorded: RecordedForecast | null = null
    try {
      const found = await resolveTie({
        competitionId: fixture.competition_id,
        kickoff: fixture.date,
        teamA: fixture.home,
        teamB: fixture.away,
        twoLegged: false,
      })
      if (found) {
        match = await matchCard(fixture.competition_id, found.eventIds[0])
        // The same join that finds the match finds the forecast we recorded
        // for it: both are keyed on the ESPN event id.
        recorded = await recordedForecast(found.eventIds[0], match?.date ?? fixture.date)
      }
    } catch {
      // ESPN being unreachable costs the match card, never the forecast.
      match = null
    }

    return NextResponse.json({
      available: true,
      generated_at: parsed.generated_at,
      method: parsed.method,
      fixture,
      match,
      recorded,
    })
  } catch {
    return NextResponse.json(
      { available: false, reason: 'season_fixtures.json has not been generated' },
      { status: 200 },
    )
  }
}
