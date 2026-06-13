'use client'

import { useState, useEffect, useCallback } from 'react'
import { format, parseISO, addMonths, subMonths } from 'date-fns'
import { leagueNames as leagues } from '@/data/leagues'

type MatchData = {
  home_team: string
  away_team: string
  status: string
  actual_home_goals?: number | null
  actual_away_goals?: number | null
  result?: string
  predicted_home_win?: number
  predicted_draw?: number
  predicted_away_win?: number
  predicted_home_goals?: number
  predicted_away_goals?: number
  prediction_correct?: boolean
  predicted_result?: string
  venue?: string
  home_rating?: number
  away_rating?: number
  confidence?: number
  prediction_model?: string
  recommended_action?: string
}

type CalendarDay = {
  day: number
  date: string
  matches: MatchData[]
  match_count: number
  is_today: boolean
} | null

type CalendarWeek = CalendarDay[]

type CalendarData = {
  year: number
  month: number
  month_name: string
  weeks: CalendarWeek[]
  total_matches: number
}

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

const leagueFlags: Record<string, string> = {
  'Premier League': 'https://flagcdn.com/24x18/gb-eng.png',
  'La Liga': 'https://flagcdn.com/24x18/es.png',
  'Serie A': 'https://flagcdn.com/24x18/it.png',
  'Bundesliga': 'https://flagcdn.com/24x18/de.png',
  'Ligue 1': 'https://flagcdn.com/24x18/fr.png',
  'Champions League (UCL)': 'https://flagcdn.com/24x18/eu.png',
  'Europa League (UEL)': 'https://flagcdn.com/24x18/eu.png',
  'MLS': 'https://flagcdn.com/24x18/us.png',
  'FIFA World Cup': 'https://flagcdn.com/24x18/un.png'
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function PredictionBadge({ correct }: { correct?: boolean }) {
  if (correct === undefined) return null
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
      correct 
        ? 'bg-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)] text-[var(--accent-primary)] border border-[color-mix(in_srgb,var(--accent-primary)_30%,transparent)]'
        : 'bg-[color-mix(in_srgb,var(--accent-loss)_20%,transparent)] text-[var(--accent-loss)] border border-[color-mix(in_srgb,var(--accent-loss)_30%,transparent)]'
    }`}>
      {correct ? '✓ Correct' : '✗ Wrong'}
    </span>
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value * 100))
}

function formatProbability(value: number): string {
  return `${clampPct(value).toFixed(0)}%`
}

function normalizeStatus(status: string): 'played' | 'live' | 'scheduled' {
  const normalized = status.toLowerCase()
  if (['played', 'finished', 'completed', 'full_time', 'ft'].includes(normalized)) return 'played'
  if (normalized.includes('live') || normalized.includes('progress')) return 'live'
  return 'scheduled'
}

function ScoreDisplay({ 
  homeScore, 
  awayScore, 
  isActual = false,
  isPredicted = false 
}: { 
  homeScore: number | null | undefined
  awayScore: number | null | undefined
  isActual?: boolean
  isPredicted?: boolean
}) {
  const label = isActual ? 'FT' : isPredicted ? 'Pred' : ''
  const formatValue = (score: number | null | undefined) => {
    if (!isFiniteNumber(score)) return '-'
    return isPredicted && !Number.isInteger(score) ? score.toFixed(2) : String(score)
  }
  
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
      isActual 
        ? 'bg-[var(--muted-bg)] border border-[var(--border-color)]' 
        : 'bg-[var(--muted-bg)] border border-[var(--border-color)]'
    }`}>
      {label && (
        <span className={`text-[10px] font-bold uppercase tracking-wider ${
          isActual ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]'
        }`}>
          {label}
        </span>
      )}
      <span className={`font-mono text-lg font-bold ${isActual ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
        {formatValue(homeScore)}
      </span>
      <span className="text-[var(--text-tertiary)]">-</span>
      <span className={`font-mono text-lg font-bold ${isActual ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
        {formatValue(awayScore)}
      </span>
    </div>
  )
}

