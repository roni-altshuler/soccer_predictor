import { NextResponse } from 'next/server'

import { projectionMovement } from '@/lib/server/projectionHistory'

/**
 * What moved the projection since the last forecast, for one competition.
 *
 * Returns `available: false` rather than an empty shape when there is nothing
 * honest to say — fewer than two recorded forecasts, or two with no football
 * between them. A projection that moved on a quiet day moved because the model
 * was retrained, and that is not a story about a team.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const competition = new URL(request.url).searchParams.get('competition')
  if (!competition) {
    return NextResponse.json(
      { available: false, reason: 'competition is required' },
      { status: 400 },
    )
  }

  const movement = await projectionMovement(competition)
  if (!movement) {
    return NextResponse.json({
      available: false,
      reason: 'no two recorded forecasts with matches played between them',
    })
  }
  return NextResponse.json({ available: true, ...movement })
}
