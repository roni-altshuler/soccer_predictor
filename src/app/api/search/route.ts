import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export const runtime = 'nodejs'

/**
 * GET /api/search
 *
 * Thin proxy to the FastAPI global omni-search endpoint.
 * Caches at the edge for 60s (with 180s stale-while-revalidate) since the
 * underlying index only changes once a day.
 */
export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams
  const q = (search.get('q') || '').trim()
  const kinds = (search.get('kinds') || '').trim()
  const limitRaw = parseInt(search.get('limit') || '8', 10)
  const limit = Math.min(25, Math.max(1, isNaN(limitRaw) ? 8 : limitRaw))

  const qs = new URLSearchParams()
  qs.set('q', q)
  if (kinds) qs.set('kinds', kinds)
  qs.set('limit', String(limit))

  try {
    const upstream = await fetch(`${BACKEND_URL}/api/v1/search?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 60 },
    })

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      // Fail gracefully — don't blow up the navbar with a 5xx.
      return NextResponse.json(
        {
          query: q,
          results: [],
          total: 0,
          generated_at: new Date().toISOString(),
          error: text || upstream.statusText,
        },
        {
          status: 200,
          headers: { 'Cache-Control': 's-maxage=10, stale-while-revalidate=30' },
        },
      )
    }

    const data = await upstream.json()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=180',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        query: q,
        results: [],
        total: 0,
        generated_at: new Date().toISOString(),
        error: String(error),
      },
      {
        status: 200,
        headers: { 'Cache-Control': 's-maxage=5, stale-while-revalidate=15' },
      },
    )
  }
}
