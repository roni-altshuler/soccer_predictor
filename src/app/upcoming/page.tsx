'use client'

import { useState } from 'react'
import { leagues } from '@/data/leagues'
import useSWR from 'swr'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PredictionResult } from '@/components/PredictionResult'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

interface Match {
  home_team: string
  away_team: string
  date: string
}

export default function UpcomingPage() {
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null)
  const [predictingMatch, setPredictingMatch] = useState<Match | null>(null)
  const [prediction, setPrediction] = useState<any>(null)

  const leagueNameMap: Record<string, string> = {
    'Premier League': 'premier_league',
    'La Liga': 'la_liga',
    'Serie A': 'serie_a',
    'Bundesliga': 'bundesliga',
    'Ligue 1': 'ligue_1',
    'Champions League (UCL)': 'ucl',
    'Europa League (UEL)': 'uel',
    'MLS': 'mls',
    'FIFA World Cup': 'world_cup'
  };

  const mappedLeague = selectedLeague ? leagueNameMap[selectedLeague] : null;

  const { data: matches, error } = useSWR<Match[]>(
    mappedLeague ? `/api/upcoming_matches/${mappedLeague}` : null,
    fetcher
  )

  const handlePredict = async (match: Match) => {
    setPredictingMatch(match)
    setPrediction(null)
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/predict/head-to-head`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ league: mappedLeague, home_team: match.home_team, away_team: match.away_team })
    })
    const data = await res.json()
    setPrediction(data)
    setPredictingMatch(null)
  }

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">Upcoming Matches</h1>
      <p className="text-lg text-gray-400 mb-8">
        Select a league to see the upcoming matches and get predictions.
      </p>
      
      <div className="mb-8">
        <select
          onChange={(e) => setSelectedLeague(e.target.value)}
          className="bg-secondary p-3 rounded-lg text-lg"
        >
          <option value="">Select a league</option>
          {leagues.map((league) => (
            <option key={league} value={league}>
              {league}
            </option>
          ))}
        </select>
      </div>

      {error && <div>Failed to load matches</div>}
      {!matches && mappedLeague && <LoadingSpinner />}

      {matches && (
        <div className="space-y-4">
          {matches.map((match, index) => (
            <div key={index} className="bg-secondary p-4 rounded-lg flex justify-between items-center">
              <div>
                <p className="text-lg font-semibold">{match.home_team} vs {match.away_team}</p>
                <p className="text-sm text-gray-400">{new Date(match.date).toLocaleString()}</p>
              </div>
              <button
                onClick={() => handlePredict(match)}
                className="bg-primary text-white px-4 py-2 rounded-lg"
                disabled={predictingMatch === match}
              >
                {predictingMatch === match ? 'Predicting...' : 'Predict'}
              </button>
            </div>
          ))}
        </div>
      )}

      {prediction && (
        <div className="mt-8">
          <PredictionResult prediction={prediction.predictions} homeTeam={prediction.home_team} awayTeam={prediction.away_team} />
        </div>
      )}
    </div>
  )
}
