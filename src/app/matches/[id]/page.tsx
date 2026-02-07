'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import FormationDisplay, { PitchBackground, SubstitutesBench } from '@/components/lineup/FormationDisplay'
import MatchWeather from '@/components/weather/MatchWeather'
import { HeadToHeadDisplay } from '@/components/match'

interface MatchEvent {
  type: 'goal' | 'assist' | 'yellow_card' | 'red_card' | 'substitution' | 'var' | 'penalty_missed' | 'own_goal'
  minute: number
  addedTime?: number
  player: string
  team: 'home' | 'away'
  relatedPlayer?: string
  description?: string
}

interface TeamStanding {
  position: number
  played: number
  won: number
  drawn: number
  lost: number
  points: number
  teamName?: string
}

interface PlayerLineup {
  name: string
  position?: string
  jersey?: number
}

interface MatchDetails {
  id: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  status: string
  minute?: number
  addedTime?: number
  venue?: string
  date: string
  league: string
  leagueId?: string
  referee?: string
  events: MatchEvent[]
  lineups: {
    home: PlayerLineup[]
    away: PlayerLineup[]
    homeFormation?: string
    awayFormation?: string
  }
  stats: {
    possession: [number, number]
    shots: [number, number]
    shotsOnTarget: [number, number]
    corners: [number, number]
    fouls: [number, number]
  }
  h2h: {
    homeWins: number
    draws: number
    awayWins: number
    recentMatches: { home_score: number; away_score: number; date: string; homeTeam?: string; awayTeam?: string }[]
  }
  homeStanding?: TeamStanding
  awayStanding?: TeamStanding
  fullStandings?: TeamStanding[]
  nextResumeTime?: Date
  prediction?: {
    home_win: number
    draw: number
    away_win: number
    predicted_score: { home: number; away: number }
    confidence: number
  }
  commentary?: { minute: number; text: string }[]
}

