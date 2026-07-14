'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'
import { Bookmark, BookmarkCheck, ChevronLeft, CircleHelp, RefreshCw } from 'lucide-react'

import { AIPredictionTab } from '@/components/match/AIPredictionTab'
import { StickyScoreBar } from '@/components/match/StickyScoreBar'
import { adaptMatchPrediction } from '@/components/match/detail/adaptPrediction'
import { H2HTab } from '@/components/match/detail/H2HTab'
import { LineupsTab } from '@/components/match/detail/LineupsTab'
import { OverviewTab } from '@/components/match/detail/OverviewTab'
import { StatsTab } from '@/components/match/detail/StatsTab'
import { TableTab } from '@/components/match/detail/TableTab'
import {
  DETAIL_TABS,
  DETAIL_TAB_LABELS,
  formatMatchDate,
  normalizeDetailTab,
  type DetailTab,
  type MatchDetails,
  type MatchEvent,
  type TeamStanding,
} from '@/components/match/detail/types'
import { ClubColorBar } from '@/components/motion'
import { FlagBadge, TeamBadge } from '@/components/primitives'
import { MatchDetailSkeleton } from '@/components/skeletons'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { springSnappy } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { WATCHLIST_STORAGE_KEY, normalizeTeamName, type WatchTeam } from '@/lib/watchlist'

/**
 * Competitions contested by national teams — identities resolve to real
 * country flags (rule 2: no letter-avatars for known teams).
 */
const NATIONAL_TEAM_COMPETITIONS = new Set([
  'fifa.world',
  'fifa.wwc',
  'fifa.friendly',
  'fifa.friendly.w',
  'uefa.euro',
  'uefa.weuro',
  'uefa.nations',
  'conmebol.america',
  'concacaf.gold',
  'caf.nations',
  'afc.asian.cup',
])

function isNationalTeamMatch(leagueId?: string, leagueName?: string): boolean {
  if (leagueId && NATIONAL_TEAM_COMPETITIONS.has(leagueId)) return true
  const name = (leagueName || '').toLowerCase()
  return /world cup|euro(pean championship)?|copa america|nations league|gold cup|international friendl/.test(name)
}

/** Aggregate the hero scorer line — one line per scorer, minutes joined. */
function scorerLines(events: MatchEvent[], team: 'home' | 'away'): Array<{ name: string; detail: string }> {
  const byScorer = new Map<string, string[]>()
  for (const e of events) {
    if (e.team !== team || (e.type !== 'goal' && e.type !== 'own_goal')) continue
    const minute = `${e.minute}'${e.addedTime ? `+${e.addedTime}` : ''}${e.type === 'own_goal' ? ' (OG)' : ''}`
    const minutes = byScorer.get(e.player) ?? []
    minutes.push(minute)
    byScorer.set(e.player, minutes)
  }
  return [...byScorer.entries()].map(([name, minutes]) => ({ name, detail: minutes.join(', ') }))
}

function TeamNameWithCrest({
  name,
  teamId,
  align,
  isNational,
  accent,
}: {
  name: string
  teamId?: string
  align: 'left' | 'right'
  isNational?: boolean
  /** Club identity tint — renders a flat colour sliver under the name. */
  accent?: string
}) {
  const content = (
    <span className="block min-w-0">
      <span
        className={cn(
          'flex items-center gap-2.5 min-w-0',
          align === 'right' ? 'flex-row-reverse justify-start' : 'justify-start',
        )}
      >
        {isNational ? (
          <FlagBadge country={name} teamName={name} size={32} />
        ) : (
          <TeamBadge teamId={teamId} name={name} size={32} className="shrink-0" />
        )}
        <span className="font-display text-[clamp(1.1rem,2.4vw,1.85rem)] font-bold leading-tight text-[var(--text-primary)] truncate">
          {name}
        </span>
      </span>
      {accent && (
        <span
          className={cn(
            'mt-1.5 flex',
            align === 'right' ? 'justify-end pr-[42px]' : 'justify-start pl-[42px]',
          )}
        >
          <ClubColorBar
            color={accent}
            team={name}
            orientation="horizontal"
            size="sm"
            animate="draw"
            style={{ width: 44, height: 3 }}
          />
        </span>
      )}
    </span>
  )
  if (!teamId) return content
  return (
    <Link
      href={`/teams/${teamId}`}
      className="block transition-opacity hover:opacity-80"
      aria-label={`${name} team page`}
    >
      {content}
    </Link>
  )
}

