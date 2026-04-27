import { NextRequest, NextResponse } from 'next/server'
import { loadCompletedPredictions, summarizeOverview } from '../../_lib/predictionAnalytics'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league } = await params

  const completed = loadCompletedPredictions(league)
  const summary = summarizeOverview(completed)

  return NextResponse.json({
    league,
    ...summary,
    source: 'prediction_history',
    sample_size: summary.total_matches,
  })
}
