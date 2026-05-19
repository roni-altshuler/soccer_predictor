import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export const runtime = 'nodejs'

/**
 * GET /api/world-cup/groups/[groupId]/simulate
 *
 * Proxies to the FastAPI Monte Carlo group-permutation simulator.
 * Default `n_simulations` is 50,000 for live advancement probabilities.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params
  const search = request.nextUrl.searchParams
  const nSimulations = Math.min(
    200_000,
    Math.max(500, parseInt(search.get('n_simulations') || '50000', 10) || 50_000),
  )
  const seed = search.get('seed')

  const qs = new URLSearchParams()
  qs.set('n_simulations', String(nSimulations))
  if (seed) qs.set('seed', seed)

  try {
    const upstream = await fetch(
      `${BACKEND_URL}/api/v1/world-cup/groups/${encodeURIComponent(groupId)}/simulate?${qs.toString()}`,
      {
        headers: { Accept: 'application/json' },
        next: { revalidate: 300 },
      },
    )

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return NextResponse.json(
        { error: 'Upstream simulation failed', detail: text || upstream.statusText },
        { status: upstream.status },
      )
    }

    const data = await upstream.json()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to contact simulation backend', detail: String(error) },
      { status: 502 },
    )
  }
}
