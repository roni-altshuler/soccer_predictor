'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import FormationDisplay, { PitchBackground, SubstitutesBench } from '@/components/lineup/FormationDisplay'
import MatchWeather from '@/components/weather/MatchWeather'
import { HeadToHeadDisplay } from '@/components/match'
import KeyMatchFactors from '@/components/match/KeyMatchFactors'
import MatchMomentum from '@/components/match/MatchMomentum'
import HighlightsLink from '@/components/match/HighlightsLink'

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
  attendance?: number
  capacity?: number
  date: string
  league: string
  leagueId?: string
  referee?: string
  refereeCountry?: string
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
          attendance: data.attendance,
          capacity: data.capacity,
          date: data.date,
          league: data.league,
          leagueId: data.leagueId,
          referee: data.referee,
          refereeCountry: data.refereeCountry,
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
          
          {/* Match Header - FotMob-inspired */}
          <div className="text-center">
            <p className="text-sm font-medium mb-4 text-center" style={{ color: 'var(--text-secondary)' }}>{match.league}</p>
            
            <div className="flex items-start justify-center gap-4 md:gap-8">
              {/* Home team column */}
              <div className="flex-1 text-right">
                <p className="text-lg md:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{match.home_team}</p>
                {/* Home goal scorers */}
                {match.events.filter(e => e.team === 'home' && (e.type === 'goal' || e.type === 'own_goal')).length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {match.events
                      .filter(e => e.team === 'home' && (e.type === 'goal' || e.type === 'own_goal'))
                      .map((e, i) => (
                        <p key={i} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {e.player} {e.minute}&apos;{e.addedTime ? `+${e.addedTime}` : ''}{e.type === 'own_goal' ? ' (OG)' : ''}
                        </p>
                      ))}
                  </div>
                )}
              </div>
              
              <div className="text-center px-4 md:px-8 flex-shrink-0">
                {/* Live indicator */}
                {isLive && !isHalftime && (
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-red-500 text-sm font-bold">LIVE</span>
                    <span className="text-red-400 text-sm font-bold">{match.minute}&apos;</span>
                  </div>
                )}
                
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
              
              {/* Away team column */}
              <div className="flex-1 text-left">
                <p className="text-lg md:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{match.away_team}</p>
                {/* Away goal scorers */}
                {match.events.filter(e => e.team === 'away' && (e.type === 'goal' || e.type === 'own_goal')).length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {match.events
                      .filter(e => e.team === 'away' && (e.type === 'goal' || e.type === 'own_goal'))
                      .map((e, i) => (
                        <p key={i} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {e.player} {e.minute}&apos;{e.addedTime ? `+${e.addedTime}` : ''}{e.type === 'own_goal' ? ' (OG)' : ''}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            </div>
            
            <p className="text-xs mt-3 text-center" style={{ color: 'var(--text-tertiary)' }}>{formatDate(match.date)}</p>
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
            {/* ── Momentum Chart (FotMob-style) ── */}
            {match.events.length > 0 && (
              <MatchMomentum
                events={match.events}
                homeTeam={match.home_team}
                awayTeam={match.away_team}
                status={match.status}
                possession={match.stats.possession}
              />
            )}

            {/* ── Top Stats (compact, FotMob-style) ── */}
            {!isScheduled && (
              <div className="rounded-2xl p-4" style={{ background: 'var(--muted-bg)' }}>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>Top Stats</h3>
                <div className="grid grid-cols-3 gap-3">
                  {/* Possession */}
                  <div className="text-center">
                    <div className="flex items-center justify-between text-lg font-bold">
                      <span className={match.stats.possession[0] > match.stats.possession[1] ? 'text-blue-500' : 'text-[var(--text-secondary)]'}>{match.stats.possession[0]}%</span>
                      <span className={match.stats.possession[1] > match.stats.possession[0] ? 'text-orange-500' : 'text-[var(--text-secondary)]'}>{match.stats.possession[1]}%</span>
                    </div>
                    <div className="flex h-1.5 rounded-full overflow-hidden mt-1.5">
                      <div className="bg-blue-500" style={{ width: `${match.stats.possession[0]}%` }} />
                      <div className="bg-orange-500" style={{ width: `${match.stats.possession[1]}%` }} />
                    </div>
                    <p className="text-[10px] mt-1 font-medium" style={{ color: 'var(--text-tertiary)' }}>Possession</p>
                  </div>
                  {/* Total Shots */}
                  <div className="text-center">
                    <div className="flex items-center justify-between text-lg font-bold">
                      <span className={match.stats.shots[0] > match.stats.shots[1] ? 'text-blue-500' : 'text-[var(--text-secondary)]'}>{match.stats.shots[0]}</span>
                      <span className={match.stats.shots[1] > match.stats.shots[0] ? 'text-orange-500' : 'text-[var(--text-secondary)]'}>{match.stats.shots[1]}</span>
                    </div>
                    <div className="flex h-1.5 rounded-full overflow-hidden mt-1.5">
                      <div className="bg-blue-500" style={{ width: `${(match.stats.shots[0] / Math.max(1, match.stats.shots[0] + match.stats.shots[1])) * 100}%` }} />
                      <div className="bg-orange-500" style={{ width: `${(match.stats.shots[1] / Math.max(1, match.stats.shots[0] + match.stats.shots[1])) * 100}%` }} />
                    </div>
                    <p className="text-[10px] mt-1 font-medium" style={{ color: 'var(--text-tertiary)' }}>Total Shots</p>
                  </div>
                  {/* Shots on Target */}
                  <div className="text-center">
                    <div className="flex items-center justify-between text-lg font-bold">
                      <span className={match.stats.shotsOnTarget[0] > match.stats.shotsOnTarget[1] ? 'text-blue-500' : 'text-[var(--text-secondary)]'}>{match.stats.shotsOnTarget[0]}</span>
                      <span className={match.stats.shotsOnTarget[1] > match.stats.shotsOnTarget[0] ? 'text-orange-500' : 'text-[var(--text-secondary)]'}>{match.stats.shotsOnTarget[1]}</span>
                    </div>
                    <div className="flex h-1.5 rounded-full overflow-hidden mt-1.5">
                      <div className="bg-blue-500" style={{ width: `${(match.stats.shotsOnTarget[0] / Math.max(1, match.stats.shotsOnTarget[0] + match.stats.shotsOnTarget[1])) * 100}%` }} />
                      <div className="bg-orange-500" style={{ width: `${(match.stats.shotsOnTarget[1] / Math.max(1, match.stats.shotsOnTarget[0] + match.stats.shotsOnTarget[1])) * 100}%` }} />
                    </div>
                    <p className="text-[10px] mt-1 font-medium" style={{ color: 'var(--text-tertiary)' }}>On Target</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── AI Prediction Card ── */}
            {match.prediction && (
              <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(168,85,247,0.1))', border: '1px solid rgba(99,102,241,0.2)' }}>
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🤖</span>
                    <span className="text-sm font-semibold text-indigo-400">AI Prediction</span>
                    <span className="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full ml-auto">
                      {match.prediction.confidence}% confidence
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-6">
                    <div className="text-center">
                      <p className="text-xs text-[var(--text-tertiary)] mb-1">Predicted Score</p>
                      <p className="text-2xl font-bold text-indigo-400">
                        {match.prediction.predicted_score.home} - {match.prediction.predicted_score.away}
                      </p>
                    </div>
                    <div className="h-10 w-px bg-indigo-500/20" />
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
                  {isFinished && match.home_score !== null && match.away_score !== null && (() => {
                    const accuracy = getPredictionAccuracy()
                    return accuracy.message ? (
                      <div className="mt-3 pt-3 border-t border-indigo-500/20">
                        <p className={`text-center text-xs font-semibold ${
                          accuracy.type === 'exact' ? 'text-green-500' : 
                          accuracy.type === 'close' ? 'text-amber-500' : 
                          'text-[var(--text-tertiary)]'
                        }`}>{accuracy.message}</p>
                      </div>
                    ) : null
                  })()}
                </div>
              </div>
            )}

            {/* ── Events Timeline ── */}
            {match.events.length > 0 && (
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)]">Events</h3>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                  {match.events
                    .filter(e => e.type !== 'substitution')
                    .sort((a, b) => a.minute - b.minute)
                    .map((event, idx) => {
                      const isGoal = event.type === 'goal' || event.type === 'own_goal'
                      const icon = isGoal ? '⚽' : event.type === 'yellow_card' ? '🟨' : event.type === 'red_card' ? '🟥' : '🔄'
                      const isHome = event.team === 'home'
                      return (
                        <div key={idx} className="flex items-center px-4 py-2.5 hover:bg-[var(--muted-bg)] transition-colors" style={{ borderColor: 'var(--border-color)' }}>
                          {/* Home side */}
                          <div className="flex-1 text-right pr-3">
                            {isHome && (
                              <div>
                                <span className={`text-sm ${isGoal ? 'font-semibold' : ''}`} style={{ color: 'var(--text-primary)' }}>
                                  {icon} {event.player}
                                </span>
                                {event.relatedPlayer && isGoal && (
                                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>assist by {event.relatedPlayer}</p>
                                )}
                              </div>
                            )}
                          </div>
                          {/* Minute */}
                          <div className="w-12 text-center flex-shrink-0">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isGoal ? 'bg-[var(--accent-primary)] text-white' : ''}`} style={!isGoal ? { color: 'var(--text-tertiary)' } : {}}>
                              {event.minute}&apos;{event.addedTime ? `+${event.addedTime}` : ''}
                            </span>
                          </div>
                          {/* Away side */}
                          <div className="flex-1 text-left pl-3">
                            {!isHome && (
                              <div>
                                <span className={`text-sm ${isGoal ? 'font-semibold' : ''}`} style={{ color: 'var(--text-primary)' }}>
                                  {event.player} {icon}
                                </span>
                                {event.relatedPlayer && isGoal && (
                                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>assist by {event.relatedPlayer}</p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  {/* Half time marker */}
                  {match.events.some(e => e.minute > 45) && (
                    <div className="flex items-center px-4 py-1.5" style={{ background: 'var(--muted-bg)' }}>
                      <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
                      <span className="px-3 text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>HT</span>
                      <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
                    </div>
                  )}
                  {/* Full Time marker */}
                  {isFinished && (
                    <div className="flex items-center px-4 py-2" style={{ background: 'var(--muted-bg)' }}>
                      <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
                      <span className="px-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        FT {match.home_score} - {match.away_score}
                      </span>
                      <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── YouTube Highlights ── */}
            <HighlightsLink
              homeTeam={match.home_team}
              awayTeam={match.away_team}
              homeScore={match.home_score}
              awayScore={match.away_score}
              date={match.date}
              league={match.league}
              status={match.status}
            />

            {/* ── Match Info (FotMob-style) ── */}
            <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
              <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                <h3 className="font-semibold text-[var(--text-primary)]">Match Info</h3>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                {/* Venue with Google Maps link */}
                {match.venue && (
                  <a
                    href={`https://www.google.com/maps/search/${encodeURIComponent(match.venue)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--muted-bg)] transition-colors"
                  >
                    <span className="text-xl">🏟️</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{match.venue}</p>
                      <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>View on map →</p>
                    </div>
                    {/* Attendance / Capacity */}
                    {(match.attendance || match.capacity) && (
                      <div className="text-right flex-shrink-0">
                        {match.attendance && (
                          <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            {match.attendance.toLocaleString()}
                            {match.capacity ? ` / ${match.capacity.toLocaleString()}` : ''}
                          </p>
                        )}
                        {match.capacity && match.attendance && (
                          <div className="flex items-center gap-1.5 mt-0.5 justify-end">
                            <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--muted-bg)' }}>
                              <div
                                className="h-full rounded-full bg-green-500"
                                style={{ width: `${Math.min(100, (match.attendance / match.capacity) * 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-medium text-green-500">
                              {Math.round((match.attendance / match.capacity) * 100)}%
                            </span>
                          </div>
                        )}
                        {!match.attendance && match.capacity && (
                          <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                            Capacity: {match.capacity.toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}
                  </a>
                )}
                {/* Date & Time */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xl">📅</span>
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formatDate(match.date)}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{match.league}</p>
                  </div>
                </div>
                {/* Referee */}
                {match.referee && (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="text-xl">⚖️</span>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{match.referee}</p>
                      {match.refereeCountry && (
                        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{match.refereeCountry}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Key Match Factors ── */}
            <KeyMatchFactors 
              homeTeam={match.home_team}
              awayTeam={match.away_team}
              leagueId={match.leagueId}
              matchDate={match.date}
            />

            {/* ── H2H & Team Form Summary ── */}
            {(match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins > 0 || match.homeStanding || match.awayStanding) && (
              <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
                    <span>⚔️</span> Head-to-Head &amp; Form
                  </h3>
                </div>
                <div className="p-4 space-y-4">
                  {/* H2H Record Bar */}
                  {(match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins) > 0 && (() => {
                    const totalH2H = match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins
                    const homePct = (match.h2h.homeWins / totalH2H) * 100
                    const drawPct = (match.h2h.draws / totalH2H) * 100
                    const awayPct = (match.h2h.awayWins / totalH2H) * 100
                    return (
                      <div>
                        <div className="flex items-center justify-between text-sm mb-2">
                          <span className="text-[var(--text-primary)] font-medium">{match.home_team}</span>
                          <span className="text-[var(--text-tertiary)] text-xs">{totalH2H} meetings</span>
                          <span className="text-[var(--text-primary)] font-medium">{match.away_team}</span>
                        </div>
                        <div className="flex h-6 rounded-lg overflow-hidden text-xs font-bold text-white">
                          {homePct > 0 && (
                            <div className="bg-blue-500 flex items-center justify-center" style={{ width: `${homePct}%` }}>
                              {match.h2h.homeWins}W
                            </div>
                          )}
                          {drawPct > 0 && (
                            <div className="bg-gray-400 flex items-center justify-center" style={{ width: `${drawPct}%` }}>
                              {match.h2h.draws}D
                            </div>
                          )}
                          {awayPct > 0 && (
                            <div className="bg-orange-500 flex items-center justify-center" style={{ width: `${awayPct}%` }}>
                              {match.h2h.awayWins}W
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Recent H2H Matches */}
                  {match.h2h.recentMatches.length > 0 && (
                    <div>
                      <p className="text-xs text-[var(--text-tertiary)] mb-2 font-medium uppercase tracking-wide">Recent Meetings</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {match.h2h.recentMatches.slice(0, 4).map((m, idx) => {
                          const homeWon = m.home_score > m.away_score
                          const awayWon = m.away_score > m.home_score
                          return (
                            <div key={idx} className="flex items-center justify-between px-3 py-2 bg-[var(--muted-bg)] rounded-lg text-sm">
                              <span className={`flex-1 text-right pr-2 ${homeWon ? 'font-semibold text-blue-500' : 'text-[var(--text-secondary)]'}`}>
                                {m.homeTeam || match.home_team}
                              </span>
                              <span className="font-bold text-[var(--text-primary)] px-2">
                                {m.home_score} - {m.away_score}
                              </span>
                              <span className={`flex-1 text-left pl-2 ${awayWon ? 'font-semibold text-orange-500' : 'text-[var(--text-secondary)]'}`}>
                                {m.awayTeam || match.away_team}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Team Form (Standing-based) */}
                  {(match.homeStanding || match.awayStanding) && (
                    <div>
                      <p className="text-xs text-[var(--text-tertiary)] mb-2 font-medium uppercase tracking-wide">Season Form</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {match.homeStanding && (
                          <div className="bg-[var(--muted-bg)] rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="w-2 h-2 rounded-full bg-blue-500" />
                              <span className="text-sm font-medium text-[var(--text-primary)]">{match.home_team}</span>
                              <span className="text-xs text-[var(--text-tertiary)] ml-auto">#{match.homeStanding.position}</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 text-center text-xs">
                              <div><p className="text-[var(--text-tertiary)]">P</p><p className="font-medium text-[var(--text-primary)]">{match.homeStanding.played}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">W</p><p className="font-medium text-green-500">{match.homeStanding.won}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">D</p><p className="font-medium text-amber-500">{match.homeStanding.drawn}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">L</p><p className="font-medium text-red-400">{match.homeStanding.lost}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">Pts</p><p className="font-bold text-[var(--text-primary)]">{match.homeStanding.points}</p></div>
                            </div>
                          </div>
                        )}
                        {match.awayStanding && (
                          <div className="bg-[var(--muted-bg)] rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="w-2 h-2 rounded-full bg-orange-500" />
                              <span className="text-sm font-medium text-[var(--text-primary)]">{match.away_team}</span>
                              <span className="text-xs text-[var(--text-tertiary)] ml-auto">#{match.awayStanding.position}</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 text-center text-xs">
                              <div><p className="text-[var(--text-tertiary)]">P</p><p className="font-medium text-[var(--text-primary)]">{match.awayStanding.played}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">W</p><p className="font-medium text-green-500">{match.awayStanding.won}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">D</p><p className="font-medium text-amber-500">{match.awayStanding.drawn}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">L</p><p className="font-medium text-red-400">{match.awayStanding.lost}</p></div>
                              <div><p className="text-[var(--text-tertiary)]">Pts</p><p className="font-bold text-[var(--text-primary)]">{match.awayStanding.points}</p></div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => setActiveTab('h2h')}
                    className="w-full text-center text-sm text-[var(--accent-primary)] hover:opacity-80 transition-opacity font-medium py-1"
                  >
                    View full H2H &amp; form details →
                  </button>
                </div>
              </div>
            )}

            {/* ── Weather ── */}
            <MatchWeather 
              matchId={matchId}
              venue={match.venue}
              homeTeam={match.home_team}
              awayTeam={match.away_team}
            />

            {/* ── Commentary ── */}
            {match.commentary && match.commentary.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>📝 Commentary</h3>
                <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="max-h-[400px] overflow-y-auto divide-y" style={{ borderColor: 'var(--border-color)' }}>
                    {match.commentary
                      .sort((a, b) => b.minute - a.minute)
                      .map((item, idx) => (
                        <div key={idx} className="flex gap-3 p-3 hover:bg-[var(--muted-bg)] transition-colors">
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] font-bold text-[10px] flex-shrink-0">
                            {item.minute}&apos;
                          </span>
                          <p className="text-xs text-[var(--text-primary)] leading-relaxed">{item.text}</p>
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
