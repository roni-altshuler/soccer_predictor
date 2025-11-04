'use client'

import { useState, useEffect } from 'react'
import { format, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns'
import { leagues } from '@/data/leagues'
import { SoccerSpinner } from '@/components/SoccerSpinner'
import { PredictionResult } from '@/components/PredictionResult'

type Match = {
  date: string
  home_team: string
  away_team: string
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  predicted_home_goals?: number
  predicted_away_goals?: number
}

type ViewMode = 'week' | 'day'

function formatDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export default function UpcomingMatches() {
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(false)

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
  }

  const mappedLeague = selectedLeague ? leagueNameMap[selectedLeague] : null

  // Week view starts on Sunday (0) and ends on Saturday (6)
  const today = new Date()
  const weekDays = eachDayOfInterval({
    start: startOfWeek(today, { weekStartsOn: 0 }), // Start from Sunday
    end: endOfWeek(today, { weekStartsOn: 0 })      // End on Saturday
  })

  useEffect(() => {
    const fetchMatches = async () => {
      if (!mappedLeague) return
      setLoading(true)
      try {
        // Use Next.js API route (relative path) in production, Python backend in development
        const apiUrl = process.env.NEXT_PUBLIC_BACKEND_URL 
          ? `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/upcoming_matches/${mappedLeague}`
          : `/api/upcoming_matches/${mappedLeague}`
        
        const response = await fetch(apiUrl)
        if (!response.ok) throw new Error('Failed to fetch matches')
        const data = await response.json()
        setMatches(data)
      } catch (error) {
        console.error('Error fetching matches:', error)
        setMatches([]) // Clear matches on error
      } finally {
        setLoading(false)
      }
    }

    fetchMatches()
  }, [mappedLeague])

  const matchesByDate = matches.reduce((acc: Record<string, Match[]>, match) => {
    const date = match.date.split('T')[0]
    if (!acc[date]) acc[date] = []
    acc[date].push(match)
    return acc
  }, {})

  const getMatchesForDate = (date: Date) => {
    return matchesByDate[formatDate(date)] || []
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-extrabold text-gray-800 sm:text-6xl md:text-7xl">Upcoming Matches</h1>
        <p className="mt-4 text-xl text-gray-600 max-w-3xl mx-auto">
          Explore upcoming matches and see AI-powered predictions for various leagues.
        </p>
      </div>

      <div className="mb-10 flex justify-center">
        <div className="relative">
          <select
            onChange={(e) => setSelectedLeague(e.target.value)}
            className="appearance-none bg-white border-2 border-green-500 text-gray-800 text-lg rounded-lg py-3 px-5 pr-10 focus:outline-none focus:border-green-600 focus:ring-2 focus:ring-green-500 transition duration-300 ease-in-out shadow-md"
          >
            <option value="">Select a league</option>
            {leagues.map((league) => (
              <option key={league} value={league}>
                {league}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-green-600">
            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M5.516 7.548c.436-.446 1.143-.446 1.579 0L10 10.405l2.905-2.857c.436-.446 1.143-.446 1.579 0 .436.445.436 1.167 0 1.612l-3.695 3.63c-.436.446-1.143.446-1.579 0L5.516 9.16c-.436-.445-.436-1.167 0-1.612z"/></svg>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <SoccerSpinner />
        </div>
      ) : mappedLeague && matches.length === 0 ? (
        <div className="text-center bg-white p-8 rounded-xl shadow-2xl border-2 border-gray-200">
          <p className="text-2xl font-semibold text-gray-800 mb-4">No Upcoming Matches</p>
          <p className="text-gray-600">There are no scheduled matches for this league at the moment. Please check back later.</p>
        </div>
      ) : mappedLeague && (
        <div className="bg-white p-8 rounded-xl shadow-2xl border-2 border-gray-200">
          {/* View Mode Toggle */}
          <div className="flex justify-end mb-6 space-x-2">
            <button
              onClick={() => setViewMode('week')}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors duration-300 ${
                viewMode === 'week' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              Week View
            </button>
            <button
              onClick={() => setViewMode('day')}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors duration-300 ${
                viewMode === 'day' ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              Day View
            </button>
          </div>

          {viewMode === 'week' ? (
            // Week View
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              {weekDays.map((date) => {
                const dayMatches = getMatchesForDate(date)
                const isToday = formatDate(date) === formatDate(new Date())
                
                return (
                  <div
                    key={date.toString()}
                    className={`p-4 rounded-lg transition-all duration-300 cursor-pointer ${
                      isToday ? 'bg-green-100 border-2 border-green-500' : 'bg-gray-50 hover:bg-gray-100 border-2 border-gray-200'
                    }`}
                    onClick={() => {
                      setSelectedDate(date)
                      setViewMode('day')
                    }}
                  >
                    <div className="font-bold text-center text-gray-800 mb-3">
                      {format(date, 'EEE')}
                    </div>
                    <div className="text-center text-gray-600 mb-4">
                      {format(date, 'MMM d')}
                    </div>
                    <div className="space-y-2">
                      {dayMatches.length > 0 ? (
                        dayMatches.map((match, idx) => (
                          <div key={idx} className="text-xs text-center text-gray-700 truncate">
                            {match.home_team} vs {match.away_team}
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-center text-gray-400">No matches</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            // Day View
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-3xl font-bold text-gray-800">
                  {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                </h2>
                <button
                  onClick={() => setViewMode('week')}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors duration-300"
                >
                  ← Back to Week View
                </button>
              </div>
              {getMatchesForDate(selectedDate).length > 0 ? (
                getMatchesForDate(selectedDate).map((match, idx) => (
                  <div key={idx} className="bg-gradient-to-br from-gray-50 to-white p-6 rounded-lg shadow-lg border-2 border-gray-200">
                    <div className="text-xl font-semibold text-gray-800 mb-4 text-center">
                      {match.home_team} vs {match.away_team}
                    </div>
                    {match.predicted_home_goals !== undefined && match.predicted_away_goals !== undefined && (
                      <div className="text-center mb-4">
                        <span className="text-lg font-bold text-green-600">
                          Predicted Scoreline: {match.predicted_home_goals} - {match.predicted_away_goals}
                        </span>
                      </div>
                    )}
                    <PredictionResult
                      result={{
                        predictions: {
                          home_win: match.predicted_home_win,
                          draw: match.predicted_draw,
                          away_win: match.predicted_away_win
                        },
                        home_team: match.home_team,
                        away_team: match.away_team
                      }}
                      mode="head-to-head"
                    />
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-600 py-8">
                  No matches scheduled for this day.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
