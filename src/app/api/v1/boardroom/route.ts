import { NextRequest, NextResponse } from 'next/server'

import { getBoardroomDebate } from '@/lib/boardroom'

/**
 * Boardroom v1 — the committed debate for one fixture.
 *
 * GET /api/v1/boardroom?match=<matchId>
 *
 * Reads the committed artifact under `backend/data/boardroom/` (the same
 * pattern as the rarity/tracking routes, so it works on Vercel where the
 * warehouse SQLite is absent). A match with no committed debate returns
 * `{ debate: null }` with 200 — honest absence, never an error.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const matchId = (searchParams.get('match') ?? '').trim()

  if (!matchId) {
    return NextResponse.json({ error: 'expected ?match=<matchId>' }, { status: 400 })
  }

  const debate = getBoardroomDebate(matchId)

  return NextResponse.json(
    { debate },
    // The artifact only changes on deploy — safe to cache briefly.
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } }
  )
}
