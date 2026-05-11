import { NextRequest, NextResponse } from 'next/server'
import { buildMarketIntelligence } from '@/lib/marketIntelligence'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = buildMarketIntelligence(body.odds, body.model_probabilities ?? null)

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid market intelligence request'
    return NextResponse.json(
      {
        error: message,
        guarantee: false,
        betting_advice: false,
      },
      { status: 400 }
    )
  }
}