export default function MatchDetailPage() {
  const params = useParams()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const matchId = params.id as string
  const leagueId = searchParams.get('league') || ''

  const { asQueryParam: genderParam } = useGenderQuery()
  const reduceMotion = useReducedMotion()
  const [match, setMatch] = useState<MatchDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [halftimeCountdown, setHalftimeCountdown] = useState<string>('')
  const [refreshKey, setRefreshKey] = useState(0) // bump to refetch (retry button + live polling)
  const [trackedTeams, setTrackedTeams] = useState<WatchTeam[]>([])

  // ?tab= deep link is the source of truth. Legacy values
  // (summary/ai/lineup/…) are normalised onto the new tab set.
  const activeTab = normalizeDetailTab(searchParams.get('tab'))
  const selectTab = useCallback(
    (tab: DetailTab) => {
      const next = new URLSearchParams(searchParams.toString())
      next.set('tab', tab)
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  // Derived state for live status - compute before hooks that depend on it
  const isLive = match?.status?.includes('IN_PROGRESS') || match?.status?.includes('HALF') || match?.status?.includes('LIVE') || false
  const isHalftime = match?.status?.toLowerCase().includes('half') && !match?.status?.toLowerCase().includes('first') && !match?.status?.toLowerCase().includes('second') || false
  // Ref to the match hero <section>. StickyScoreBar uses an IntersectionObserver
  // on this to know when to slide down into view.
  const heroRef = useRef<HTMLElement | null>(null)
  const trackedNameSet = useMemo(
    () => new Set(trackedTeams.map((team) => normalizeTeamName(team.name))),
    [trackedTeams]
  )

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
    try {
      const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return
      setTrackedTeams(
        parsed
          .filter((item): item is WatchTeam => {
            if (!item || typeof item !== 'object') return false
            const entry = item as Partial<WatchTeam>
            return typeof entry.name === 'string' && typeof entry.league === 'string'
          })
          .map((item) => ({ name: item.name.trim(), league: item.league.trim() }))
          .filter((item) => item.name.length > 0 && item.league.length > 0)
      )
    } catch (error) {
      console.error('Failed to load match watchlist:', error)
    }
  }, [])

  useEffect(() => {
    const fetchMatchDetails = async () => {
      try {
        // Server-side proxy: avoids CORS and falls back between providers.
        const baseUrl = `/api/match/${matchId}${leagueId ? `?league=${leagueId}` : ''}`
        const sep = baseUrl.includes('?') ? '&' : '?'
        const url = `${baseUrl}${sep}gender=${genderParam}`
        const res = await fetch(url, { cache: 'no-store' })

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
          source: data.source,
          sourceDetail: data.sourceDetail,
          generatedAt: data.generatedAt,
          home_team: data.home_team,
          away_team: data.away_team,
          home_team_id: data.home_team_id,
          away_team_id: data.away_team_id,
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
            homeBench: data.lineups?.homeBench,
            awayBench: data.lineups?.awayBench,
            homeCoach: data.lineups?.homeCoach,
            awayCoach: data.lineups?.awayCoach,
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
          statsExtended: Array.isArray(data.statsExtended) && data.statsExtended.length > 0
            ? data.statsExtended
            : undefined,
          momentum: Array.isArray(data.momentum) && data.momentum.length > 0
            ? data.momentum
            : undefined,
          shotmap: data.shotmap || [],
          h2h: {
            homeWins: data.h2h?.homeWins ?? 0,
            draws: data.h2h?.draws ?? 0,
            awayWins: data.h2h?.awayWins ?? 0,
            homeGoals: typeof data.h2h?.homeGoals === 'number' ? data.h2h.homeGoals : undefined,
            awayGoals: typeof data.h2h?.awayGoals === 'number' ? data.h2h.awayGoals : undefined,
            recentMatches: (data.h2h?.recentMatches || []).map((m: {
              date?: string
              homeTeam?: string
              awayTeam?: string
              home_score?: number
              away_score?: number
              homeScore?: number
              awayScore?: number
            }) => ({
              date: m.date || '',
              homeTeam: m.homeTeam,
              awayTeam: m.awayTeam,
              home_score: Number(m.home_score ?? m.homeScore ?? 0),
              away_score: Number(m.away_score ?? m.awayScore ?? 0),
            })),
          },
          prediction: data.prediction,
          liveWinProbability: data.liveWinProbability,
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

              const normalizeName = (name: string) =>
                name
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .toLowerCase()

              const homeTeamName = normalizeName(matchDetails.home_team)
              const awayTeamName = normalizeName(matchDetails.away_team)

              const fullStandings: TeamStanding[] = []
              let matchedHomeStanding: TeamStanding | undefined
              let matchedAwayStanding: TeamStanding | undefined

              for (let i = 0; i < entries.length; i++) {
                const entry = entries[i]
                const teamDisplayName = entry.team?.displayName || 'Unknown'
                const teamName = normalizeName(teamDisplayName)

                type ESPNStandingStat = { name?: string; value?: string | number; displayValue?: string }
                const findStat = (name: string): ESPNStandingStat | undefined =>
                  entry.stats?.find((s: ESPNStandingStat) => s.name === name)
                const getStatVal = (name: string) => parseInt(String(findStat(name)?.value ?? '0'), 10) || 0
                const getStatNum = (name: string): number | undefined => {
                  const value = parseFloat(String(findStat(name)?.value ?? ''))
                  return Number.isFinite(value) ? value : undefined
                }

                // Last-5 form string — only some standings feeds publish one.
                const formRaw = findStat('form')?.displayValue ?? entry.team?.form
                const form =
                  typeof formRaw === 'string'
                    ? formRaw.toUpperCase().replace(/[^WDL]/g, '').slice(0, 5)
                    : ''

                const standing: TeamStanding = {
                  position: i + 1,
                  played: getStatVal('gamesPlayed'),
                  won: getStatVal('wins'),
                  drawn: getStatVal('ties'),
                  lost: getStatVal('losses'),
                  points: getStatVal('points'),
                  teamName: teamDisplayName,
                  teamId: entry.team?.id != null ? String(entry.team.id) : undefined,
                  goalsFor: getStatNum('pointsFor'),
                  goalsAgainst: getStatNum('pointsAgainst'),
                  goalDiff: getStatNum('pointDifferential'),
                  form: form.length > 0 ? form : undefined,
                  note:
                    entry.note?.color || entry.note?.description
                      ? { color: entry.note?.color, description: entry.note?.description }
                      : undefined,
                }

                fullStandings.push(standing)

                if (teamName.includes(homeTeamName) || homeTeamName.includes(teamName)) {
                  matchedHomeStanding = standing
                }
                if (teamName.includes(awayTeamName) || awayTeamName.includes(teamName)) {
                  matchedAwayStanding = standing
                }
              }

              // Only show table context when both teams can be located in the same standings set.
              if (matchedHomeStanding && matchedAwayStanding) {
                matchDetails.homeStanding = matchedHomeStanding
                matchDetails.awayStanding = matchedAwayStanding
                matchDetails.fullStandings = fullStandings
              } else {
                matchDetails.homeStanding = undefined
                matchDetails.awayStanding = undefined
                matchDetails.fullStandings = undefined
              }
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
  }, [matchId, leagueId, refreshKey, genderParam]) // refreshKey triggers refetch when incremented

  // Live polling — refresh the payload every 30s while the match is in
  // progress. Cleared on unmount and once the status is no longer live.
  useEffect(() => {
    if (!isLive) return
    const interval = setInterval(() => setRefreshKey((key) => key + 1), 30_000)
    return () => clearInterval(interval)
  }, [isLive])

  if (loading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--background)' }} aria-busy="true">
        <MatchDetailSkeleton />
      </div>
    )
  }

  if (!match) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--background)' }}>
        <div className="text-center max-w-md mx-auto px-4">
          <CircleHelp className="mx-auto mb-4 h-12 w-12 text-[var(--text-tertiary)]" aria-hidden />
          <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Match not available</h2>
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
              <span>Detailed data is temporarily unavailable</span>
            </li>
          </ul>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/matches"
              className="px-6 py-3 rounded-xl bg-[var(--accent-primary)] text-[var(--accent-on-primary)] font-semibold hover:opacity-90 transition-opacity"
            >
              Browse matches
            </Link>
            <button
              onClick={() => {
                setLoading(true)
                setRefreshKey((key) => key + 1) // Trigger refetch without full page reload
              }}
              className="px-6 py-3 rounded-xl border font-semibold transition-colors hover:bg-[var(--muted-bg)] inline-flex items-center justify-center gap-2"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Additional derived state (isLive and isHalftime already computed above before hooks)
  const isScheduled = match.status.toLowerCase().includes('scheduled') || match.status.toLowerCase().includes('pre')
  const isFinished = match.status.includes('FINAL') || match.status.toLowerCase().includes('finished') || match.status.toLowerCase().includes('ft')

  // Navigate back to the league page - go directly to full league page
  const handleBack = () => {
    if (leagueId) {
      router.push(`/leagues/${leagueId}`)
    } else {
      router.back()
    }
  }

  const trackTeam = (teamName: string) => {
    const normalized = normalizeTeamName(teamName)
    if (!normalized || trackedNameSet.has(normalized)) return

    setTrackedTeams((current) => {
      const next = [...current, { name: teamName, league: match.league || 'Unknown' }]
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const isTeamTracked = (teamName: string) => trackedNameSet.has(normalizeTeamName(teamName))

  // Live minute label for the StickyScoreBar — falls back to match.status.
  const liveMinuteLabel = isLive ? (match.minute ?? match.status) : null

  // National-team fixtures resolve identities to country flags (rule 2).
  const isNational = isNationalTeamMatch(match.leagueId, match.league)

  const leagueAccent = getLeagueAccent(match.leagueId ?? match.league)

  const homeScorers = scorerLines(match.events, 'home')
  const awayScorers = scorerLines(match.events, 'away')

  return (
    <div
      className="min-h-screen"
      style={{
        // Team tint tokens consumed by H2H bars, lineups and standings
        // highlights further down the page (green home / league-brand away).
        ['--team-tint-home' as string]: 'var(--accent-primary)',
        ['--team-tint-away' as string]: leagueAccent?.accent || 'var(--accent-info)',
      }}
    >
      <StickyScoreBar
        heroRef={heroRef}
        homeName={match.home_team}
        awayName={match.away_team}
        homeCountry={isNational ? match.home_team : undefined}
        awayCountry={isNational ? match.away_team : undefined}
        homeTeamId={match.home_team_id}
        awayTeamId={match.away_team_id}
        homeScore={match.home_score}
        awayScore={match.away_score}
        isLive={isLive}
        liveMinute={liveMinuteLabel}
        statusLabel={isFinished ? 'FT' : isScheduled ? 'Scheduled' : match.status}
      />
      {/* Scoreboard header — flat card, ESPN grammar: league line, teams +
          score (or kickoff), status, venue. No gradients, no glows. */}
      <section ref={heroRef} className="border-b border-[var(--border-color)] bg-[var(--card-bg)]">
        <div className="mx-auto w-full max-w-5xl px-4 pb-5 pt-2 md:px-8">
          {/* Back link */}
          <button
            onClick={handleBack}
            className="group mb-2 -ml-2 inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to {match.league || 'matches'}</span>
          </button>

          {/* League line */}
          <div className="mb-4 flex items-center justify-center gap-2">
            {leagueAccent?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={leagueAccent.logoUrl} alt="" className="h-4 w-4 object-contain" aria-hidden="true" />
            )}
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              {leagueAccent && leagueAccent.competitionId !== 'unknown'
                ? leagueAccent.displayName
                : match.league}
            </span>
          </div>

          {/* Score block — three columns */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-6">
            {/* Home team */}
            <div className="min-w-0 text-right">
              <TeamNameWithCrest
                name={match.home_team}
                teamId={match.home_team_id}
                align="right"
                isNational={isNational}
                accent="var(--team-tint-home, var(--accent-primary))"
              />
              {homeScorers.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {homeScorers.map((scorer) => (
                    <p key={scorer.name} className="truncate text-[11px] leading-4 text-[var(--text-tertiary)]">
                      {scorer.name}
                      <span className="ml-1 font-numeric tabular-nums">{scorer.detail}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Score / kickoff */}
            <div className="flex-shrink-0 px-2 text-center">
              {isScheduled ? (
                <div>
                  <p className="font-numeric text-[clamp(1.4rem,3.4vw,2rem)] font-bold leading-none tabular-nums text-[var(--text-primary)]">
                    {(() => {
                      try {
                        return new Date(match.date).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: false,
                        })
                      } catch {
                        return 'TBD'
                      }
                    })()}
                  </p>
                </div>
              ) : (
                <motion.div
                  className="flex items-center gap-3 md:gap-4"
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  <span className="font-numeric text-[clamp(2rem,5vw,3rem)] font-extrabold leading-none tabular-nums text-[var(--text-primary)]">
                    {match.home_score}
                  </span>
                  <span className="text-[clamp(1.2rem,3vw,1.8rem)] font-bold leading-none text-[var(--text-tertiary)]">
                    –
                  </span>
                  <span className="font-numeric text-[clamp(2rem,5vw,3rem)] font-extrabold leading-none tabular-nums text-[var(--text-primary)]">
                    {match.away_score}
                  </span>
                </motion.div>
              )}

              {/* Status line */}
              <div className="mt-1.5">
                {isLive && !isHalftime && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold tabular-nums text-[var(--live-text)]">
                    <span className="relative inline-flex h-1.5 w-1.5">
                      <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-loss)]" />
                    </span>
                    {match.minute != null ? `${match.minute}'` : 'Live'}
                  </span>
                )}
                {isHalftime && (
                  <span className="text-xs font-bold text-[var(--accent-warn)]">
                    HT{halftimeCountdown ? ` · ${halftimeCountdown}` : ''}
                  </span>
                )}
                {isFinished && (
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                    FT
                  </span>
                )}
                {isScheduled && (
                  <span className="text-[11px] font-medium text-[var(--text-tertiary)]">
                    {(() => {
                      try {
                        return new Date(match.date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })
                      } catch {
                        return ''
                      }
                    })()}
                  </span>
                )}
              </div>
            </div>

            {/* Away team */}
            <div className="min-w-0 text-left">
              <TeamNameWithCrest
                name={match.away_team}
                teamId={match.away_team_id}
                align="left"
                isNational={isNational}
                accent="var(--team-tint-away, var(--accent-info))"
              />
              {awayScorers.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {awayScorers.map((scorer) => (
                    <p key={scorer.name} className="truncate text-[11px] leading-4 text-[var(--text-tertiary)]">
                      {scorer.name}
                      <span className="ml-1 font-numeric tabular-nums">{scorer.detail}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Venue + date line — small, quiet */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
            <span>{formatMatchDate(match.date)}</span>
            {match.venue && (
              <>
                <span aria-hidden="true">·</span>
                <span>{match.venue}</span>
              </>
            )}
          </div>

          {/* Follow buttons — one quiet row */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {[match.home_team, match.away_team].map((teamName) => {
              const tracked = isTeamTracked(teamName)
              return (
                <button
                  key={teamName}
                  onClick={() => trackTeam(teamName)}
                  disabled={tracked}
                  className={cn(
                    'inline-flex min-h-[36px] max-w-[220px] items-center gap-1.5 truncate rounded-full px-3 text-xs font-semibold transition-colors',
                    tracked
                      ? 'cursor-default text-[var(--accent-primary)]'
                      : 'text-[var(--text-tertiary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-secondary)]'
                  )}
                >
                  {tracked ? (
                    <>
                      <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Following {teamName}
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                      Follow {teamName}
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Tab row — underline grammar (green bar on active), same as DateStrip.
          Horizontally scrollable on mobile. */}
      <div className="sticky top-[var(--shell-topbar-h)] z-10 border-b border-[var(--nav-border)] bg-[var(--nav-bg)] backdrop-blur-md">
        <div
          className="mx-auto flex w-full max-w-4xl items-stretch overflow-x-auto px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Match sections"
        >
          {DETAIL_TABS.map((tab) => {
            const active = activeTab === tab
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(tab)}
                className={cn(
                  'relative flex min-h-[44px] items-center justify-center whitespace-nowrap px-4 text-xs font-semibold transition-colors',
                  active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                )}
              >
                {DETAIL_TAB_LABELS[tab]}
                {active && (
                  <motion.span
                    {...(reduceMotion ? {} : { layoutId: 'matchdetail-tab-active', transition: springSnappy })}
                    className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-[var(--accent-primary)]"
                    aria-hidden
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content — one column of stacked cards, tab bodies live in
          src/components/match/detail/ */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {activeTab === 'overview' && (
          <OverviewTab
            match={match}
            isLive={isLive}
            isFinished={isFinished}
            isScheduled={isScheduled}
            onSelectTab={selectTab}
          />
        )}

        {activeTab === 'prediction' && (
          <AIPredictionTab
            prediction={match.prediction ? adaptMatchPrediction(match) : null}
            matchState={isFinished ? 'finished' : isLive ? 'live' : 'upcoming'}
            retrospectiveContext={{
              home_team: match.home_team,
              away_team: match.away_team,
              league: match.league,
              leagueId: match.leagueId,
              home_score: match.home_score,
              away_score: match.away_score,
            }}
          />
        )}

        {activeTab === 'lineups' && <LineupsTab match={match} />}

        {activeTab === 'stats' && <StatsTab match={match} isScheduled={isScheduled} />}

        {activeTab === 'h2h' && <H2HTab match={match} />}

        {activeTab === 'table' && <TableTab match={match} />}
      </div>
    </div>
  )
}
