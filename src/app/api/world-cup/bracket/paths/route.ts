import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export const runtime = 'nodejs'

/**
 * GET /api/world-cup/bracket/paths
 *
 * Proxies to the FastAPI Monte Carlo bracket-path simulator.
 * Returns per-team cumulative reach probabilities (R16 -> Champion) plus
 * the current bracket structure (matchups per round).
 *
 * Default `n_simulations` is 20,000.  Cache strategy mirrors the FastAPI
 * in-process TTL: 15 minutes fresh, 30 minutes stale-while-revalidate.
 */
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams
  const nSimulations = Math.min(
    200_000,
    Math.max(500, parseInt(search.get('n_simulations') || '20000', 10) || 20_000),
  )
  const seed = search.get('seed')
  const fresh = search.get('fresh') === 'true'

  const qs = new URLSearchParams()
  qs.set('n_simulations', String(nSimulations))
  if (seed) qs.set('seed', seed)
  if (fresh) qs.set('fresh', 'true')

  try {
    const upstream = await fetch(
      `${BACKEND_URL}/api/v1/world-cup/bracket/paths?${qs.toString()}`,
      {
        headers: { Accept: 'application/json' },
        next: { revalidate: 900 },
      },
    )

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return NextResponse.json(
        { error: 'Upstream bracket simulation failed', detail: text || upstream.statusText },
        { status: upstream.status },
      )
    }

    const data = await upstream.json()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 's-maxage=900, stale-while-revalidate=1800',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to contact bracket simulation backend', detail: String(error) },
      { status: 502 },
    )
  }
}
