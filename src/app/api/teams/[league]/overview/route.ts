import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export const runtime = 'nodejs'

/**
 * GET /api/teams/[teamId]/overview?league=premier_league
 *
 * Proxies to the FastAPI team-overview aggregator. Mirrors the world-cup
 * group simulator proxy: short s-maxage with a long SWR window.
 *
 * NOTE: the dynamic segment is named `league` to match Next.js's existing
 * sibling route at `api/teams/[league]/route.ts`. Parallel dynamic
 * segments at the same level must share a name in the App Router; the
 * value passed here is semantically a team ID.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ league: string }> },
) {
  const { league: teamId } = await params
  const leagueQuery = request.nextUrl.searchParams.get('league')

  const qs = new URLSearchParams()
  if (leagueQuery) qs.set('league', leagueQuery)

  const upstreamUrl = `${BACKEND_URL}/api/v1/teams/${encodeURIComponent(teamId)}/overview${
    qs.toString() ? `?${qs.toString()}` : ''
  }`

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    })

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return NextResponse.json(
        { error: 'Upstream team overview failed', detail: text || upstream.statusText },
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
      { error: 'Failed to contact team overview backend', detail: String(error) },
      { status: 502 },
    )
  }
}
