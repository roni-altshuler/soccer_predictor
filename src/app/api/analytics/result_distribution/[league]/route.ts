import { NextRequest, NextResponse } from 'next/server'
import {
  loadCompletedPredictions,
  summarizeResultDistribution,
} from '../../_lib/predictionAnalytics'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ league: string }> }
) {
  const { league } = await params

  const completed = loadCompletedPredictions(league)
  const summary = summarizeResultDistribution(completed)

  return NextResponse.json({
    league,
    total_matches: summary.total_matches,
    distribution: summary.distribution,
    chart_data: summary.chart_data,
    source: 'prediction_history',
  })
}
