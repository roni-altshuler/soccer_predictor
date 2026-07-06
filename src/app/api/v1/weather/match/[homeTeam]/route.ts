import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ homeTeam: string }> }
) {
  const { homeTeam } = await params
  const matchTime = request.nextUrl.searchParams.get('match_time')
  const query = new URLSearchParams()
  if (matchTime) query.set('match_time', matchTime)

  const url = `${BACKEND_URL}/api/v1/weather/match/${encodeURIComponent(homeTeam)}${query.toString() ? `?${query}` : ''}`

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    })

    // Weather is an optional enrichment: when the backend (or its provider)
    // can't serve it, answer 200 with an "unavailable" payload instead of
    // surfacing a 5xx — the client treats missing fields as unavailable,
    // and every match view stops logging console errors (Vercel has no
    // FastAPI at all, so this path is the norm there).
    if (!response.ok) {
      return NextResponse.json({ available: false }, { status: 200 })
    }

    const payload = await response.json().catch(() => ({ available: false }))
    return NextResponse.json(payload, { status: 200 })
  } catch {
    return NextResponse.json({ available: false }, { status: 200 })
  }
}
