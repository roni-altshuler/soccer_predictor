import { NextRequest, NextResponse } from 'next/server'

import { getBracketPaths } from '@/lib/server/worldCup'

export const runtime = 'nodejs'

/**
 * GET /api/world-cup/bracket/paths
 *
 * Per-team cumulative reach probabilities (R32 -> Champion) plus the
 * current bracket structure. Served by the FastAPI Monte Carlo simulator
 * when reachable, otherwise by the committed pipeline snapshot
 * (backend/data/worldcup/bracket_paths.json) so Vercel deployments work
 * without the Python backend.
 */
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams
  const nSimulations = Math.min(
    200_000,
    Math.max(500, parseInt(search.get('n_simulations') || '20000', 10) || 20_000),
  )
  const seed = search.get('seed')
  const fresh = search.get('fresh') === 'true'

  const payload = await getBracketPaths(nSimulations, seed, fresh)
  if (!payload) {
    return NextResponse.json(
      { error: 'Bracket simulation unavailable — no live backend and no committed snapshot.' },
      { status: 503 },
    )
  }
  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 's-maxage=900, stale-while-revalidate=1800',
    },
  })
}
