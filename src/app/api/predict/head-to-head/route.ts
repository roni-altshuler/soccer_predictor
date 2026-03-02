import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

interface HeadToHeadRequest {
  league: string
  home_team: string
  away_team: string
}

export async function POST(request: NextRequest) {
  try {
    const body: HeadToHeadRequest = await request.json()
    const { league, home_team, away_team } = body
    
    if (!league || !home_team || !away_team) {
      return NextResponse.json(
        { error: 'Missing required fields: league, home_team, away_team' },
        { status: 400 }
      )
    }
    
    // Use the backend API for predictions
    const response = await fetch(`${BACKEND_URL}/api/predict/unified`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        home_team,
        away_team,
        league,
      }),
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
      return NextResponse.json(
        { error: error.detail || 'Backend prediction failed' },
        { status: response.status }
      )
    }
    
    const prediction = await response.json()
    
    // Transform to expected frontend format
    // Backend returns probabilities as percentages (0-100), frontend expects decimals (0-1)
    return NextResponse.json({
      success: true,
      home_team,
      away_team,
      predictions: {
        home_win: (prediction.probabilities?.home_win || 40) / 100,
        draw: (prediction.probabilities?.draw || 30) / 100,
        away_win: (prediction.probabilities?.away_win || 30) / 100,
      },
      predicted_home_goals: prediction.predicted_home_goals ?? Math.max(0, Math.round(((prediction.home_elo || 1500) - 1350) / 180 + 0.3)),
      predicted_away_goals: prediction.predicted_away_goals ?? Math.max(0, Math.round(((prediction.away_elo || 1500) - 1350) / 200)),
      confidence: prediction.confidence || 50,
    })
  } catch (error) {
    console.error('Error predicting match:', error)
    return NextResponse.json(
      { error: 'Failed to predict match', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