function MatchCard({ match, expanded = false }: { match: MatchData; expanded?: boolean }) {
  const status = normalizeStatus(match.status)
  const isPlayed = status === 'played'
  const isLive = status === 'live'
  const homeProb = match.predicted_home_win
  const drawProb = match.predicted_draw
  const awayProb = match.predicted_away_win
  const homeXg = match.predicted_home_goals
  const awayXg = match.predicted_away_goals
  const hasPrediction =
    isFiniteNumber(homeProb) &&
    isFiniteNumber(drawProb) &&
    isFiniteNumber(awayProb)
  const hasExpectedGoals =
    isFiniteNumber(homeXg) &&
    isFiniteNumber(awayXg)
  const venue = match.venue?.trim()
  
  // Determine winner for styling
  const actualHome = match.actual_home_goals
  const actualAway = match.actual_away_goals
  const homeWon = isPlayed && isFiniteNumber(actualHome) && isFiniteNumber(actualAway) && actualHome > actualAway
  const awayWon = isPlayed && isFiniteNumber(actualHome) && isFiniteNumber(actualAway) && actualAway > actualHome
  
  return (
    <div className={`relative overflow-hidden rounded-xl border transition-all duration-300 ${
      isLive
        ? 'bg-[var(--live-bg)] border-[var(--live-border)] ring-1 ring-[var(--live-border)]'
        : isPlayed 
          ? 'bg-[var(--card-bg)] border-[var(--border-color)]' 
          : 'bg-[var(--card-bg)] border-[var(--border-color)]'
    } ${expanded ? 'shadow-xl shadow-black/20' : 'hover:border-[var(--border-hover)] hover:shadow-lg hover:shadow-black/10'} `}>
      
      {/* Status indicator line */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${
        isLive ? 'bg-gradient-to-r from-[var(--accent-loss)] via-[var(--accent-loss-soft)] to-[var(--accent-loss)] animate-pulse' :
        isPlayed ? 'bg-gradient-to-r from-[var(--accent-primary)] via-[var(--accent-primary-soft)] to-[var(--accent-primary)]' :
        'bg-gradient-to-r from-[var(--accent-info)] via-[var(--accent-info-soft)] to-[var(--accent-info)]'
      }`} />
      
      <div className="p-4">
        {/* Teams */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex-1 text-right pr-4">
            <span className={`font-semibold text-sm ${homeWon ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
              {match.home_team}
            </span>
          </div>
          
          <div className="flex flex-col items-center gap-1">
            {isLive ? (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[var(--live-text)] animate-pulse" />
                  <span className="text-[var(--live-text)] text-[10px] font-bold uppercase tracking-wider">Live</span>
                </div>
                <ScoreDisplay 
                  homeScore={match.actual_home_goals ?? 0} 
                  awayScore={match.actual_away_goals ?? 0}
                  isActual 
                />
              </div>
            ) : isPlayed ? (
              <ScoreDisplay 
                homeScore={match.actual_home_goals} 
                awayScore={match.actual_away_goals}
                isActual 
              />
            ) : (
              <span className="px-3 py-1.5 rounded-lg bg-[var(--accent-ai)]/12 border border-[var(--accent-ai)]/30 text-[var(--accent-ai)] text-xs font-medium">
                Scheduled
              </span>
            )}
          </div>
          
          <div className="flex-1 text-left pl-4">
            <span className={`font-semibold text-sm ${awayWon ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
              {match.away_team}
            </span>
          </div>
        </div>

        {venue && (
          <div className="mb-3 text-center">
            <span className="text-[11px] text-[var(--text-tertiary)]">{venue}</span>
          </div>
        )}
        
        {/* Prediction Section */}
        {hasPrediction ? (
          <div className={`border-t border-[var(--border-color)] pt-3 mt-3 ${expanded ? '' : 'opacity-90 hover:opacity-100'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">
                AI Prediction
              </span>
              {isPlayed && <PredictionBadge correct={match.prediction_correct} />}
            </div>
            
            <div className="flex items-center justify-between gap-4">
              {/* Predicted Score */}
              {hasExpectedGoals && (
                <ScoreDisplay
                  homeScore={homeXg}
                  awayScore={awayXg}
                  isPredicted
                />
              )}
              
              {/* Win Probabilities */}
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-[var(--text-tertiary)]">Home</span>
                    <span className="text-[var(--accent-primary)] font-bold">
                      {formatProbability(homeProb)}
                    </span>
                  </div>
                  <div className="h-1 bg-[var(--muted-bg)] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-primary-soft)] rounded-full"
                      style={{ width: `${clampPct(homeProb)}%` }}
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-[var(--text-tertiary)]">Draw</span>
                    <span className="text-[var(--accent-warn)] font-bold">
                      {formatProbability(drawProb)}
                    </span>
                  </div>
                  <div className="h-1 bg-[var(--muted-bg)] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-[var(--accent-warn)] to-[var(--accent-warn-soft)] rounded-full"
                      style={{ width: `${clampPct(drawProb)}%` }}
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-[var(--text-tertiary)]">Away</span>
                    <span className="text-[var(--accent-loss)] font-bold">
                      {formatProbability(awayProb)}
                    </span>
                  </div>
                  <div className="h-1 bg-[var(--muted-bg)] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-[var(--accent-loss)] to-[var(--accent-loss-soft)] rounded-full"
                      style={{ width: `${clampPct(awayProb)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Confidence indicator */}
            {isFiniteNumber(match.confidence) && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-tertiary)]">Confidence:</span>
                <div className="flex-1 h-1 bg-[var(--muted-bg)] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-[var(--accent-ai)] to-[var(--accent-ai-light)] rounded-full"
                    style={{ width: `${clampPct(match.confidence)}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold text-[var(--accent-ai)]">
                  {formatProbability(match.confidence)}
                </span>
              </div>
            )}
            {match.prediction_model && (
              <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">{match.prediction_model}</p>
            )}
          </div>
        ) : expanded ? (
          <div className="border-t border-[var(--border-color)] pt-3 mt-3">
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Model prediction is not available for this fixture yet.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CalendarCell({ 
  day, 
  onClick,
  isSelected 
}: { 
  day: CalendarDay
  onClick: () => void
  isSelected: boolean
}) {
  if (!day) {
    return <div className="aspect-square bg-[var(--background-secondary)] rounded-lg" />
  }
  
  const hasMatches = day.match_count > 0
  const hasPlayedMatches = day.matches.some(m => normalizeStatus(m.status) === 'played')
  const hasUpcomingMatches = day.matches.some(m => normalizeStatus(m.status) === 'scheduled')
  
  return (
    <button
      onClick={onClick}
      className={`aspect-square rounded-xl p-2 transition-all duration-200 relative group ${
        isSelected
          ? 'bg-gradient-to-br from-[var(--accent-ai)] to-[var(--accent-primary)] ring-2 ring-[var(--accent-ai-light)] ring-offset-2 ring-offset-[var(--background)]'
          : day.is_today
          ? 'bg-gradient-to-br from-[color-mix(in_srgb,var(--accent-primary)_18%,transparent)] to-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] border-2 border-[color-mix(in_srgb,var(--accent-primary)_50%,transparent)] hover:border-[var(--accent-primary)]'
          : hasMatches
          ? 'bg-[var(--card-bg)] hover:bg-[var(--card-hover)] border border-[var(--border-color)] hover:border-[var(--border-hover)]'
          : 'bg-[var(--background-secondary)] hover:bg-[var(--muted-bg)] border border-transparent'
      }`}
    >
      <div className="flex flex-col h-full">
        <span className={`text-sm font-bold ${
          isSelected ? 'text-white' :
          day.is_today ? 'text-[var(--accent-primary)]' :
          hasMatches ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
        }`}>
          {day.day}
        </span>
        
        {hasMatches && (
          <div className="flex-1 flex flex-col justify-end">
            <div className="flex items-center gap-1 mt-1">
              {hasPlayedMatches && (
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" title="Completed" />
              )}
              {hasUpcomingMatches && (
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-info)]" title="Upcoming" />
              )}
            </div>
            <span className={`text-[10px] font-medium mt-0.5 ${
              isSelected ? 'text-cyan-100' : 'text-[var(--text-tertiary)]'
            }`}>
              {day.match_count} {day.match_count === 1 ? 'match' : 'matches'}
            </span>
          </div>
        )}
      </div>
      
      {/* Hover preview */}
      {hasMatches && !isSelected && (
        <div className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-[10px] text-[var(--text-secondary)] whitespace-nowrap shadow-lg">
            Click to view
          </div>
        </div>
      )}
    </button>
  )
}

function LiveScoreBanner({ league }: { league: string }) {
  const [liveMatches, setLiveMatches] = useState<any[]>([])
  
  useEffect(() => {
    const fetchLive = async () => {
      try {
        const res = await fetch(`/api/live_scores?league=${league}`)
        if (res.ok) {
          const data = await res.json()
          setLiveMatches(data)
        }
      } catch (e) {
        console.error('Error fetching live scores:', e)
      }
    }
    
    fetchLive()
    const interval = setInterval(fetchLive, 30000) // Poll every 30 seconds
    return () => clearInterval(interval)
  }, [league])
  
  if (liveMatches.length === 0) return null
  
  return (
    <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-[color-mix(in_srgb,var(--accent-loss)_20%,transparent)] via-[color-mix(in_srgb,var(--accent-loss)_10%,transparent)] to-[color-mix(in_srgb,var(--accent-loss)_20%,transparent)] border border-[var(--live-border)] animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--live-text)] animate-ping" />
          <span className="text-[var(--live-text)] font-bold text-sm uppercase tracking-wider">Live Now</span>
        </div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {liveMatches.map((match, idx) => (
          <div key={idx} className="flex-shrink-0 bg-[var(--card-bg)] rounded-xl px-4 py-2 border border-[color-mix(in_srgb,var(--accent-loss)_20%,transparent)]">
            <div className="flex items-center gap-3">
              <span className="text-[var(--text-primary)] font-medium text-sm">{match.home_team}</span>
              <span className="text-2xl font-bold text-[var(--text-primary)]">{match.home_score}</span>
              <span className="text-[var(--text-tertiary)]">-</span>
              <span className="text-2xl font-bold text-[var(--text-primary)]">{match.away_score}</span>
              <span className="text-[var(--text-primary)] font-medium text-sm">{match.away_team}</span>
              <span className="text-[var(--live-text)] text-xs font-medium">{match.minute}&apos;</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MatchesPage() {
  const [selectedLeague, setSelectedLeague] = useState<string>('Premier League')
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedMatches, setSelectedMatches] = useState<MatchData[]>([])
  const [loading, setLoading] = useState(false)
  const [currentDate, setCurrentDate] = useState(new Date())
  
  const mappedLeague = leagueNameMap[selectedLeague]
  
  const fetchCalendar = useCallback(async () => {
    if (!mappedLeague) return
    setLoading(true)
    
    try {
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth() + 1
      
      const res = await fetch(`/api/calendar/${mappedLeague}?year=${year}&month=${month}`)
      if (res.ok) {
        const data = await res.json()
        setCalendarData(data)
      }
    } catch (e) {
      console.error('Error fetching calendar:', e)
    } finally {
      setLoading(false)
    }
  }, [mappedLeague, currentDate])
  
  useEffect(() => {
    fetchCalendar()
  }, [fetchCalendar])
  
  const fetchMatchesForDate = async (date: string) => {
    if (!mappedLeague) return
    
    try {
      const res = await fetch(`/api/matches_by_date/${mappedLeague}/${date}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedMatches(data)
      }
    } catch (e) {
      console.error('Error fetching matches:', e)
    }
  }
  
  const handleDateClick = (day: CalendarDay) => {
    if (!day || day.match_count === 0) return
    
    if (selectedDate === day.date) {
      setSelectedDate(null)
      setSelectedMatches([])
    } else {
      setSelectedDate(day.date)
      setSelectedMatches(day.matches)
      fetchMatchesForDate(day.date)
    }
  }
  
  const handlePrevMonth = () => {
    setCurrentDate(subMonths(currentDate, 1))
    setSelectedDate(null)
    setSelectedMatches([])
  }
  
  const handleNextMonth = () => {
    setCurrentDate(addMonths(currentDate, 1))
    setSelectedDate(null)
    setSelectedMatches([])
  }
  
  const handleToday = () => {
    setCurrentDate(new Date())
    setSelectedDate(null)
    setSelectedMatches([])
  }
  
  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Premium Header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent-ai)]/10 via-[var(--accent-primary)]/8 to-[var(--accent-ai)]/10" />
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--accent-ai)] to-[var(--accent-primary)] flex items-center justify-center shadow-xl shadow-[color-mix(in_srgb,var(--accent-ai)_20%,transparent)]">
              <span className="text-3xl">📅</span>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)] tracking-tight">Match Calendar</h1>
              <p className="text-[var(--text-secondary)] text-sm mt-1">
                Browse matches, predictions, and results
              </p>
            </div>
          </div>
          
          {/* League Pills */}
          <div className="flex flex-wrap gap-2">
            {leagues.map((league) => (
              <button
                key={league}
                onClick={() => {
                  setSelectedLeague(league)
                  setSelectedDate(null)
                  setSelectedMatches([])
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  selectedLeague === league
                    ? 'bg-gradient-to-r from-[var(--accent-ai)] to-[var(--accent-primary)] text-[var(--accent-on-primary)] shadow-lg shadow-[color-mix(in_srgb,var(--accent-ai)_25%,transparent)]'
                    : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:bg-[var(--card-hover)] hover:border-[var(--border-hover)]'
                }`}
              >
                <img src={leagueFlags[league]} alt="" className="w-5 h-auto rounded-sm" />
                <span className="hidden sm:inline">{league}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Live Score Banner */}
        {mappedLeague && <LiveScoreBanner league={mappedLeague} />}
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Calendar */}
          <div className="lg:col-span-2">
            <div className="bg-[var(--card-bg)]/95 backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden shadow-2xl">
              {/* Calendar Header */}
              <div className="flex items-center justify-between px-6 py-4 bg-[var(--background-secondary)] border-b border-[var(--border-color)]">
                <button
                  onClick={handlePrevMonth}
                  className="p-2 rounded-xl bg-[var(--muted-bg)] hover:bg-[var(--card-hover)] text-[var(--text-secondary)] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                
                <div className="flex items-center gap-4">
                  <h2 className="text-xl font-bold text-[var(--text-primary)]">
                    {calendarData?.month_name} {calendarData?.year}
                  </h2>
                  <button
                    onClick={handleToday}
                    className="px-3 py-1.5 rounded-lg bg-[var(--tab-active-bg)] hover:bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] text-sm font-medium transition-colors border border-[var(--accent-primary)]/30"
                  >
                    Today
                  </button>
                </div>
                
                <button
                  onClick={handleNextMonth}
                  className="p-2 rounded-xl bg-[var(--muted-bg)] hover:bg-[var(--card-hover)] text-[var(--text-secondary)] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              
              {/* Calendar Grid */}
              <div className="p-4">
                {/* Weekday Headers */}
                <div className="grid grid-cols-7 gap-2 mb-2">
                  {WEEKDAYS.map((day) => (
                    <div key={day} className="text-center text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-wider py-2">
                      {day}
                    </div>
                  ))}
                </div>
                
                {/* Calendar Days */}
                {loading ? (
                  <div className="flex justify-center items-center py-20">
                    <div className="w-8 h-8 border-2 border-[var(--accent-ai)] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {calendarData?.weeks.map((week, weekIdx) => (
                      <div key={weekIdx} className="grid grid-cols-7 gap-2">
                        {week.map((day, dayIdx) => (
                          <CalendarCell
                            key={dayIdx}
                            day={day}
                            onClick={() => handleDateClick(day)}
                            isSelected={selectedDate === day?.date}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Legend */}
              <div className="px-6 py-4 bg-[var(--background-secondary)] border-t border-[var(--border-color)] flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--accent-primary)]" />
                  <span className="text-xs text-[var(--text-secondary)]">Completed</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--accent-info)]" />
                  <span className="text-xs text-[var(--text-secondary)]">Scheduled</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded border-2 border-[color-mix(in_srgb,var(--accent-primary)_50%,transparent)]" />
                  <span className="text-xs text-[var(--text-secondary)]">Today</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Match Details Panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-24">
              <div className="bg-[var(--card-bg)]/95 backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden shadow-2xl">
                {selectedDate ? (
                  <>
                    <div className="px-6 py-4 bg-gradient-to-r from-[var(--accent-ai)]/14 to-[var(--accent-primary)]/14 border-b border-[var(--border-color)]">
                      <h3 className="font-bold text-[var(--text-primary)]">
                        {format(parseISO(selectedDate), 'EEEE, MMMM d')}
                      </h3>
                      <p className="text-sm text-[var(--text-secondary)] mt-1">
                        {selectedMatches.length} {selectedMatches.length === 1 ? 'match' : 'matches'}
                      </p>
                    </div>
                    
                    <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                      {selectedMatches.length > 0 ? (
                        selectedMatches.map((match, idx) => (
                          <MatchCard key={idx} match={match} expanded />
                        ))
                      ) : (
                        <div className="text-center py-8">
                          <div className="w-12 h-12 rounded-full bg-[var(--muted-bg)] flex items-center justify-center mx-auto mb-3">
                            <span className="text-2xl">⏳</span>
                          </div>
                          <p className="text-[var(--text-secondary)] text-sm">Loading matches...</p>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="p-8 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--background-secondary)] to-[var(--muted-bg)] border border-[var(--border-color)] flex items-center justify-center mx-auto mb-4">
                      <span className="text-3xl">📆</span>
                    </div>
                    <h3 className="font-bold text-[var(--text-primary)] mb-2">Select a Date</h3>
                    <p className="text-sm text-[var(--text-secondary)]">
                      Click on a date with matches to view detailed predictions and results
                    </p>
                  </div>
                )}
              </div>
              
              {/* Stats Summary */}
              {calendarData && (
                <div className="mt-4 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] p-4 shadow-[var(--shadow-sm)]">
                  <h4 className="text-xs font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
                    {calendarData.month_name} Summary
                  </h4>
                  <div className="flex items-center justify-between">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-[var(--text-primary)]">{calendarData.total_matches}</p>
                      <p className="text-xs text-[var(--text-secondary)]">Total Matches</p>
                    </div>
                    <div className="h-10 w-px bg-[var(--border-color)]" />
                    <div className="text-center">
                      <img src={leagueFlags[selectedLeague]} alt="" className="w-8 h-auto mx-auto rounded-sm" />
                      <p className="text-xs text-[var(--text-secondary)] mt-1">{selectedLeague}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
