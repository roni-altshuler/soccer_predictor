'use client'

import { useState, useEffect, useCallback } from 'react'

interface MatchEvent {
  type: 'goal' | 'assist' | 'yellow_card' | 'red_card' | 'substitution' | 'var' | 'penalty_missed' | 'own_goal'
  minute: number
  addedTime?: number
  player: string
  team: 'home' | 'away'
  relatedPlayer?: string  // For assists or player subbed off
  description?: string
}

interface LiveMatchData {
  status: 'first_half' | 'halftime' | 'second_half' | 'extra_time_first' | 'extra_time_halftime' | 'extra_time_second' | 'penalties' | 'full_time' | 'not_started'
  minute: number
  addedTime?: number
  homeScore: number
  awayScore: number
  homePenalties?: number
  awayPenalties?: number
  events: MatchEvent[]
  nextResumeTime?: Date  // For halftime countdown
}

interface LiveMatchTrackerProps {
  matchId: string
  homeTeam: string
  awayTeam: string
  initialData?: LiveMatchData
  venue?: string
  onUpdate?: (data: LiveMatchData) => void
}

const STATUS_DISPLAY: Record<string, { label: string; color: string; bg: string }> = {
  first_half: { label: '1st Half', color: 'text-[var(--accent-primary)]', bg: 'bg-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)]' },
  halftime: { label: 'Half Time', color: 'text-[var(--accent-warn)]', bg: 'bg-[color-mix(in_srgb,var(--accent-warn)_20%,transparent)]' },
  second_half: { label: '2nd Half', color: 'text-[var(--accent-primary)]', bg: 'bg-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)]' },
  extra_time_first: { label: 'Extra Time 1st', color: 'text-[var(--accent-market)]', bg: 'bg-[color-mix(in_srgb,var(--accent-market)_20%,transparent)]' },
  extra_time_halftime: { label: 'ET Half Time', color: 'text-[var(--accent-warn)]', bg: 'bg-[color-mix(in_srgb,var(--accent-warn)_20%,transparent)]' },
  extra_time_second: { label: 'Extra Time 2nd', color: 'text-[var(--accent-market)]', bg: 'bg-[color-mix(in_srgb,var(--accent-market)_20%,transparent)]' },
  penalties: { label: 'Penalties', color: 'text-[var(--accent-loss)]', bg: 'bg-[color-mix(in_srgb,var(--accent-loss)_20%,transparent)]' },
  full_time: { label: 'Full Time', color: 'text-[var(--text-secondary)]', bg: 'bg-[var(--muted-bg)]' },
  not_started: { label: 'Not Started', color: 'text-[var(--accent-info)]', bg: 'bg-[color-mix(in_srgb,var(--accent-info)_20%,transparent)]' },
}

const EVENT_ICONS: Record<string, string> = {
  goal: '⚽',
  own_goal: '⚽🔴',
  assist: '👟',
  yellow_card: '🟨',
  red_card: '🟥',
  substitution: '🔄',
  var: '📺',
  penalty_missed: '❌',
}

