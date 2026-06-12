import { NextRequest, NextResponse } from 'next/server'

import { fetchTeamOverview } from '@/lib/server/espnTeamOverview'

/**
 * Vercel-deployable mirror of FastAPI's GET /api/v1/teams/{id}/overview.
 * Fetches ESPN directly because the Python backend isn't deployed there.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid team id' }, { status: 400 })
  }

  const overview = await fetchTeamOverview(id)
  if (!overview) {
    return NextResponse.json({ error: `Team ${id} not found` }, { status: 404 })
  }
  return NextResponse.json(overview)
}