export default function MatchDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const matchId = params.id as string
  const leagueId = searchParams.get('league') || ''
  
  const [match, setMatch] = useState<MatchDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'summary' | 'lineup' | 'stats' | 'h2h'>('summary')
  const [halftimeCountdown, setHalftimeCountdown] = useState<string>('')
  const [retryCount, setRetryCount] = useState(0) // Used to trigger refetch

  // Derived state for live status - compute before hooks that depend on it
  const isLive = match?.status?.includes('IN_PROGRESS') || match?.status?.includes('HALF') || match?.status?.includes('LIVE') || false
  const isHalftime = match?.status?.toLowerCase().includes('half') && !match?.status?.toLowerCase().includes('first') && !match?.status?.toLowerCase().includes('second') || false

  // Halftime countdown effect - must be before early returns
  useEffect(() => {
    if (!isHalftime) {
      setHalftimeCountdown('')
      return
    }
    
    const estimatedResumeTime = new Date()
    estimatedResumeTime.setMinutes(estimatedResumeTime.getMinutes() + 10)
    
    const updateCountdown = () => {
      const now = new Date()
      const diff = estimatedResumeTime.getTime() - now.getTime()
      
      if (diff <= 0) {
        setHalftimeCountdown('Resuming soon...')
        return
      }
      
      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)
      setHalftimeCountdown(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }
    
    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [isHalftime])

  useEffect(() => {
    const fetchMatchDetails = async () => {
      try {
        // Use our server-side API proxy to fetch match details
        // This avoids CORS issues and handles fallbacks between ESPN and FotMob
        const url = `/api/match/${matchId}${leagueId ? `?league=${leagueId}` : ''}`
        const res = await fetch(url)
        
        if (!res.ok) {
          console.error('Match not found:', res.status)
          setMatch(null)
          setLoading(false)
          return
        }
        
        const data = await res.json()
        
        // Map the API response to MatchDetails format
        const matchDetails: MatchDetails = {
          id: data.id,
          home_team: data.home_team,
          away_team: data.away_team,
          home_score: data.home_score,
          away_score: data.away_score,
          status: data.status === 'finished' ? 'STATUS_FINAL' : 
                  data.status === 'live' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED',
          minute: data.minute,
          venue: data.venue,
          date: data.date,
          league: data.league,
          leagueId: data.leagueId,
          referee: data.referee,
          events: (data.events || []).map((e: { type: string; minute: number; addedTime?: number; player: string; team: string; relatedPlayer?: string }) => ({
            type: e.type as MatchEvent['type'],
            minute: e.minute,
            addedTime: e.addedTime,
            player: e.player,
            team: e.team as 'home' | 'away',
            relatedPlayer: e.relatedPlayer,
          })),
          lineups: {
            home: data.lineups?.home || [],
            away: data.lineups?.away || [],
            homeFormation: data.lineups?.homeFormation,
            awayFormation: data.lineups?.awayFormation,
          },
          stats: data.stats || {
            possession: [50, 50],
            shots: [0, 0],
            shotsOnTarget: [0, 0],
            corners: [0, 0],
            fouls: [0, 0],
          },
          h2h: data.h2h || {
            homeWins: 0,
            draws: 0,
            awayWins: 0,
            recentMatches: [],
          },
          prediction: data.prediction,
          commentary: data.commentary || [],
        }
        
        // Try to fetch standings for team positions
        if (data.leagueId) {
          try {
            const standingsRes = await fetch(
              `https://site.api.espn.com/apis/v2/sports/soccer/${data.leagueId}/standings`
            )
            if (standingsRes.ok) {
              const standingsData = await standingsRes.json()
              const entries = standingsData.children?.[0]?.standings?.entries || []
              
              const homeTeamName = matchDetails.home_team.toLowerCase()
              const awayTeamName = matchDetails.away_team.toLowerCase()
              
              const fullStandings: TeamStanding[] = []
              
              for (let i = 0; i < entries.length; i++) {
                const entry = entries[i]
                const teamDisplayName = entry.team?.displayName || 'Unknown'
                const teamName = teamDisplayName.toLowerCase()
                
                const getStatVal = (name: string) => {
                  const stat = entry.stats?.find((s: { name: string }) => s.name === name)
                  return parseInt(stat?.value || '0', 10)
                }
                
                const standing: TeamStanding = {
                  position: i + 1,
                  played: getStatVal('gamesPlayed'),
                  won: getStatVal('wins'),
                  drawn: getStatVal('ties'),
                  lost: getStatVal('losses'),
                  points: getStatVal('points'),
                  teamName: teamDisplayName,
                }
                
                fullStandings.push(standing)
                
                if (teamName.includes(homeTeamName) || homeTeamName.includes(teamName)) {
                  matchDetails.homeStanding = standing
                }
                if (teamName.includes(awayTeamName) || awayTeamName.includes(teamName)) {
                  matchDetails.awayStanding = standing
                }
              }
              
              matchDetails.fullStandings = fullStandings
            }
          } catch {
            // Standings not available, continue without them
          }
        }
        
        setMatch(matchDetails)
      } catch (e) {
        console.error('Error fetching match details:', e)
        setMatch(null)
      } finally {
        setLoading(false)
      }
    }

    if (matchId) {
      fetchMatchDetails()
    }
  }, [matchId, leagueId, retryCount]) // retryCount triggers refetch when incremented

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    } catch {
      return dateStr
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--background)' }}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500" />
      </div>
    )
  }

  if (!match) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--background)' }}>
        <div className="text-center max-w-md mx-auto px-4">
          <span className="text-5xl mb-4 block">⚽</span>
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Match Not Available</h2>
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            We couldn&apos;t load details for this match. This might be because:
          </p>
          <ul className="text-left mb-6 space-y-2" style={{ color: 'var(--text-tertiary)' }}>
            <li className="flex items-start gap-2">
              <span>•</span>
              <span>The match hasn&apos;t started yet and detailed data isn&apos;t available</span>
            </li>
            <li className="flex items-start gap-2">
              <span>•</span>
              <span>The match ID has changed or is from a different data source</span>
            </li>
            <li className="flex items-start gap-2">
              <span>•</span>
              <span>Our data providers are temporarily unavailable</span>
            </li>
          </ul>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link 
              href="/matches" 
              className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
            >
              ← Browse Leagues
            </Link>
            <button
              onClick={() => {
                setLoading(true)
                setRetryCount(prev => prev + 1) // Trigger refetch without full page reload
              }}
              className="px-6 py-3 rounded-xl border font-semibold transition-colors hover:bg-[var(--muted-bg)]"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              🔄 Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Additional derived state (isLive and isHalftime already computed above before hooks)
  const isScheduled = match.status.toLowerCase().includes('scheduled') || match.status.toLowerCase().includes('pre')
  const isFinished = match.status.includes('FINAL') || match.status.toLowerCase().includes('finished') || match.status.toLowerCase().includes('ft')

  // Helper function to evaluate prediction accuracy
  const getPredictionAccuracy = (): { type: 'exact' | 'close' | 'miss'; message: string } => {
    if (!match.prediction || match.home_score === null || match.away_score === null) {
      return { type: 'miss', message: '' }
    }
    
    const predictedHome = match.prediction.predicted_score.home
    const predictedAway = match.prediction.predicted_score.away
    const actualHome = match.home_score
    const actualAway = match.away_score
    
    // Exact score match
    if (predictedHome === actualHome && predictedAway === actualAway) {
      return { type: 'exact', message: '✅ Exact prediction!' }
    }
    
    // Close prediction: goal difference within 1
    const predictedDiff = predictedHome - predictedAway
    const actualDiff = actualHome - actualAway
    if (Math.abs(predictedDiff - actualDiff) <= 1) {
      return { type: 'close', message: '⚡ Close prediction' }
    }
    
    return { type: 'miss', message: `Actual: ${actualHome} - ${actualAway}` }
  }

  // Navigate back to the league page - go directly to full league page
  const handleBack = () => {
    if (leagueId) {
      router.push(`/leagues/${leagueId}`)
    } else {
      router.back()
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      {/* Header */}
      <div style={{ backgroundColor: 'var(--card-bg)', borderBottom: '1px solid var(--border-color)' }}>
        <div className="max-w-4xl mx-auto px-4 py-4">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 hover:opacity-80 mb-4 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to {match.league || 'leagues'}
          </button>
          
          {/* Match Header - Centered */}
          <div className="text-center">
            <p className="text-sm font-medium mb-4 text-center" style={{ color: 'var(--text-secondary)' }}>{match.league}</p>
            
            <div className="flex items-center justify-center gap-4 md:gap-8">
              <div className="flex-1 text-right">
                <p className="text-lg md:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{match.home_team}</p>
              </div>
              
              <div className="text-center px-4 md:px-8">
                {/* Live indicator */}
                {isLive && !isHalftime && (
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-red-500 text-sm font-bold">LIVE</span>
                    <span className="text-red-400 text-sm font-bold">{match.minute}&apos;</span>
                  </div>
                )}
                
                {/* Halftime indicator with countdown */}
                {isHalftime && (
                  <div className="mb-2 space-y-1">
                    <div className="flex items-center justify-center gap-2">
                      <span className="px-2 py-1 bg-amber-500/20 text-amber-500 rounded text-sm font-bold">HALF TIME</span>
                    </div>
                    {halftimeCountdown && (
                      <p className="text-xs text-[var(--text-tertiary)]">
                        Resumes in: <span className="font-mono text-amber-400">{halftimeCountdown}</span>
                      </p>
                    )}
                  </div>
                )}
                
                <div className="text-4xl md:text-5xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {isScheduled ? 'vs' : `${match.home_score} - ${match.away_score}`}
                </div>
                
                {isFinished && (
                  <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>Full Time</p>
                )}
                {isScheduled && (
                  <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>Upcoming</p>
                )}
              </div>
              
              <div className="flex-1 text-left">
                <p className="text-lg md:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{match.away_team}</p>
              </div>
            </div>
            
            <p className="text-sm mt-4 text-center" style={{ color: 'var(--text-tertiary)' }}>{formatDate(match.date)}</p>
            {match.venue && (
              <p className="text-sm text-center" style={{ color: 'var(--text-tertiary)' }}>📍 {match.venue}</p>
            )}
            
            {/* ML Prediction Card - shown for all matches */}
            {match.prediction && (
              <div className="mt-4 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/30 rounded-xl p-4">
                <div className="flex items-center justify-center gap-2 mb-3">
                  <span className="text-lg">🤖</span>
                  <span className="text-sm font-semibold text-indigo-400">AI Prediction</span>
                  <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full">
                    {match.prediction.confidence}% confidence
                  </span>
                </div>
                
                <div className="flex items-center justify-center gap-6">
                  {/* Predicted Score */}
                  <div className="text-center">
                    <p className="text-xs text-[var(--text-tertiary)] mb-1">Predicted Score</p>
                    <p className="text-2xl font-bold text-indigo-400">
                      {match.prediction.predicted_score.home} - {match.prediction.predicted_score.away}
                    </p>
                  </div>
                  
                  <div className="h-10 w-px bg-[var(--border-color)]" />
                  
                  {/* Win Probabilities */}
                  <div className="flex gap-3">
                    <div className="text-center">
                      <p className="text-xs text-[var(--text-tertiary)] mb-1">Home</p>
                      <p className={`text-lg font-bold ${match.prediction.home_win > match.prediction.away_win ? 'text-green-500' : 'text-[var(--text-secondary)]'}`}>
                        {Math.round(match.prediction.home_win * 100)}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-[var(--text-tertiary)] mb-1">Draw</p>
                      <p className="text-lg font-bold text-[var(--text-secondary)]">
                        {Math.round(match.prediction.draw * 100)}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-[var(--text-tertiary)] mb-1">Away</p>
                      <p className={`text-lg font-bold ${match.prediction.away_win > match.prediction.home_win ? 'text-green-500' : 'text-[var(--text-secondary)]'}`}>
                        {Math.round(match.prediction.away_win * 100)}%
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Comparison with actual result for finished matches */}
                {isFinished && match.home_score !== null && match.away_score !== null && (() => {
                  const accuracy = getPredictionAccuracy()
                  return (
                    <div className="mt-3 pt-3 border-t border-indigo-500/20">
                      <div className="flex items-center justify-center gap-2 text-xs">
                        <span className={`font-semibold ${
                          accuracy.type === 'exact' ? 'text-green-500' : 
                          accuracy.type === 'close' ? 'text-amber-500' : 
                          'text-[var(--text-tertiary)]'
                        }`}>
                          {accuracy.message}
                        </span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-[var(--background-secondary)] border-b sticky top-16 z-10" style={{ borderColor: 'var(--border-color)' }}>
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex gap-4 overflow-x-auto justify-center">
            {['summary', 'lineup', 'stats', 'h2h'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`py-4 px-2 font-medium capitalize transition-colors border-b-2 whitespace-nowrap ${
                  activeTab === tab
                    ? 'text-[var(--accent-primary)] border-[var(--accent-primary)]'
                    : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]'
                }`}
              >
                {tab === 'h2h' ? 'H2H & Form' : tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {activeTab === 'summary' && (
          <div className="space-y-6">
            {/* Match Info Card (Venue, Referee, Weather) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Venue Info */}
              <div className="bg-[var(--card-bg)] border rounded-xl p-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <span className="text-xl">📍</span>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)]">Venue</p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{match.venue || 'Not announced'}</p>
                  </div>
                </div>
              </div>
              
              {/* Referee Info */}
              <div className="bg-[var(--card-bg)] border rounded-xl p-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                    <span className="text-xl">👨‍⚖️</span>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)]">Referee</p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {match.referee || (isScheduled ? 'Not yet assigned' : 'Not available')}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Date/Time */}
              <div className="bg-[var(--card-bg)] border rounded-xl p-4" style={{ borderColor: 'var(--border-color)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                    <span className="text-xl">📅</span>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-tertiary)]">Date</p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{formatDate(match.date)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Weather - spans full width */}
            <MatchWeather 
              matchId={matchId}
              venue={match.venue}
              homeTeam={match.home_team}
              awayTeam={match.away_team}
            />

            {/* Event Summary Card */}
            {match.events.length > 0 && (
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)]">Match Summary</h3>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-6">
                    {/* Home Team Summary */}
                    <div>
                      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-3">{match.home_team}</h4>
                      <div className="space-y-2">
                        {/* Goals */}
                        {match.events.filter(e => e.team === 'home' && (e.type === 'goal' || e.type === 'own_goal')).length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {match.events
                              .filter(e => e.team === 'home' && (e.type === 'goal' || e.type === 'own_goal'))
                              .map((e, i) => (
                                <div key={i} className="text-sm">
                                  <span className="text-[var(--text-primary)]">
                                    {e.type === 'own_goal' ? '⚽🔴' : '⚽'} {e.player}
                                  </span>
                                  <span className="text-[var(--text-tertiary)]"> {e.minute}&apos;{e.addedTime ? `+${e.addedTime}` : ''}</span>
                                  {e.relatedPlayer && (
                                    <span className="text-[var(--text-tertiary)] text-xs ml-1">(assist: {e.relatedPlayer})</span>
                                  )}
                                </div>
                              ))}
                          </div>
                        )}
                        {/* Cards */}
                        {match.events.filter(e => e.team === 'home' && (e.type === 'yellow_card' || e.type === 'red_card')).length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {match.events
                              .filter(e => e.team === 'home' && (e.type === 'yellow_card' || e.type === 'red_card'))
                              .map((e, i) => (
                                <span key={i} className="text-xs text-[var(--text-secondary)] bg-[var(--muted-bg)] px-2 py-1 rounded">
                                  {e.type === 'yellow_card' ? '🟨' : '🟥'} {e.player} {e.minute}&apos;
                                </span>
                              ))}
                          </div>
                        )}
                        {/* Substitutions */}
                        {match.events.filter(e => e.team === 'home' && e.type === 'substitution').length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {match.events
                              .filter(e => e.team === 'home' && e.type === 'substitution')
                              .map((e, i) => (
                                <span key={i} className="text-xs text-[var(--text-secondary)] bg-[var(--muted-bg)] px-2 py-1 rounded">
                                  🔄 {e.player} ↔ {e.relatedPlayer || '?'} {e.minute}&apos;
                                </span>
                              ))}
                          </div>
                        )}
                        {match.events.filter(e => e.team === 'home').length === 0 && (
                          <p className="text-sm text-[var(--text-tertiary)]">No notable events</p>
                        )}
                      </div>
                    </div>
                    
                    {/* Away Team Summary */}
                    <div>
                      <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-3">{match.away_team}</h4>
                      <div className="space-y-2">
                        {/* Goals */}
                        {match.events.filter(e => e.team === 'away' && (e.type === 'goal' || e.type === 'own_goal')).length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {match.events
                              .filter(e => e.team === 'away' && (e.type === 'goal' || e.type === 'own_goal'))
                              .map((e, i) => (
                                <div key={i} className="text-sm">
                                  <span className="text-[var(--text-primary)]">
                                    {e.type === 'own_goal' ? '⚽🔴' : '⚽'} {e.player}
                                  </span>
                                  <span className="text-[var(--text-tertiary)]"> {e.minute}&apos;{e.addedTime ? `+${e.addedTime}` : ''}</span>
                                  {e.relatedPlayer && (
                                    <span className="text-[var(--text-tertiary)] text-xs ml-1">(assist: {e.relatedPlayer})</span>
                                  )}
                                </div>
                              ))}
                          </div>
                        )}
                        {/* Cards */}
                        {match.events.filter(e => e.team === 'away' && (e.type === 'yellow_card' || e.type === 'red_card')).length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {match.events
                              .filter(e => e.team === 'away' && (e.type === 'yellow_card' || e.type === 'red_card'))
                              .map((e, i) => (
                                <span key={i} className="text-xs text-[var(--text-secondary)] bg-[var(--muted-bg)] px-2 py-1 rounded">
                                  {e.type === 'yellow_card' ? '🟨' : '🟥'} {e.player} {e.minute}&apos;
                                </span>
                              ))}
                          </div>
                        )}
                        {/* Substitutions */}
                        {match.events.filter(e => e.team === 'away' && e.type === 'substitution').length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {match.events
                              .filter(e => e.team === 'away' && e.type === 'substitution')
                              .map((e, i) => (
                                <span key={i} className="text-xs text-[var(--text-secondary)] bg-[var(--muted-bg)] px-2 py-1 rounded">
                                  🔄 {e.player} ↔ {e.relatedPlayer || '?'} {e.minute}&apos;
                                </span>
                              ))}
                          </div>
                        )}
                        {match.events.filter(e => e.team === 'away').length === 0 && (
                          <p className="text-sm text-[var(--text-tertiary)]">No notable events</p>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Quick Stats Row */}
                  <div className="flex justify-center gap-8 mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-[var(--accent-primary)]">
                        {match.events.filter(e => e.team === 'home' && (e.type === 'goal' || e.type === 'own_goal')).length}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)]">Goals</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-amber-500">
                        {match.events.filter(e => e.team === 'home' && e.type === 'yellow_card').length}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)]">Yellow</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-red-500">
                        {match.events.filter(e => e.team === 'home' && e.type === 'red_card').length}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)]">Red</p>
                    </div>
                    <div className="h-8 w-px bg-[var(--border-color)]" />
                    <div className="text-center">
                      <p className="text-2xl font-bold text-emerald-500">
                        {match.events.filter(e => e.team === 'away' && (e.type === 'goal' || e.type === 'own_goal')).length}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)]">Goals</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-amber-500">
                        {match.events.filter(e => e.team === 'away' && e.type === 'yellow_card').length}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)]">Yellow</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-red-500">
                        {match.events.filter(e => e.team === 'away' && e.type === 'red_card').length}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)]">Red</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Timeline Header */}
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Match Timeline</h3>
            
            {match.events.length > 0 ? (
              <div className="relative">
                {/* Center timeline line */}
                <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[var(--border-color)] transform -translate-x-1/2" />
                
                <div className="space-y-4">
                  {match.events.sort((a, b) => a.minute - b.minute).map((event, idx) => (
                    <div
                      key={idx}
                      className="relative flex items-center"
                    >
                      {/* Home team event (left side) */}
                      {event.team === 'home' && (
                        <div className="flex-1 flex justify-end pr-8">
                          <div className="bg-[var(--card-bg)] border rounded-xl p-3 max-w-xs" style={{ borderColor: 'var(--border-color)' }}>
                            <p className="text-[var(--text-primary)] font-medium">
                              {event.type === 'goal' && '⚽ '}
                              {event.type === 'yellow_card' && '🟨 '}
                              {event.type === 'red_card' && '🟥 '}
                              {event.player}
                            </p>
                            {event.relatedPlayer && (
                              <p className="text-[var(--text-secondary)] text-xs mt-1">Assist: {event.relatedPlayer}</p>
                            )}
                          </div>
                        </div>
                      )}
                      {event.team === 'away' && <div className="flex-1" />}
                      
                      {/* Center minute marker */}
                      <div className="absolute left-1/2 transform -translate-x-1/2 z-10">
                        <div className="w-10 h-10 rounded-full bg-[var(--accent-primary)] flex items-center justify-center text-white font-bold text-sm shadow-lg">
                          {event.minute}&apos;
                        </div>
                      </div>
                      
                      {/* Away team event (right side) */}
                      {event.team === 'home' && <div className="flex-1" />}
                      {event.team === 'away' && (
                        <div className="flex-1 flex justify-start pl-8">
                          <div className="bg-[var(--card-bg)] border rounded-xl p-3 max-w-xs" style={{ borderColor: 'var(--border-color)' }}>
                            <p className="text-[var(--text-primary)] font-medium">
                              {event.type === 'goal' && '⚽ '}
                              {event.type === 'yellow_card' && '🟨 '}
                              {event.type === 'red_card' && '🟥 '}
                              {event.player}
                            </p>
                            {event.relatedPlayer && (
                              <p className="text-[var(--text-secondary)] text-xs mt-1">Assist: {event.relatedPlayer}</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* Full Time marker */}
                {match.status.includes('FINAL') && (
                  <div className="relative flex items-center justify-center mt-6">
                    <div className="px-4 py-2 bg-[var(--muted-bg)] rounded-full text-sm text-[var(--text-secondary)] font-medium">
                      Full Time
                    </div>
                  </div>
                )}
              </div>
            ) : match.status.includes('scheduled') ? (
              <div className="text-center py-12">
                <span className="text-4xl mb-4 block">⏳</span>
                <p className="text-[var(--text-secondary)]">Match not started yet</p>
                <p className="text-[var(--text-tertiary)] text-sm mt-2">
                  Events will appear here once the match starts
                </p>
              </div>
            ) : null}
            
            {/* Commentary Section - FotMob-style */}
            {match.commentary && match.commentary.length > 0 && (
              <div className="mt-6">
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">📝 Match Commentary</h3>
                <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="max-h-[400px] overflow-y-auto">
                    {match.commentary
                      .sort((a, b) => b.minute - a.minute)
                      .map((item, idx) => (
                        <div 
                          key={idx} 
                          className="p-4 border-b last:border-b-0 hover:bg-[var(--muted-bg)] transition-colors"
                          style={{ borderColor: 'var(--border-color)' }}
                        >
                          <div className="flex gap-4">
                            <div className="flex-shrink-0">
                              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] font-bold text-sm">
                                {item.minute}&apos;
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-[var(--text-primary)]">{item.text}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'lineup' && (
          <div className="space-y-6">
            {/* Formation display - Lineup tab only shows formations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Home Team Formation */}
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)]">{match.home_team}</h3>
                  {match.lineups.homeFormation && (
                    <span className="text-sm font-mono px-3 py-1 rounded-full bg-blue-500/20 text-blue-500">
                      {match.lineups.homeFormation}
                    </span>
                  )}
                </div>
                
                {/* Pitch visualization with improved component */}
                <PitchBackground>
                  <FormationDisplay
                    players={match.lineups.home}
                    formation={match.lineups.homeFormation}
                    teamName={match.home_team}
                    teamColor="blue"
                  />
                </PitchBackground>
                
                {/* Substitutes */}
                {match.lineups.home.length > 11 && (
                  <SubstitutesBench players={match.lineups.home.slice(11)} />
                )}
                
                {/* Player list */}
                <div className="p-4 max-h-[200px] overflow-y-auto border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">Starting XI</p>
                  <div className="space-y-1">
                    {match.lineups.home.slice(0, 11).map((player, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">{player.jersey || idx + 1}</span>
                          <span className="text-[var(--text-primary)]">{player.name}</span>
                        </div>
                        {player.position && (
                          <span className="text-xs text-[var(--text-tertiary)] bg-[var(--muted-bg)] px-2 py-0.5 rounded">{player.position}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Away Team Formation */}
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)]">{match.away_team}</h3>
                  {match.lineups.awayFormation && (
                    <span className="text-sm font-mono px-3 py-1 rounded-full bg-orange-500/20 text-orange-500">
                      {match.lineups.awayFormation}
                    </span>
                  )}
                </div>
                
                {/* Pitch visualization with improved component */}
                <PitchBackground>
                  <FormationDisplay
                    players={match.lineups.away}
                    formation={match.lineups.awayFormation}
                    teamName={match.away_team}
                    teamColor="orange"
                  />
                </PitchBackground>
                
                {/* Substitutes */}
                {match.lineups.away.length > 11 && (
                  <SubstitutesBench players={match.lineups.away.slice(11)} />
                )}
                
                {/* Player list */}
                <div className="p-4 max-h-[200px] overflow-y-auto border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <p className="text-xs text-[var(--text-tertiary)] mb-2">Starting XI</p>
                  <div className="space-y-1">
                    {match.lineups.away.slice(0, 11).map((player, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center">{player.jersey || idx + 1}</span>
                          <span className="text-[var(--text-primary)]">{player.name}</span>
                        </div>
                        {player.position && (
                          <span className="text-xs text-[var(--text-tertiary)] bg-[var(--muted-bg)] px-2 py-0.5 rounded">{player.position}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Match Statistics</h3>
            
            {[
              { label: 'Possession', values: match.stats.possession, suffix: '%', inverse: false },
              { label: 'Total Shots', values: match.stats.shots, inverse: false },
              { label: 'Shots on Target', values: match.stats.shotsOnTarget, inverse: false },
              { label: 'Corners', values: match.stats.corners, inverse: false },
              { label: 'Fouls', values: match.stats.fouls, inverse: true }, // Lower is better
            ].map((stat) => {
              const total = stat.values[0] + stat.values[1] || 1
              const homePercent = (stat.values[0] / total) * 100
              const awayPercent = (stat.values[1] / total) * 100
              // Determine which team is "winning" this stat (for fouls, less is better)
              const homeWinning = stat.inverse ? stat.values[0] < stat.values[1] : stat.values[0] > stat.values[1]
              const awayWinning = stat.inverse ? stat.values[1] < stat.values[0] : stat.values[1] > stat.values[0]
              const isTied = stat.values[0] === stat.values[1]
              
              return (
                <div key={stat.label}>
                  <div className="flex justify-between text-sm mb-2">
                    <span className={`font-medium ${homeWinning ? 'text-blue-500' : 'text-[var(--text-secondary)]'}`}>
                      {stat.values[0]}{stat.suffix || ''}
                    </span>
                    <span className="text-[var(--text-secondary)]">{stat.label}</span>
                    <span className={`font-medium ${awayWinning ? 'text-orange-500' : 'text-[var(--text-secondary)]'}`}>
                      {stat.values[1]}{stat.suffix || ''}
                    </span>
                  </div>
                  <div className="flex h-3 bg-[var(--muted-bg)] rounded-full overflow-hidden">
                    <div
                      className={`${isTied ? 'bg-gray-400' : homeWinning ? 'bg-blue-500' : 'bg-blue-500/30'} transition-all`}
                      style={{ width: `${homePercent}%` }}
                    />
                    <div
                      className={`${isTied ? 'bg-gray-400' : awayWinning ? 'bg-orange-500' : 'bg-orange-500/30'} transition-all`}
                      style={{ width: `${awayPercent}%` }}
                    />
                  </div>
                </div>
              )
            })}
            
            {/* Full League Standings Table */}
            <div className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-md font-medium text-[var(--text-primary)]">{match.league} Standings</h4>
                {!match.fullStandings?.length && (
                  <span className="text-xs text-[var(--text-tertiary)]">Data unavailable</span>
                )}
              </div>
              
              {match.fullStandings && match.fullStandings.length > 0 ? (
                <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-[var(--muted-bg)]">
                        <tr className="text-xs text-[var(--text-tertiary)] border-b" style={{ borderColor: 'var(--border-color)' }}>
                          <th className="text-left py-2 px-3 font-medium">#</th>
                          <th className="text-left py-2 px-3 font-medium">Team</th>
                          <th className="text-center py-2 px-3 font-medium">P</th>
                          <th className="text-center py-2 px-3 font-medium">W</th>
                          <th className="text-center py-2 px-3 font-medium">D</th>
                          <th className="text-center py-2 px-3 font-medium">L</th>
                          <th className="text-center py-2 px-3 font-medium">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {match.fullStandings.map((team) => {
                          // Compare by team name for reliable identification
                          const teamNameLower = (team.teamName || '').toLowerCase()
                          const homeTeamLower = match.home_team.toLowerCase()
                          const awayTeamLower = match.away_team.toLowerCase()
                          const isHomeTeam = teamNameLower.includes(homeTeamLower) || homeTeamLower.includes(teamNameLower)
                          const isAwayTeam = teamNameLower.includes(awayTeamLower) || awayTeamLower.includes(teamNameLower)
                          const isHighlighted = isHomeTeam || isAwayTeam
                          
                          return (
                            <tr
                              key={team.position}
                              className={`border-b text-sm transition-colors ${
                                isHighlighted 
                                  ? isHomeTeam 
                                    ? 'bg-blue-500/20 border-l-4 border-l-blue-500' 
                                    : 'bg-orange-500/20 border-l-4 border-l-orange-500'
                                  : 'hover:bg-[var(--muted-bg)]'
                              }`}
                              style={{ borderColor: 'var(--border-color)' }}
                            >
                              <td className={`py-2 px-3 ${isHighlighted ? 'font-bold' : ''}`} style={{ color: 'var(--text-secondary)' }}>
                                {team.position}
                              </td>
                              <td className={`py-2 px-3 ${isHighlighted ? 'font-bold text-blue-500' : 'font-medium'} ${isAwayTeam ? 'text-orange-500' : ''}`} style={{ color: isHighlighted ? undefined : 'var(--text-primary)' }}>
                                {team.teamName}
                                {isHighlighted && (
                                  <span className="ml-2 text-xs">
                                    {isHomeTeam ? '(H)' : '(A)'}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center" style={{ color: 'var(--text-secondary)' }}>{team.played}</td>
                              <td className="py-2 px-3 text-center text-green-500">{team.won}</td>
                              <td className="py-2 px-3 text-center" style={{ color: 'var(--text-tertiary)' }}>{team.drawn}</td>
                              <td className="py-2 px-3 text-center text-red-400">{team.lost}</td>
                              <td className={`py-2 px-3 text-center font-bold ${isHomeTeam ? 'text-blue-500' : ''} ${isAwayTeam ? 'text-orange-500' : ''}`} style={{ color: isHighlighted ? undefined : 'var(--text-primary)' }}>
                                {team.points}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Legend */}
                  <div className="p-3 border-t flex gap-4 text-xs" style={{ borderColor: 'var(--border-color)', color: 'var(--text-tertiary)' }}>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-blue-500/20 border-l-2 border-l-blue-500" />
                      <span>{match.home_team}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-orange-500/20 border-l-2 border-l-orange-500" />
                      <span>{match.away_team}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 bg-[var(--muted-bg)] rounded-xl">
                  <span className="text-3xl mb-3 block">📊</span>
                  <p className="text-[var(--text-secondary)]">League standings not available</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'h2h' && (
          <div className="space-y-6">
            {/* Use the new HeadToHeadDisplay component */}
            <HeadToHeadDisplay
              homeTeam={match.home_team}
              awayTeam={match.away_team}
              matchId={matchId}
              initialData={match.h2h.recentMatches.length > 0 ? {
                totalMatches: match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins,
                team1: {
                  name: match.home_team,
                  wins: match.h2h.homeWins,
                  goals: 0,
                  cleanSheets: 0,
                  homeWins: 0,
                  awayWins: 0,
                },
                team2: {
                  name: match.away_team,
                  wins: match.h2h.awayWins,
                  goals: 0,
                  cleanSheets: 0,
                  homeWins: 0,
                  awayWins: 0,
                },
                draws: match.h2h.draws,
                avgGoalsPerMatch: 0,
                recentForm: [],
                recentMatches: match.h2h.recentMatches.map((m, idx) => ({
                  id: `h2h-${idx}`,
                  date: m.date,
                  competition: '',
                  homeTeam: m.homeTeam || match.home_team,
                  awayTeam: m.awayTeam || match.away_team,
                  homeScore: m.home_score,
                  awayScore: m.away_score,
                  winner: m.home_score > m.away_score ? 'home' : m.away_score > m.home_score ? 'away' : 'draw',
                })),
                streaks: {
                  longestWinStreak: { team: match.home_team, count: 0 },
                },
              } : undefined}
            />
          </div>
        )}
      </div>
    </div>
  )
}
