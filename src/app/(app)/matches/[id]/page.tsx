'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Bookmark, BookmarkCheck, ChevronLeft, CircleHelp, RefreshCw } from 'lucide-react'

import { MatchDetail } from '@/components/fixture/MatchDetail'
import { RecordedForecastPanel } from '@/components/fixture/RecordedForecast'
import { ProbabilityBar } from '@/components/forecast/ProbabilityBar'
import { AIPredictionTab } from '@/components/match/AIPredictionTab'
import { StickyScoreBar } from '@/components/match/StickyScoreBar'
import { adaptMatchPrediction } from '@/components/match/detail/adaptPrediction'
import { OverviewTab } from '@/components/match/detail/OverviewTab'
import { TableTab } from '@/components/match/detail/TableTab'
import {
  normalizeDetailTab,
  type DetailTab,
  type MatchDetails,
  type MatchEvent,
  type TeamStanding,
} from '@/components/match/detail/types'
import { MatchDetailSkeleton } from '@/components/skeletons'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'
import { WATCHLIST_STORAGE_KEY, normalizeTeamName, type WatchTeam } from '@/lib/watchlist'
import { ESPN_V2 } from '@/lib/espnHost'

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

/**
 * The URL's `?tab=` onto the shared card's labels. `/matches/[id]` has always
 * taken a tab in the query string, and the card owns its own tab state, so a
 * link into a section has to be translated rather than dropped.
 */
const CARD_TAB: Record<DetailTab, string> = {
  overview: 'Timeline',
  prediction: 'Prediction',
  lineups: 'Lineups',
  stats: 'Stats',
  h2h: 'H2H',
  table: 'Table',
}

function isNationalTeamMatch(leagueId?: string, leagueName?: string): boolean {
  if (leagueId && NATIONAL_TEAM_COMPETITIONS.has(leagueId)) return true
  const name = (leagueName || '').toLowerCase()
  return /world cup|euro(pean championship)?|copa america|nations league|gold cup|international friendl/.test(name)
}



export default function MatchDetailPage() {
  const params = useParams()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const matchId = params.id as string
  const leagueId = searchParams.get('league') || ''

  const { asQueryParam: genderParam } = useGenderQuery()
  const [match, setMatch] = useState<MatchDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0) // bump to refetch (retry button + live polling)
  const [trackedTeams, setTrackedTeams] = useState<WatchTeam[]>([])

  // ?tab= deep link is the source of truth. Legacy values
  // (summary/ai/lineup/…) are normalised onto the new tab set.
  const requestedTab = searchParams.get('tab')
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
  const isFinished = !!match && (match.status.includes('FINAL') || match.status.toLowerCase().includes('finished') || match.status.toLowerCase().includes('ft'))

  // Ref to the match hero <section>. StickyScoreBar uses an IntersectionObserver
  // on this to know when to slide down into view.
  const heroRef = useRef<HTMLElement | null>(null)
  const trackedNameSet = useMemo(
    () => new Set(trackedTeams.map((team) => normalizeTeamName(team.name))),
    [trackedTeams]
  )


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
          // The shared card, straight through. This object is rebuilt field by
          // field rather than spread, so anything not named here is silently
          // dropped — which is exactly what happened to `card` the first time.
          card: data.card ?? null,
          recorded: data.recorded ?? null,
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
              `${ESPN_V2}/${data.leagueId}/standings`
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

  // Additional derived state (isLive, isHalftime and isFinished already computed above before hooks)
  const isScheduled = match.status.toLowerCase().includes('scheduled') || match.status.toLowerCase().includes('pre')
  const activeTab: DetailTab = normalizeDetailTab(requestedTab)

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

      {/* The card — the SAME component `/season/fixture` and
          `/tournaments/tie` render, so one fixture looks like one product
          wherever you reach it from. Its header carries the crests, the score,
          the ground, the date and the referee, which is why this page stopped
          drawing its own above it.

          The two things this page has and they do not — the full prediction
          breakdown and the league table — ride in as extra tabs rather than as
          a second layout. That is what `extraTabs` is for. */}
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
        {match.card ? (
          <MatchDetail
            card={match.card}
            competitionId={match.leagueId}
            initialTab={CARD_TAB[activeTab]}
            heading={
              leagueAccent && leagueAccent.competitionId !== 'unknown'
                ? leagueAccent.displayName
                : match.league
            }
            model={
              // The recorded forecast first: it is the one that was written
              // down before kickoff and can be scored. The live prediction is
              // the fallback, and makes neither claim.
              match.recorded ? (
                <RecordedForecastPanel
                  recorded={match.recorded}
                  homeName={match.home_team}
                  awayName={match.away_team}
                />
              ) : match.prediction ? (
                <>
                  <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    What the model expected
                  </h2>
                  <ProbabilityBar
                    className="mt-3"
                    probabilities={{
                      home: match.prediction.home_win,
                      draw: match.prediction.draw,
                      away: match.prediction.away_win,
                    }}
                    homeLabel={match.home_team}
                    awayLabel={match.away_team}
                  />
                </>
              ) : null
            }
            extraTabs={[
              {
                label: 'Prediction',
                has: true,
                render: () => (
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
                ),
              },
              {
                label: 'Table',
                has: (match.fullStandings?.length ?? 0) > 0,
                render: () => <TableTab match={match} />,
              },
            ]}
          />
        ) : (
          /* No ESPN summary for this fixture — a FotMob-sourced match, or ESPN
             unreachable. The old layout still answers rather than the page
             showing nothing, but it carries no scoreline of its own, and this
             page stopped drawing one when the shared card took over. Without
             this the reader gets momentum and events for a match whose score
             is nowhere on the page. */
          <div className="space-y-5">
            <header className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 pb-4 pt-4 md:px-5">
              <p className="text-center font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                {leagueAccent && leagueAccent.competitionId !== 'unknown'
                  ? leagueAccent.displayName
                  : match.league}
              </p>
              <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 md:gap-4">
                <span className="col-start-1 min-w-0 truncate text-[15px] font-semibold leading-tight text-[var(--text-primary)] md:text-[18px]">
                  {match.home_team}
                </span>
                <div className="col-start-2 px-1 text-center">
                  {match.home_score === null || match.away_score === null ? (
                    <div className="font-mono text-[15px] uppercase leading-none tracking-[0.14em] text-[var(--text-tertiary)] md:text-[17px]">
                      vs
                    </div>
                  ) : (
                    <div className="font-mono text-[26px] leading-none tabular-nums text-[var(--text-primary)] md:text-[32px]">
                      {match.home_score}
                      <span className="mx-1.5 text-[var(--text-tertiary)]">-</span>
                      {match.away_score}
                    </div>
                  )}
                  <div className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                    {isFinished ? 'FT' : isScheduled ? 'Not started' : match.status}
                  </div>
                </div>
                <span className="col-start-3 min-w-0 truncate text-right text-[15px] font-semibold leading-tight text-[var(--text-primary)] md:text-[18px]">
                  {match.away_team}
                </span>
              </div>
            </header>
            <OverviewTab
              match={match}
              isLive={isLive}
              isFinished={isFinished}
              isScheduled={isScheduled}
              onSelectTab={selectTab}
            />
          </div>
        )}
      </div>
    </div>
  )
}
