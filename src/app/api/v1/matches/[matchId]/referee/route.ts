import { NextRequest, NextResponse } from 'next/server'

/**
 * Proxy route: /api/v1/matches/[matchId]/referee
 *
 * Redirects to the canonical referee endpoint at /api/v1/referee/match/[matchId]
 * so that both paths the RefereeInfo component tries will resolve.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params
  const searchParams = request.nextUrl.searchParams.toString()
  const target = new URL(
    `/api/v1/referee/match/${matchId}${searchParams ? '?' + searchParams : ''}`,
    request.nextUrl.origin
  )

  const resp = await fetch(target.toString(), {
    headers: { 'Accept': 'application/json' },
  })

  const data = await resp.json()
  return NextResponse.json(data, { status: resp.status })
}
