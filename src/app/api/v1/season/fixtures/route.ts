import { promises as fs } from 'fs'
import path from 'path'

import { NextRequest, NextResponse } from 'next/server'

/**
 * Upcoming fixtures with their forecast.
 *
 * Each fixture carries a 1X2, two expected-goal numbers and the five likeliest
 * scorelines, and they agree with each other by construction: the goal model's
 * lambdas are solved so that the scoreline grid reproduces the 1X2 the model
 * was actually measured on. Serving a 1X2 next to a grid that implies a
 * different one is how a page stops being trustworthy.
 *
 * `?competition=eng.1&limit=20` narrows it; the artifact holds every league.
 */
export const dynamic = 'force-dynamic'

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'predictions',
  'season_fixtures.json',
)

export async function GET(request: NextRequest) {
  try {
    const parsed = JSON.parse(await fs.readFile(ARTIFACT, 'utf8'))
    const { searchParams } = new URL(request.url)
    const competition = searchParams.get('competition')
    const limit = Number(searchParams.get('limit') ?? 0)

    let fixtures = parsed.fixtures ?? []
    if (competition) {
      fixtures = fixtures.filter(
        (f: { competition_id: string }) => f.competition_id === competition,
      )
    }
    if (limit > 0) fixtures = fixtures.slice(0, limit)

    return NextResponse.json({ ...parsed, available: true, fixtures })
  } catch {
    return NextResponse.json(
      { available: false, reason: 'season_fixtures.json has not been generated' },
      { status: 200 },
    )
  }
}