export default function LiveMatchTracker({
  matchId,
  homeTeam,
  awayTeam,
  initialData,
  venue,
  onUpdate
}: LiveMatchTrackerProps) {
  const [matchData, setMatchData] = useState<LiveMatchData | null>(initialData || null)
  const [countdown, setCountdown] = useState<string>('')
  const [isPolling, setIsPolling] = useState(true)

  // Fetch live match data
  const fetchLiveData = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/matches/${matchId}/live`)
      if (!response.ok) return

      const data = await response.json()
      
      // Parse the response into our LiveMatchData format
      const liveData: LiveMatchData = {
        status: parseMatchStatus(data.status),
        minute: data.minute || 0,
        addedTime: data.addedTime,
        homeScore: data.homeScore || 0,
        awayScore: data.awayScore || 0,
        homePenalties: data.homePenalties,
        awayPenalties: data.awayPenalties,
        events: parseEvents(data.events || []),
        nextResumeTime: data.nextResumeTime ? new Date(data.nextResumeTime) : undefined,
      }

      setMatchData(liveData)
      onUpdate?.(liveData)
    } catch (error) {
      console.error('Error fetching live data:', error)
    }
  }, [matchId, onUpdate])

  // Parse match status from API
  const parseMatchStatus = (status: string): LiveMatchData['status'] => {
    const statusLower = status?.toLowerCase() || ''
    if (statusLower.includes('first_half') || statusLower.includes('1h')) return 'first_half'
    if (statusLower.includes('half') && statusLower.includes('time')) return 'halftime'
    if (statusLower.includes('second_half') || statusLower.includes('2h')) return 'second_half'
    if (statusLower.includes('extra') && statusLower.includes('first')) return 'extra_time_first'
    if (statusLower.includes('extra') && statusLower.includes('half')) return 'extra_time_halftime'
    if (statusLower.includes('extra') && statusLower.includes('second')) return 'extra_time_second'
    if (statusLower.includes('penalt')) return 'penalties'
    if (statusLower.includes('final') || statusLower.includes('ft') || statusLower.includes('finished')) return 'full_time'
    return 'not_started'
  }

  // Parse events from API
  const parseEvents = (events: any[]): MatchEvent[] => {
    return events.map(e => ({
      type: parseEventType(e.type || e.eventType),
      minute: e.minute || e.time || 0,
      addedTime: e.addedTime || e.injuryTime,
      player: e.player || e.playerName || e.text || 'Unknown',
      team: e.team === 'home' || e.isHome ? 'home' : 'away',
      relatedPlayer: e.relatedPlayer || e.assistPlayer || e.playerOff,
      description: e.description || e.text,
    }))
  }

  const parseEventType = (type: string): MatchEvent['type'] => {
    const typeLower = type?.toLowerCase() || ''
    if (typeLower.includes('goal') && typeLower.includes('own')) return 'own_goal'
    if (typeLower.includes('goal')) return 'goal'
    if (typeLower.includes('yellow')) return 'yellow_card'
    if (typeLower.includes('red')) return 'red_card'
    if (typeLower.includes('sub')) return 'substitution'
    if (typeLower.includes('var')) return 'var'
    if (typeLower.includes('penalty') && typeLower.includes('miss')) return 'penalty_missed'
    return 'goal'
  }

  // Poll for updates every 30 seconds when match is live
  useEffect(() => {
    if (!isPolling) return

    fetchLiveData()
    const interval = setInterval(fetchLiveData, 30000) // 30 second polling

    return () => clearInterval(interval)
  }, [fetchLiveData, isPolling])

  // Countdown timer for halftime
  useEffect(() => {
    if (matchData?.status !== 'halftime' || !matchData.nextResumeTime) {
      setCountdown('')
      return
    }

    const updateCountdown = () => {
      const now = new Date()
      const resumeTime = matchData.nextResumeTime!
      const diff = resumeTime.getTime() - now.getTime()

      if (diff <= 0) {
        setCountdown('Resuming soon...')
        return
      }

      const minutes = Math.floor(diff / 60000)
      const seconds = Math.floor((diff % 60000) / 1000)
      setCountdown(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)

    return () => clearInterval(interval)
  }, [matchData?.status, matchData?.nextResumeTime])

  if (!matchData) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-2xl p-6" style={{ borderColor: 'var(--border-color)' }}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-[var(--muted-bg)] rounded w-1/3 mx-auto" />
          <div className="h-16 bg-[var(--muted-bg)] rounded" />
          <div className="h-24 bg-[var(--muted-bg)] rounded" />
        </div>
      </div>
    )
  }

  const statusInfo = STATUS_DISPLAY[matchData.status] || STATUS_DISPLAY.not_started
  const isLive = ['first_half', 'second_half', 'extra_time_first', 'extra_time_second', 'penalties'].includes(matchData.status)
  const isPaused = ['halftime', 'extra_time_halftime'].includes(matchData.status)

  // Group events by type for summary
  const homeGoals = matchData.events.filter(e => e.team === 'home' && (e.type === 'goal' || e.type === 'own_goal'))
  const awayGoals = matchData.events.filter(e => e.team === 'away' && (e.type === 'goal' || e.type === 'own_goal'))
  const homeCards = matchData.events.filter(e => e.team === 'home' && (e.type === 'yellow_card' || e.type === 'red_card'))
  const awayCards = matchData.events.filter(e => e.team === 'away' && (e.type === 'yellow_card' || e.type === 'red_card'))
  const substitutions = matchData.events.filter(e => e.type === 'substitution')

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      {/* Live Status Banner */}
      <div className={`${statusInfo.bg} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          {isLive && (
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent-loss)] animate-pulse" />
              <span className="text-[var(--live-text)] font-bold text-sm">LIVE</span>
            </div>
          )}
          <span className={`font-semibold ${statusInfo.color}`}>{statusInfo.label}</span>
          {(isLive || isPaused) && (
            <span className="text-[var(--text-primary)] font-mono font-bold">
              {matchData.minute}&apos;
              {matchData.addedTime ? `+${matchData.addedTime}` : ''}
            </span>
          )}
        </div>
        
        {/* Halftime Countdown */}
        {isPaused && countdown && (
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-secondary)] text-sm">Resumes in:</span>
            <span className="font-mono font-bold text-[var(--accent-warn)] bg-[color-mix(in_srgb,var(--accent-warn)_20%,transparent)] px-2 py-1 rounded">
              {countdown}
            </span>
          </div>
        )}
        
        {venue && (
          <span className="text-[var(--text-tertiary)] text-sm hidden md:block">📍 {venue}</span>
        )}
      </div>

      {/* Score Display */}
      <div className="p-6">
        <div className="flex items-center justify-center gap-6 md:gap-12">
          <div className="flex-1 text-right">
            <p className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">{homeTeam}</p>
            {homeGoals.length > 0 && (
              <div className="mt-2 space-y-1">
                {homeGoals.map((goal, idx) => (
                  <p key={idx} className="text-sm text-[var(--text-secondary)]">
                    {goal.player} {goal.minute}&apos;{goal.addedTime ? `+${goal.addedTime}` : ''}
                    {goal.relatedPlayer && (
                      <span className="text-[var(--text-tertiary)]"> ({goal.relatedPlayer})</span>
                    )}
                  </p>
                ))}
              </div>
            )}
          </div>
          
          <div className="text-center">
            <div className="text-5xl md:text-6xl font-bold text-[var(--text-primary)]">
              {matchData.homeScore} - {matchData.awayScore}
            </div>
            {matchData.homePenalties !== undefined && matchData.awayPenalties !== undefined && (
              <p className="text-sm text-[var(--text-secondary)] mt-2">
                Penalties: {matchData.homePenalties} - {matchData.awayPenalties}
              </p>
            )}
          </div>
          
          <div className="flex-1 text-left">
            <p className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">{awayTeam}</p>
            {awayGoals.length > 0 && (
              <div className="mt-2 space-y-1">
                {awayGoals.map((goal, idx) => (
                  <p key={idx} className="text-sm text-[var(--text-secondary)]">
                    {goal.player} {goal.minute}&apos;{goal.addedTime ? `+${goal.addedTime}` : ''}
                    {goal.relatedPlayer && (
                      <span className="text-[var(--text-tertiary)]"> ({goal.relatedPlayer})</span>
                    )}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="px-6 pb-4">
        <div className="flex justify-center gap-8 py-3 border-y" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1">
                {homeCards.filter(c => c.type === 'yellow_card').length > 0 && (
                  <span className="text-lg">🟨 {homeCards.filter(c => c.type === 'yellow_card').length}</span>
                )}
                {homeCards.filter(c => c.type === 'red_card').length > 0 && (
                  <span className="text-lg ml-2">🟥 {homeCards.filter(c => c.type === 'red_card').length}</span>
                )}
                {homeCards.length === 0 && <span className="text-[var(--text-tertiary)]">—</span>}
              </div>
              <p className="text-xs text-[var(--text-tertiary)]">Cards</p>
            </div>
          </div>
          
          <div className="h-10 w-px bg-[var(--border-color)]" />
          
          <div className="text-center">
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {substitutions.filter(s => s.team === 'home').length} / {substitutions.filter(s => s.team === 'away').length}
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">Subs</p>
          </div>
          
          <div className="h-10 w-px bg-[var(--border-color)]" />
          
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1">
                {awayCards.filter(c => c.type === 'yellow_card').length > 0 && (
                  <span className="text-lg">🟨 {awayCards.filter(c => c.type === 'yellow_card').length}</span>
                )}
                {awayCards.filter(c => c.type === 'red_card').length > 0 && (
                  <span className="text-lg ml-2">🟥 {awayCards.filter(c => c.type === 'red_card').length}</span>
                )}
                {awayCards.length === 0 && <span className="text-[var(--text-tertiary)]">—</span>}
              </div>
              <p className="text-xs text-[var(--text-tertiary)]">Cards</p>
            </div>
          </div>
        </div>
      </div>

      {/* Match Timeline / Events */}
      {matchData.events.length > 0 && (
        <div className="px-6 pb-6">
          <h4 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Match Events</h4>
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[var(--border-color)] transform -translate-x-1/2" />
            
            <div className="space-y-3">
              {matchData.events
                .sort((a, b) => {
                  const timeA = a.minute + (a.addedTime || 0) * 0.01
                  const timeB = b.minute + (b.addedTime || 0) * 0.01
                  return timeB - timeA  // Most recent first
                })
                .slice(0, 10)
                .map((event, idx) => (
                  <div key={idx} className="relative flex items-center">
                    {/* Home event */}
                    {event.team === 'home' && (
                      <div className="flex-1 flex justify-end pr-6">
                        <div className="bg-[var(--muted-bg)] rounded-lg px-3 py-2 max-w-xs text-right">
                          <p className="text-sm text-[var(--text-primary)]">
                            {EVENT_ICONS[event.type]} {event.player}
                          </p>
                          {event.relatedPlayer && event.type === 'goal' && (
                            <p className="text-xs text-[var(--text-tertiary)]">Assist: {event.relatedPlayer}</p>
                          )}
                          {event.relatedPlayer && event.type === 'substitution' && (
                            <p className="text-xs text-[var(--text-tertiary)]">Off: {event.relatedPlayer}</p>
                          )}
                        </div>
                      </div>
                    )}
                    {event.team === 'away' && <div className="flex-1" />}
                    
                    {/* Minute marker */}
                    <div className="absolute left-1/2 transform -translate-x-1/2 z-10">
                      <div className="w-8 h-8 rounded-full bg-[var(--accent-primary)] flex items-center justify-center text-white text-xs font-bold shadow">
                        {event.minute}&apos;
                      </div>
                    </div>
                    
                    {/* Away event */}
                    {event.team === 'home' && <div className="flex-1" />}
                    {event.team === 'away' && (
                      <div className="flex-1 flex justify-start pl-6">
                        <div className="bg-[var(--muted-bg)] rounded-lg px-3 py-2 max-w-xs text-left">
                          <p className="text-sm text-[var(--text-primary)]">
                            {EVENT_ICONS[event.type]} {event.player}
                          </p>
                          {event.relatedPlayer && event.type === 'goal' && (
                            <p className="text-xs text-[var(--text-tertiary)]">Assist: {event.relatedPlayer}</p>
                          )}
                          {event.relatedPlayer && event.type === 'substitution' && (
                            <p className="text-xs text-[var(--text-tertiary)]">Off: {event.relatedPlayer}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* No events message */}
      {matchData.events.length === 0 && isLive && (
        <div className="px-6 pb-6 text-center">
          <p className="text-[var(--text-secondary)]">No events yet</p>
        </div>
      )}
    </div>
  )
}
