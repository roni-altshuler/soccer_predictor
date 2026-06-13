'use client'

import { useEffect, useMemo, useState } from 'react'

type MatchWinner = 'home' | 'away' | 'draw'

interface HeadToHeadMatch {
  id: string
  date: string
  competition: string
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  winner: MatchWinner
}

interface HeadToHeadSnapshot {
  totalMatches: number
  homeWins: number
  awayWins: number
  draws: number
  avgGoalsPerMatch: number
  recentMatches: HeadToHeadMatch[]
}

interface TeamFormMatch {
  date: string
  result: 'win' | 'draw' | 'loss'
  goals_for: number
  goals_against: number
  venue: 'home' | 'away'
  opponent: string
}

interface TeamFormResponse {
  team: string
  matches: TeamFormMatch[]
}

interface TeamFormSnapshot {
  team: string
  pointsLast5: number
  goalsForAvg: number
  goalsAgainstAvg: number
  recentForm: Array<'W' | 'D' | 'L'>
  recentMatches: TeamFormMatch[]
  homeRecord: string
  awayRecord: string
}

interface HeadToHeadDisplayProps {
  homeTeam: string
  awayTeam: string
  matchId?: string
  leagueId?: string
  initialData?: {
    totalMatches?: number
    draws?: number
    avgGoalsPerMatch?: number
    team1?: { wins?: number; [key: string]: unknown }
    team2?: { wins?: number; [key: string]: unknown }
    recentForm?: unknown[]
    streaks?: unknown
    recentMatches?: Array<{
      id?: string
      date?: string
      competition?: string
      homeTeam?: string
      awayTeam?: string
      homeScore?: number
      awayScore?: number
      winner?: MatchWinner
    }>
    [key: string]: unknown
  }
  showTeamForm?: boolean
}

