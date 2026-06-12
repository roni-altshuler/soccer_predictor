import { NextRequest, NextResponse } from 'next/server'

import { fetchPlayerStats, playerSlug } from '@/lib/server/espnPlayers'

/**
 * Vercel-deployable mirror of FastAPI's GET /api/v1/teams/players/{id}/stats.
 * Fetches ESPN directly because the Python backend isn't deployed there.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const playerId = Number(id)
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'Invalid player id' }, { status: 400 })
  }

  const gender = request.nextUrl.searchParams.get('gender')
  const stats = await fetchPlayerStats(playerId, playerSlug(gender))
  if (!stats) {
    return NextResponse.json({ error: `Player ${playerId} not found` }, { status: 404 })
  }
  return NextResponse.json(stats)
}
