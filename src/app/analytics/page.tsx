'use client'

import { useState } from 'react'
import { leagues } from '@/data/leagues'
import { LeagueStats } from '@/components/LeagueStats'
import MLMetricsVisualizations from '@/components/MLMetricsVisualizations'
import FeatureImportanceChart from '@/components/FeatureImportanceChart'

export default function AnalyticsPage() {
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null)
  const classes = ['win', 'draw', 'loss']; // Define classes here

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

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">League Analytics</h1>
      <p className="text-lg text-gray-400 mb-8">
        This page provides a deep dive into the statistics of each league. Explore interactive charts to understand league dynamics, team performance, and the key factors that influence match outcomes.
      </p>
      
      <div className="mb-8">
        <select
          onChange={(e) => setSelectedLeague(e.target.value)}
          className="bg-secondary p-3 rounded-lg text-lg"
        >
          <option value="">Select a league to view analytics</option>
          {leagues.map((league) => (
            <option key={league} value={league}>
              {league}
            </option>
          ))}
        </select>
      </div>

      {mappedLeague && (
        <div className="space-y-8">
          <div className="bg-gray-800 p-6 rounded-lg shadow-md mb-8">
            <LeagueStats league={mappedLeague} />
          </div>

          <FeatureImportanceChart league={mappedLeague} />

          <div className="bg-gray-800 p-6 rounded-lg shadow-md mb-8">
            <MLMetricsVisualizations league={mappedLeague} />
          </div>
        </div>
      )}
    </div>
  )
}