function parseIsoDate(rawDate: string): Date | null {
  if (!rawDate) return null
  const parsed = new Date(rawDate)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function prettyDate(rawDate: string): string {
  const date = parseIsoDate(rawDate)
  if (!date) return 'Date unknown'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function winnerFromScore(homeScore: number, awayScore: number): MatchWinner {
  if (homeScore > awayScore) return 'home'
  if (awayScore > homeScore) return 'away'
  return 'draw'
}

function normalizeH2HFromInitial(
  initialData: HeadToHeadDisplayProps['initialData'],
  homeTeam: string,
  awayTeam: string
): HeadToHeadSnapshot | null {
  if (!initialData) return null

  const recentMatches = (initialData.recentMatches || [])
    .map((match, index) => {
      const homeScore = Number(match.homeScore ?? 0)
      const awayScore = Number(match.awayScore ?? 0)
      return {
        id: String(match.id || `h2h-${index}`),
        date: String(match.date || ''),
        competition: String(match.competition || ''),
        homeTeam: String(match.homeTeam || homeTeam),
        awayTeam: String(match.awayTeam || awayTeam),
        homeScore,
        awayScore,
        winner: match.winner || winnerFromScore(homeScore, awayScore),
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const homeWins = Number(initialData.team1?.wins || 0)
  const awayWins = Number(initialData.team2?.wins || 0)
  const draws = Number(initialData.draws || 0)
  const totalMatches = Number(initialData.totalMatches || (homeWins + awayWins + draws || recentMatches.length))

  const avgGoalsPerMatch = initialData.avgGoalsPerMatch !== undefined
    ? Number(initialData.avgGoalsPerMatch)
    : recentMatches.length > 0
      ? recentMatches.reduce((sum, match) => sum + match.homeScore + match.awayScore, 0) / recentMatches.length
      : 0

  if (totalMatches <= 0 && recentMatches.length === 0) {
    return null
  }

  return {
    totalMatches,
    homeWins,
    awayWins,
    draws,
    avgGoalsPerMatch,
    recentMatches,
  }
}

function normalizeH2HFromMatchPayload(payload: any): HeadToHeadSnapshot | null {
  const h2h = payload?.h2h
  if (!h2h) return null

  const recentMatches = (Array.isArray(h2h.recentMatches) ? h2h.recentMatches : [])
    .map((match: any, index: number) => {
      const homeScore = Number(match.home_score ?? match.homeScore ?? 0)
      const awayScore = Number(match.away_score ?? match.awayScore ?? 0)
      return {
        id: String(match.id || `${match.date || 'match'}-${index}`),
        date: String(match.date || ''),
        competition: String(match.competition || ''),
        homeTeam: String(match.homeTeam || match.home_team || ''),
        awayTeam: String(match.awayTeam || match.away_team || ''),
        homeScore,
        awayScore,
        winner: winnerFromScore(homeScore, awayScore),
      }
    })
    .sort((a: HeadToHeadMatch, b: HeadToHeadMatch) => b.date.localeCompare(a.date))

  const homeWins = Number(h2h.homeWins || 0)
  const awayWins = Number(h2h.awayWins || 0)
  const draws = Number(h2h.draws || 0)
  const totalMatches = homeWins + awayWins + draws
  const avgGoalsPerMatch = recentMatches.length > 0
    ? recentMatches.reduce((sum: number, match: HeadToHeadMatch) => sum + match.homeScore + match.awayScore, 0) / recentMatches.length
    : 0

  if (totalMatches <= 0 && recentMatches.length === 0) {
    return null
  }

  return {
    totalMatches,
    homeWins,
    awayWins,
    draws,
    avgGoalsPerMatch,
    recentMatches,
  }
}

function normalizeTeamForm(raw: TeamFormResponse | null): TeamFormSnapshot | null {
  if (!raw || !Array.isArray(raw.matches) || raw.matches.length === 0) return null

  const recentMatches = raw.matches.slice(0, 10)
  const recentFive = recentMatches.slice(0, 5)
  const recentForm = recentFive.map((match) => {
    if (match.result === 'win') return 'W'
    if (match.result === 'loss') return 'L'
    return 'D'
  })

  const pointsLast5 = recentForm.reduce((sum, result) => {
    if (result === 'W') return sum + 3
    if (result === 'D') return sum + 1
    return sum
  }, 0)

  const goalsForAvg = recentMatches.reduce((sum, match) => sum + (match.goals_for || 0), 0) / recentMatches.length
  const goalsAgainstAvg = recentMatches.reduce((sum, match) => sum + (match.goals_against || 0), 0) / recentMatches.length

  const home = recentMatches.filter((match) => match.venue === 'home').slice(0, 5)
  const away = recentMatches.filter((match) => match.venue === 'away').slice(0, 5)

  const summary = (matches: TeamFormMatch[]) => {
    const wins = matches.filter((match) => match.result === 'win').length
    const draws = matches.filter((match) => match.result === 'draw').length
    const losses = matches.filter((match) => match.result === 'loss').length
    return `${wins}W ${draws}D ${losses}L`
  }

  return {
    team: raw.team,
    pointsLast5,
    goalsForAvg,
    goalsAgainstAvg,
    recentForm,
    recentMatches: recentFive,
    homeRecord: summary(home),
    awayRecord: summary(away),
  }
}

function formTokenClass(result: 'W' | 'D' | 'L'): string {
  if (result === 'W') return 'bg-[var(--accent-primary)] text-white'
  if (result === 'D') return 'bg-[var(--accent-warn)] text-white'
  return 'bg-[var(--accent-loss)] text-white'
}

export default function HeadToHeadDisplay({
  homeTeam,
  awayTeam,
  matchId,
  leagueId,
  initialData,
  showTeamForm = true,
}: HeadToHeadDisplayProps) {
  const [activeView, setActiveView] = useState<'h2h' | 'form'>('h2h')
  const [expanded, setExpanded] = useState(false)
  const [h2h, setH2H] = useState<HeadToHeadSnapshot | null>(normalizeH2HFromInitial(initialData, homeTeam, awayTeam))
  const [homeForm, setHomeForm] = useState<TeamFormSnapshot | null>(null)
  const [awayForm, setAwayForm] = useState<TeamFormSnapshot | null>(null)
  const [loadingH2H, setLoadingH2H] = useState(!initialData)
  const [loadingForm, setLoadingForm] = useState(showTeamForm)

  useEffect(() => {
    const fromInitial = normalizeH2HFromInitial(initialData, homeTeam, awayTeam)
    if (fromInitial) {
      setH2H(fromInitial)
      setLoadingH2H(false)
      return
    }

    if (!matchId) {
      setH2H(null)
      setLoadingH2H(false)
      return
    }

    let cancelled = false

    async function loadH2H() {
      setLoadingH2H(true)
      try {
        const query = leagueId ? `?league=${encodeURIComponent(leagueId)}` : ''
        const response = await fetch(`/api/match/${matchId}${query}`, { cache: 'no-store' })
        if (!response.ok || cancelled) return
        const payload = await response.json()
        if (cancelled) return
        setH2H(normalizeH2HFromMatchPayload(payload))
      } catch (error) {
        console.error('Failed loading H2H data:', error)
      } finally {
        if (!cancelled) setLoadingH2H(false)
      }
    }

    loadH2H()
    return () => {
      cancelled = true
    }
  }, [awayTeam, homeTeam, initialData, leagueId, matchId])

  useEffect(() => {
    if (!showTeamForm) {
      setLoadingForm(false)
      return
    }

    let cancelled = false

    async function loadForm() {
      setLoadingForm(true)
      try {
        const leagueParam = leagueId || 'all'
        const [homeResponse, awayResponse] = await Promise.all([
          fetch(`/api/team_form/${encodeURIComponent(leagueParam)}/${encodeURIComponent(homeTeam)}?opponent=${encodeURIComponent(awayTeam)}`, { cache: 'no-store' }),
          fetch(`/api/team_form/${encodeURIComponent(leagueParam)}/${encodeURIComponent(awayTeam)}?opponent=${encodeURIComponent(homeTeam)}`, { cache: 'no-store' }),
        ])

        if (cancelled) return

        const homePayload = homeResponse.ok ? ((await homeResponse.json()) as TeamFormResponse) : null
        const awayPayload = awayResponse.ok ? ((await awayResponse.json()) as TeamFormResponse) : null

        setHomeForm(normalizeTeamForm(homePayload))
        setAwayForm(normalizeTeamForm(awayPayload))
      } catch (error) {
        console.error('Failed loading team form data:', error)
        if (!cancelled) {
          setHomeForm(null)
          setAwayForm(null)
        }
      } finally {
        if (!cancelled) setLoadingForm(false)
      }
    }

    loadForm()
    return () => {
      cancelled = true
    }
  }, [awayTeam, homeTeam, leagueId, showTeamForm])

  const homeShare = useMemo(() => {
    if (!h2h || h2h.totalMatches === 0) return 0
    return (h2h.homeWins / h2h.totalMatches) * 100
  }, [h2h])

  const drawShare = useMemo(() => {
    if (!h2h || h2h.totalMatches === 0) return 0
    return (h2h.draws / h2h.totalMatches) * 100
  }, [h2h])

  const awayShare = useMemo(() => {
    if (!h2h || h2h.totalMatches === 0) return 0
    return (h2h.awayWins / h2h.totalMatches) * 100
  }, [h2h])

  if (loadingH2H && loadingForm) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-2xl p-6 animate-pulse" style={{ borderColor: 'var(--border-color)' }}>
        <div className="h-6 w-40 rounded bg-[var(--muted-bg)] mb-4" />
        <div className="h-20 rounded-xl bg-[var(--muted-bg)]" />
      </div>
    )
  }

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Head to Head & Team Form</h3>
          {h2h && h2h.totalMatches > 0 && (
            <span className="text-[11px] text-[var(--text-tertiary)]">{h2h.totalMatches} meetings</span>
          )}
        </div>
        {showTeamForm && (
          <div className="mt-3 inline-flex rounded-lg bg-[var(--muted-bg)] p-1">
            <button
              onClick={() => setActiveView('h2h')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeView === 'h2h'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              H2H
            </button>
            <button
              onClick={() => setActiveView('form')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                activeView === 'form'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Form
            </button>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        {activeView === 'h2h' && (
          <>
            {!h2h || h2h.totalMatches === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-[var(--text-secondary)]">No recent meetings found.</p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">This matchup has limited H2H history in the current data window.</p>
              </div>
            ) : (
              <>
                <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-color)', background: 'var(--muted-bg)' }}>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-semibold text-[var(--team-tint-home)]">{h2h.homeWins}W</span>
                    <span className="text-[var(--text-tertiary)]">{h2h.draws}D</span>
                    <span className="font-semibold text-[var(--team-tint-away)]">{h2h.awayWins}W</span>
                  </div>
                  <div className="h-3 rounded-full overflow-hidden flex bg-[var(--card-bg)]">
                    <div className="bg-[var(--team-tint-home)]" style={{ width: `${homeShare}%` }} />
                    <div className="bg-[var(--text-tertiary)]" style={{ width: `${drawShare}%` }} />
                    <div className="bg-[var(--team-tint-away)]" style={{ width: `${awayShare}%` }} />
                  </div>
                  <div className="grid grid-cols-3 text-center mt-2 text-[10px] text-[var(--text-tertiary)]">
                    <span>{homeTeam}</span>
                    <span>Draw</span>
                    <span>{awayTeam}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-color)', background: 'var(--muted-bg)' }}>
                    <p className="text-[var(--text-tertiary)]">Avg Goals / Match</p>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{h2h.avgGoalsPerMatch.toFixed(2)}</p>
                  </div>
                  <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-color)', background: 'var(--muted-bg)' }}>
                    <p className="text-[var(--text-tertiary)]">Tracked Meetings</p>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{h2h.recentMatches.length}</p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Recent Meetings</p>
                    {h2h.recentMatches.length > 5 && (
                      <button
                        onClick={() => setExpanded((value) => !value)}
                        className="text-xs text-[var(--accent-primary)] hover:opacity-80"
                      >
                        {expanded ? 'Show less' : `Show all (${h2h.recentMatches.length})`}
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {h2h.recentMatches
                      .slice(0, expanded ? undefined : 5)
                      .map((match) => (
                        <div key={match.id} className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border-color)', background: 'var(--muted-bg)' }}>
                          <p className="text-[10px] text-[var(--text-tertiary)] mb-1">
                            {prettyDate(match.date)}
                            {match.competition ? ` • ${match.competition}` : ''}
                          </p>
                          <div className="flex items-center justify-between text-sm gap-2">
                            <span className="flex-1 text-right text-[var(--text-primary)]">{match.homeTeam || homeTeam}</span>
                            <span className="font-bold text-[var(--text-primary)] min-w-[58px] text-center">
                              {match.homeScore} - {match.awayScore}
                            </span>
                            <span className="flex-1 text-left text-[var(--text-primary)]">{match.awayTeam || awayTeam}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {activeView === 'form' && (
          <>
            {loadingForm ? (
              <div className="py-8 flex justify-center">
                <div className="w-6 h-6 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !homeForm && !awayForm ? (
              <div className="text-center py-6">
                <p className="text-sm text-[var(--text-secondary)]">Team form data is not available right now.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <TeamFormCard title={homeTeam} accent="blue" form={homeForm} />
                <TeamFormCard title={awayTeam} accent="orange" form={awayForm} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function TeamFormCard({
  title,
  accent,
  form,
}: {
  title: string
  accent: 'blue' | 'orange'
  form: TeamFormSnapshot | null
}) {
  const accentText = accent === 'blue' ? 'text-[var(--team-tint-home)]' : 'text-[var(--team-tint-away)]'

  if (!form) {
    return (
      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-color)', background: 'var(--muted-bg)' }}>
        <p className={`text-sm font-semibold ${accentText}`}>{title}</p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">No recent match form available.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-color)', background: 'var(--muted-bg)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className={`text-sm font-semibold ${accentText}`}>{form.team || title}</p>
        <span className="text-[10px] text-[var(--text-tertiary)]">{form.pointsLast5}/15 pts</span>
      </div>

      <div className="flex gap-1.5 mb-3">
        {form.recentForm.map((result, index) => (
          <span
            key={`${result}-${index}`}
            className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center ${formTokenClass(result)}`}
          >
            {result}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
        <div className="rounded-lg px-2 py-1.5 bg-[var(--card-bg)]">
          <p className="text-[var(--text-tertiary)]">GF / game</p>
          <p className="font-semibold text-[var(--text-primary)]">{form.goalsForAvg.toFixed(2)}</p>
        </div>
        <div className="rounded-lg px-2 py-1.5 bg-[var(--card-bg)]">
          <p className="text-[var(--text-tertiary)]">GA / game</p>
          <p className="font-semibold text-[var(--text-primary)]">{form.goalsAgainstAvg.toFixed(2)}</p>
        </div>
        <div className="rounded-lg px-2 py-1.5 bg-[var(--card-bg)]">
          <p className="text-[var(--text-tertiary)]">Home (last 5)</p>
          <p className="font-semibold text-[var(--text-primary)]">{form.homeRecord}</p>
        </div>
        <div className="rounded-lg px-2 py-1.5 bg-[var(--card-bg)]">
          <p className="text-[var(--text-tertiary)]">Away (last 5)</p>
          <p className="font-semibold text-[var(--text-primary)]">{form.awayRecord}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        {form.recentMatches.slice(0, 5).map((match, index) => {
          const token = match.result === 'win' ? 'W' : match.result === 'loss' ? 'L' : 'D'
          return (
            <div key={`${match.date}-${match.opponent}-${index}`} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${formTokenClass(token)}`}>
                  {token}
                </span>
                <span className="text-[var(--text-secondary)]">{prettyDate(match.date)}</span>
                <span className="text-[var(--text-primary)]">{match.venue === 'home' ? 'vs' : '@'} {match.opponent}</span>
              </div>
              <span className="font-semibold text-[var(--text-primary)]">{match.goals_for}-{match.goals_against}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
