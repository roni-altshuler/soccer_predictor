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

    const payload = await response.json().catch(() => ({}))
    return NextResponse.json(payload, { status: response.status })
  } catch (error) {
    console.error('Error proxying weather request:', error)
    return NextResponse.json({ error: 'Weather data unavailable' }, { status: 503 })
  }
}
