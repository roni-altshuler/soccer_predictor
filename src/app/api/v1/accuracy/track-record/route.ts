import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

/**
 * Per-league, per-season track record — written by
 * `backend/scripts/build_league_track_record.py`.
 *
 * Optional `?league=eng.1` narrows to one competition.
 */
export const dynamic = 'force-dynamic'

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'diagnostics',
  'league_track_record.json',
)

export async function GET(request: Request) {
  let parsed: { leagues?: { competition_id: string }[] }
  try {
    parsed = JSON.parse(await fs.readFile(ARTIFACT, 'utf8'))
  } catch {
    return NextResponse.json(
      { available: false, reason: 'league_track_record.json has not been generated' },
      { status: 200 },
    )
  }

  const wanted = new URL(request.url).searchParams.get('league')
  const leagues = wanted
    ? (parsed.leagues ?? []).filter((l) => l.competition_id === wanted)
    : (parsed.leagues ?? [])

  return NextResponse.json({ available: true, ...parsed, leagues })
}
