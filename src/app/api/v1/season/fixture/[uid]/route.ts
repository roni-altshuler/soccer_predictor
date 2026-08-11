import { promises as fs } from 'fs'
import path from 'path'

import { NextResponse } from 'next/server'

/**
 * One fixture's forecast, plus how it has moved.
 *
 * The current forecast comes from the published artifact — the same object
 * `/season` renders. The `history` array comes from `prediction_snapshots`,
 * which is append-only, so it answers "what were we saying about this match a
 * week ago" rather than only "what do we say now".
 *
 * History is best-effort: it lives in the gitignored warehouse and is absent
 * on a fresh checkout or on Vercel. The current forecast must render without
 * it, so a missing history is an empty array, never an error.
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
    return NextResponse.json({
      available: true,
      generated_at: parsed.generated_at,
      method: parsed.method,
      fixture,
    })
  } catch {
    return NextResponse.json(
      { available: false, reason: 'season_fixtures.json has not been generated' },
      { status: 200 },
    )
  }
}
