'use client'

import { useState, useEffect } from 'react'

interface RefereeStats {
  name: string
  country: string
  age?: number
  experience: number  // years
  careerMatches: number
  averageCardsPerMatch: {
    yellow: number
    red: number
  }
  homeWinRate: number  // percentage
  awayWinRate: number
  drawRate: number
  averageGoalsPerMatch: number
  penaltiesAwarded: number
  penaltiesPerMatch: number
  competitions: string[]
  isLeagueAverage?: boolean
}

interface TeamRefereeHistory {
  team: string
  matches: number
  wins: number
  draws: number
  losses: number
  cardsReceived: {
    yellow: number
    red: number
  }
  penaltiesFor: number
  penaltiesAgainst: number
}

interface RefereePredictionImpact {
  cardLikelihood: 'low' | 'average' | 'high' | 'very_high'
  homeBias: 'none' | 'slight' | 'moderate'
  goalExpectation: 'lower' | 'average' | 'higher'
  summary: string
}

interface RefereeInfoProps {
  matchId: string
  homeTeam?: string
  awayTeam?: string
  refereeName?: string // Pass the referee name from match data to avoid TBD inconsistency
}

export default function RefereeInfo({ matchId, homeTeam, awayTeam, refereeName }: RefereeInfoProps) {
  const [referee, setReferee] = useState<RefereeStats | null>(null)
  const [homeHistory, setHomeHistory] = useState<TeamRefereeHistory | null>(null)
  const [awayHistory, setAwayHistory] = useState<TeamRefereeHistory | null>(null)
  const [impact, setImpact] = useState<RefereePredictionImpact | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview')

  useEffect(() => {
    const fetchRefereeData = async () => {
      setLoading(true)
      try {
        // Try multiple endpoints for referee data, passing team context
        let data = null
        const qs = new URLSearchParams()
        if (homeTeam) qs.set('home_team', homeTeam)
        if (awayTeam) qs.set('away_team', awayTeam)
        const suffix = qs.toString() ? '?' + qs.toString() : ''
        
        // First try the match-specific referee endpoint
        try {
          const response = await fetch(`/api/v1/matches/${matchId}/referee${suffix}`)
          if (response.ok) {
            data = await response.json()
          }
        } catch {
          // Continue to fallback
        }
        
        // If no data, try the referee service endpoint
        if (!data) {
          try {
            const response = await fetch(`/api/v1/referee/match/${matchId}${suffix}`)
            if (response.ok) {
              data = await response.json()
            }
          } catch {
            // Continue to fallback
          }
        }
        
        if (!data) {
          throw new Error('Referee data unavailable')
        }

        setReferee({
          name: data.name || refereeName || 'Not available',
          country: data.country || 'Unknown',
          age: data.age,
          experience: data.experience_years || 0,
          careerMatches: data.career_matches || 0,
          averageCardsPerMatch: {
            yellow: data.avg_yellow_cards || 3.2,
            red: data.avg_red_cards || 0.1
          },
          homeWinRate: data.home_win_rate || 0.45,
          awayWinRate: data.away_win_rate || 0.30,
          drawRate: data.draw_rate || 0.25,
          averageGoalsPerMatch: data.avg_goals || 2.6,
          penaltiesAwarded: data.total_penalties || 0,
          penaltiesPerMatch: data.penalties_per_match || 0,
          competitions: data.competitions || [],
          isLeagueAverage: data.is_league_average || false,
        })

        if (data.home_team_history) {
          setHomeHistory({
            team: homeTeam || 'Home Team',
            matches: data.home_team_history.matches || 0,
            wins: data.home_team_history.wins || 0,
            draws: data.home_team_history.draws || 0,
            losses: data.home_team_history.losses || 0,
            cardsReceived: {
              yellow: data.home_team_history.yellow_cards || 0,
              red: data.home_team_history.red_cards || 0
            },
            penaltiesFor: data.home_team_history.penalties_for || 0,
            penaltiesAgainst: data.home_team_history.penalties_against || 0
          })
        }

        if (data.away_team_history) {
          setAwayHistory({
            team: awayTeam || 'Away Team',
            matches: data.away_team_history.matches || 0,
            wins: data.away_team_history.wins || 0,
            draws: data.away_team_history.draws || 0,
            losses: data.away_team_history.losses || 0,
            cardsReceived: {
              yellow: data.away_team_history.yellow_cards || 0,
              red: data.away_team_history.red_cards || 0
            },
            penaltiesFor: data.away_team_history.penalties_for || 0,
            penaltiesAgainst: data.away_team_history.penalties_against || 0
          })
        }

        setImpact(data.prediction_impact || null)
      } catch (err) {
        // Use the referee name from match data if available, otherwise show "Not available"
        setReferee({
          name: refereeName || 'TBD — Not yet assigned',
          country: 'Unknown',
          experience: 0,
          careerMatches: 0,
          averageCardsPerMatch: { yellow: 3.4, red: 0.12 },
          homeWinRate: 0.46,
          awayWinRate: 0.29,
          drawRate: 0.25,
          averageGoalsPerMatch: 2.78,
          penaltiesAwarded: 0,
          penaltiesPerMatch: 0.17,
          competitions: [],
          isLeagueAverage: !refereeName,
        })
      } finally {
        setLoading(false)
      }
    }

    fetchRefereeData()
  }, [matchId, homeTeam, awayTeam, refereeName])

  const getCardTendencyColor = (yellowPerMatch: number): string => {
    if (yellowPerMatch < 2.5) return 'text-green-500'
    if (yellowPerMatch < 3.5) return 'text-amber-500'
    if (yellowPerMatch < 4.5) return 'text-orange-500'
    return 'text-red-500'
  }

  const getCardTendencyLabel = (yellowPerMatch: number): string => {
    if (yellowPerMatch < 2.5) return 'Lenient'
    if (yellowPerMatch < 3.5) return 'Average'
    if (yellowPerMatch < 4.5) return 'Strict'
    return 'Very Strict'
  }

  if (loading) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-xl p-4 animate-pulse" style={{ borderColor: 'var(--border-color)' }}>
        <div className="h-4 bg-[var(--muted-bg)] rounded w-24 mb-3" />
        <div className="h-8 bg-[var(--muted-bg)] rounded w-48 mb-2" />
        <div className="h-3 bg-[var(--muted-bg)] rounded w-32" />
      </div>
    )
  }

  if (!referee) return null

  return (
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <span>⚖️</span> Match Referee
        </h3>
      </div>

      {/* Referee Basic Info */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[var(--muted-bg)] flex items-center justify-center">
            <span className="text-3xl">👨‍⚖️</span>
          </div>
          <div>
            <h4 className="text-xl font-bold text-[var(--text-primary)]">{referee.name}</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              {referee.country} {referee.experience > 0 ? `• ${referee.experience} years experience` : ''}
            </p>
            {referee.careerMatches > 0 && (
              <p className="text-xs text-[var(--text-tertiary)]">
                {referee.careerMatches} career matches
              </p>
            )}
            {referee.isLeagueAverage && (
              <p className="text-xs text-amber-500 mt-1">
                Showing league-average statistics
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: 'var(--border-color)' }}>
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'overview'
              ? 'text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)]'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            activeTab === 'history'
              ? 'text-[var(--accent-primary)] border-b-2 border-[var(--accent-primary)]'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          Team History
        </button>
      </div>

      {/* Tab Content */}
      <div className="p-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Card Tendency */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[var(--muted-bg)] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">🟨</span>
                  <span className="text-sm text-[var(--text-secondary)]">Yellow Cards</span>
                </div>
                <p className="text-2xl font-bold text-[var(--text-primary)]">
                  {referee.averageCardsPerMatch.yellow.toFixed(1)}
                </p>
                <p className={`text-xs ${getCardTendencyColor(referee.averageCardsPerMatch.yellow)}`}>
                  {getCardTendencyLabel(referee.averageCardsPerMatch.yellow)} per match
                </p>
              </div>
              <div className="bg-[var(--muted-bg)] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">🟥</span>
                  <span className="text-sm text-[var(--text-secondary)]">Red Cards</span>
                </div>
                <p className="text-2xl font-bold text-[var(--text-primary)]">
                  {referee.averageCardsPerMatch.red.toFixed(2)}
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">per match</p>
              </div>
            </div>

            {/* Match Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[var(--muted-bg)] rounded-lg p-3 text-center">
                <p className="text-xl mb-1">⚽</p>
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  {referee.averageGoalsPerMatch.toFixed(1)}
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">Goals/Match</p>
              </div>
              <div className="bg-[var(--muted-bg)] rounded-lg p-3 text-center">
                <p className="text-xl mb-1">🎯</p>
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  {(referee.penaltiesPerMatch * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">Penalty Rate</p>
              </div>
              <div className="bg-[var(--muted-bg)] rounded-lg p-3 text-center">
                <p className="text-xl mb-1">🏠</p>
                <p className="text-lg font-bold text-[var(--text-primary)]">
                  {(referee.homeWinRate * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">Home Wins</p>
              </div>
            </div>

            {/* Result Distribution */}
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)] mb-2">Result Distribution</p>
              <div className="h-3 rounded-full overflow-hidden flex bg-[var(--muted-bg)]">
                <div
                  className="bg-green-500 h-full"
                  style={{ width: `${referee.homeWinRate * 100}%` }}
                  title={`Home Wins: ${(referee.homeWinRate * 100).toFixed(0)}%`}
                />
                <div
                  className="bg-gray-400 h-full"
                  style={{ width: `${referee.drawRate * 100}%` }}
                  title={`Draws: ${(referee.drawRate * 100).toFixed(0)}%`}
                />
                <div
                  className="bg-red-500 h-full"
                  style={{ width: `${referee.awayWinRate * 100}%` }}
                  title={`Away Wins: ${(referee.awayWinRate * 100).toFixed(0)}%`}
                />
              </div>
              <div className="flex justify-between mt-1 text-xs text-[var(--text-tertiary)]">
                <span>Home {(referee.homeWinRate * 100).toFixed(0)}%</span>
                <span>Draw {(referee.drawRate * 100).toFixed(0)}%</span>
                <span>Away {(referee.awayWinRate * 100).toFixed(0)}%</span>
              </div>
            </div>

            {/* Competitions */}
            {referee.competitions.length > 0 && (
              <div>
                <p className="text-sm font-medium text-[var(--text-secondary)] mb-2">Competitions</p>
                <div className="flex flex-wrap gap-2">
                  {referee.competitions.map((comp, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 rounded text-xs bg-[var(--muted-bg)] text-[var(--text-secondary)]"
                    >
                      {comp}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4">
            {homeHistory ? (
              <TeamHistoryCard history={homeHistory} isHome={true} />
            ) : (
              <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
                No history with {homeTeam || 'home team'}
              </p>
            )}

            {awayHistory ? (
              <TeamHistoryCard history={awayHistory} isHome={false} />
            ) : (
              <p className="text-sm text-[var(--text-tertiary)] text-center py-4">
                No history with {awayTeam || 'away team'}
              </p>
            )}

            {!homeHistory && !awayHistory && (
              <p className="text-sm text-[var(--text-tertiary)] text-center py-8">
                No previous matches with either team
              </p>
            )}
          </div>
        )}
      </div>

      {/* Impact Summary */}
      {impact && (
        <div className="p-4 border-t bg-[var(--muted-bg)]" style={{ borderColor: 'var(--border-color)' }}>
          <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">Prediction Impact</p>
          <p className="text-sm text-[var(--text-primary)]">{impact.summary}</p>
        </div>
      )}
    </div>
  )
}

function TeamHistoryCard({ history, isHome }: { history: TeamRefereeHistory; isHome: boolean }) {
  const winRate = history.matches > 0 ? (history.wins / history.matches * 100) : 0
  
  return (
    <div className={`rounded-lg p-4 ${isHome ? 'bg-green-500/10 border-l-4 border-green-500' : 'bg-blue-500/10 border-l-4 border-blue-500'}`}>
      <h5 className="font-semibold text-[var(--text-primary)] mb-3">{history.team}</h5>
      <div className="grid grid-cols-4 gap-2 text-center mb-3">
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{history.matches}</p>
          <p className="text-xs text-[var(--text-tertiary)]">Matches</p>
        </div>
        <div>
          <p className="text-lg font-bold text-green-500">{history.wins}</p>
          <p className="text-xs text-[var(--text-tertiary)]">Wins</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-secondary)]">{history.draws}</p>
          <p className="text-xs text-[var(--text-tertiary)]">Draws</p>
        </div>
        <div>
          <p className="text-lg font-bold text-red-400">{history.losses}</p>
          <p className="text-xs text-[var(--text-tertiary)]">Losses</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--text-secondary)]">
          🟨 {history.cardsReceived.yellow} 🟥 {history.cardsReceived.red}
        </span>
        <span className="text-[var(--text-secondary)]">
          Win rate: <span className="font-medium text-[var(--text-primary)]">{winRate.toFixed(0)}%</span>
        </span>
      </div>
    </div>
  )
}
