import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

interface CrossLeagueRequest {
  league_a: string
  team_a: string
  league_b: string
  team_b: string
}

const POLICY_MIN_CONFIDENCE = 55
const POLICY_MIN_EDGE = 12

export async function POST(request: NextRequest) {
  try {
    const body: CrossLeagueRequest = await request.json()
    const { league_a, team_a, league_b, team_b } = body
    
    if (!league_a || !team_a || !league_b || !team_b) {
      return NextResponse.json(
        { error: 'Missing required fields: league_a, team_a, league_b, team_b' },
        { status: 400 }
      )
    }
    
    // Use backend API for both teams' predictions
    const response = await fetch(`${BACKEND_URL}/api/predict/unified`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        home_team: team_a,
        away_team: team_b,
        league: league_a,
      }),
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
      return NextResponse.json(
        { error: error.detail || 'Backend prediction failed' },
        { status: response.status }
      )
    }
    
    const backendPrediction = await response.json()

    const teamAWin = (backendPrediction.probabilities?.home_win || 40) / 100
    const draw = (backendPrediction.probabilities?.draw || 30) / 100
    const teamBWin = (backendPrediction.probabilities?.away_win || 30) / 100
    const confidence = backendPrediction.confidence || 50
    const edgePct = (Math.max(teamAWin, draw, teamBWin) - (1 / 3)) * 100
    const thresholdQualified = confidence >= POLICY_MIN_CONFIDENCE && edgePct >= POLICY_MIN_EDGE
    const recommendedPick = teamAWin >= draw && teamAWin >= teamBWin
      ? team_a
      : teamBWin >= teamAWin && teamBWin >= draw
        ? team_b
        : 'Draw'
    
    const prediction = {
      team_a,
      team_b,
      league_a,
      league_b,
      predicted_team_a_win: teamAWin,
      predicted_draw: draw,
      predicted_team_b_win: teamBWin,
      predicted_team_a_goals: backendPrediction.predicted_home_goals ?? Math.max(0.5, ((backendPrediction.home_elo || 1500) - 1350) / 180 + 0.3),
      predicted_team_b_goals: backendPrediction.predicted_away_goals ?? Math.max(0.5, ((backendPrediction.away_elo || 1500) - 1350) / 200),
      confidence,
      verdict: {
        edge_pct: Math.round(edgePct * 10) / 10,
        threshold_qualified: thresholdQualified,
        recommended_action: thresholdQualified ? 'play' : 'pass',
        recommended_pick: thresholdQualified ? recommendedPick : null,
        policy: {
          min_confidence: POLICY_MIN_CONFIDENCE,
          min_edge: POLICY_MIN_EDGE,
        },
      },
      team_a_elo: backendPrediction.home_elo || 1500,
      team_b_elo: backendPrediction.away_elo || 1500,
    }
    
    return NextResponse.json(prediction)
  } catch (error) {
    console.error('Error predicting cross-league match:', error)
    return NextResponse.json(
      { error: 'Failed to predict match', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
