import { NextRequest, NextResponse } from 'next/server'
import { loadCompletedPredictions, summarizeSeasonTrends } from '../../_lib/predictionAnalytics'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league } = await params

  const completed = loadCompletedPredictions(league)
  const trends = summarizeSeasonTrends(completed)

  return NextResponse.json({
    league,
    trends,
    seasons_count: trends.length,
    source: 'prediction_history',
  })
}
