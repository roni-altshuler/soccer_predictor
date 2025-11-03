// Next.js API route for upcoming matches
// Serves matches from CSV files without ML predictions (models are too large for Vercel)
// TODO: Implement lightweight prediction service or use external API

import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'

// Helper function to parse CSV data
const parseCSV = (csv: string) => {
  const lines = csv.trim().split('\n')
  const header = lines[0].split(',')
  const data = lines.slice(1).map(line => {
    const values = line.split(',')
    return header.reduce((obj, key, index) => {
      obj[key.trim()] = values[index]?.trim() || ''
      return obj
    }, {} as Record<string, string>)
  })
  return data
}

export async function GET(
  request: Request,
  { params }: { params: { league: string } }
) {
  const { league } = params
  const filePath = path.join(process.cwd(), 'fbref_data', 'processed', `${league}_processed.csv`)

  try {
    const fileContent = await fs.readFile(filePath, 'utf-8')
    const matches = parseCSV(fileContent)

    // Filter for scheduled matches only
    const upcomingMatches = matches
      .filter(match => match.status === 'Scheduled')
      .slice(0, 50) // Limit to 50 matches
      .map(match => {
        const matchDate = new Date(match.date)
        
        // Add placeholder predictions (33% each for now - TODO: implement real predictions)
        return {
          date: matchDate.toISOString(),
          home_team: match.home_team,
          away_team: match.away_team,
          predicted_home_win: 0.33,
          predicted_draw: 0.34,
          predicted_away_win: 0.33,
          predicted_home_goals: 1.5,
          predicted_away_goals: 1.5,
        }
      })

    return NextResponse.json(upcomingMatches)
  } catch (error) {
    console.error('Error loading matches:', error)
    return NextResponse.json(
      { error: 'Failed to load matches', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
