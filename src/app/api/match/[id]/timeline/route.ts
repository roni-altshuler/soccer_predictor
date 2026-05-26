import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: matchId } = await params
  const league = request.nextUrl.searchParams.get('league') || ''
  const qs = league ? `?league=${encodeURIComponent(league)}` : ''

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/match/${matchId}/timeline${qs}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Timeline unavailable', matchId, events: [] },
        { status: res.status, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      )
    }

    const data = await res.json()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 's-maxage=30, stale-while-revalidate=60',
      },
    })
  } catch (e) {
    console.error('Timeline proxy failed:', e)
    return NextResponse.json(
      { error: 'Timeline proxy error', matchId, events: [] },
      { status: 502, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    )
  }
}
