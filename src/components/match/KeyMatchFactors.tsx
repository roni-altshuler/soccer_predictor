'use client'

import { useEffect, useState } from 'react'

import TeamForm from '@/components/team/TeamForm'
import { FactorMeters, FormTrend, type FactorMeterDatum } from '@/components/viz'

interface RecentMatch {
  date: string
  result: string
  goals_for: number
  goals_against: number
  venue: string
  opponent: string
}

interface TeamFactors {
  form_results: string[]
  form_pts: number // points from last 5 (0-15)
  /** Per-game averages over the last 10 matches (the "baseline" window). */
  goals_scored_avg: number
  goals_conceded_avg: number
  /** Per-game averages over the last 5 matches (the "recent" window). */
  goals_scored_avg5: number
  goals_conceded_avg5: number
  clean_sheet_pct: number
  home_away_record: string // e.g. "3W 1D 1L" last 5 home/away
  streak: string // e.g. "3W" or "2L"
  days_rest: number | null
  matches_counted: number
  recent_matches: RecentMatch[]
}

interface Factors {
  home: TeamFactors
  away: TeamFactors
  h2h_breakdown: { homeWins: number; draws: number; awayWins: number }
  h2h_avg_goals: number
  venue_factor: string
}

interface Props {
  homeTeam: string
  awayTeam: string
  leagueId?: string
  matchDate?: string
}

const EMPTY_TEAM: TeamFactors = {
  form_results: [],
  form_pts: 0,
  goals_scored_avg: 0,
  goals_conceded_avg: 0,
  goals_scored_avg5: 0,
  goals_conceded_avg5: 0,
  clean_sheet_pct: 0,
  home_away_record: '',
  streak: '',
  days_rest: null,
  matches_counted: 0,
  recent_matches: [],
}

/**
 * Pure rule mapping: turn the two teams' recent-window numbers into
 * advantage/risk factor meters. Every meter is backed by a real field —
 * teams without match data contribute nothing (no 0-vs-0 rows).
 */
function buildFactorMeters(
  factors: Factors,
  homeTeam: string,
  awayTeam: string
): FactorMeterDatum[] {
  const meters: FactorMeterDatum[] = []
  const { home, away } = factors
  const bothHaveForm = home.form_results.length > 0 && away.form_results.length > 0

  if (bothHaveForm) {
    const formDiff = home.form_pts - away.form_pts
    if (Math.abs(formDiff) >= 2) {
      const leader = formDiff > 0 ? homeTeam : awayTeam
      meters.push({
        label: `Form edge — ${leader}`,
        value: Math.min(1, Math.abs(formDiff) / 9),
        tone: 'advantage',
        detail: `${home.form_pts}/15 vs ${away.form_pts}/15 points across the last five matches.`,
      })
    }

    const attackDiff = home.goals_scored_avg - away.goals_scored_avg
    if (Math.abs(attackDiff) >= 0.25) {
      const leader = attackDiff > 0 ? homeTeam : awayTeam
      meters.push({
        label: `Sharper attack — ${leader}`,
        value: Math.min(1, Math.abs(attackDiff) / 1.5),
        tone: 'advantage',
        detail: `${home.goals_scored_avg.toFixed(1)} vs ${away.goals_scored_avg.toFixed(1)} goals scored per game recently.`,
      })
    }

    const defenseDiff = away.goals_conceded_avg - home.goals_conceded_avg
    if (Math.abs(defenseDiff) >= 0.25) {
      const leader = defenseDiff > 0 ? homeTeam : awayTeam
      meters.push({
        label: `Tighter defence — ${leader}`,
        value: Math.min(1, Math.abs(defenseDiff) / 1.5),
        tone: 'advantage',
        detail: `${home.goals_conceded_avg.toFixed(1)} vs ${away.goals_conceded_avg.toFixed(1)} goals conceded per game recently.`,
      })
    }
  }

  const h2hTotal =
    factors.h2h_breakdown.homeWins + factors.h2h_breakdown.draws + factors.h2h_breakdown.awayWins
  if (h2hTotal >= 3) {
    const diff = factors.h2h_breakdown.homeWins - factors.h2h_breakdown.awayWins
    if (Math.abs(diff) >= 2) {
      const leader = diff > 0 ? homeTeam : awayTeam
      meters.push({
        label: `Head-to-head record — ${leader}`,
        value: Math.min(1, Math.abs(diff) / h2hTotal),
        tone: 'advantage',
        detail: `${factors.h2h_breakdown.homeWins}W ${factors.h2h_breakdown.draws}D ${factors.h2h_breakdown.awayWins}L across ${h2hTotal} recent meetings.`,
      })
    }
  }

  // Risk factors — short turnarounds and cold streaks.
  for (const [team, tf] of [
    [homeTeam, home],
    [awayTeam, away],
  ] as const) {
    if (tf.days_rest !== null && tf.days_rest <= 3) {
      meters.push({
        label: `Short turnaround — ${team}`,
        value: Math.min(1, (4 - tf.days_rest) / 3),
        tone: 'risk',
        detail: `Only ${tf.days_rest} day${tf.days_rest === 1 ? '' : 's'} since their last match.`,
      })
    }
    const coldStreak = tf.streak.match(/^(\d+)L$/)
    if (coldStreak && Number(coldStreak[1]) >= 2) {
      meters.push({
        label: `Cold streak — ${team}`,
        value: Math.min(1, Number(coldStreak[1]) / 5),
        tone: 'risk',
        detail: `${coldStreak[1]} straight defeats coming into this one.`,
      })
    }
  }

  return meters.slice(0, 6)
}

export default function KeyMatchFactors({ homeTeam, awayTeam, leagueId, matchDate }: Props) {
  const [factors, setFactors] = useState<Factors | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchFactors = async () => {
      try {
        setLoading(true)
        const leagueParam = leagueId || 'all'
        const [homeResponse, awayResponse] = await Promise.all([
          fetch(`/api/team_form/${encodeURIComponent(leagueParam)}/${encodeURIComponent(homeTeam)}?opponent=${encodeURIComponent(awayTeam)}`, { cache: 'no-store' }),
          fetch(`/api/team_form/${encodeURIComponent(leagueParam)}/${encodeURIComponent(awayTeam)}?opponent=${encodeURIComponent(homeTeam)}`, { cache: 'no-store' }),
        ])

        const homeRes = homeResponse.ok ? await homeResponse.json() : null
        const awayRes = awayResponse.ok ? await awayResponse.json() : null

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const buildTeamFactors = (data: any, isHome: boolean): TeamFactors => {
          if (!data?.matches?.length) return EMPTY_TEAM

          const matches = data.matches.slice(0, 10)
          const last5: RecentMatch[] = matches.slice(0, 5)

          // Form string (last 5) — API returns result as "win"/"loss"/"draw"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const formResults = last5.map((m: any) => {
            const rawResult = String(m.result || '').toLowerCase()
            if (rawResult === 'win' || rawResult === 'w') return 'W'
            if (rawResult === 'loss' || rawResult === 'l') return 'L'
            return 'D'
          })
          const form_pts = formResults.reduce((s: number, r: string) =>
            s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0)

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const avg = (rows: any[], field: 'goals_for' | 'goals_against') =>
            rows.length > 0
              ? rows.reduce((s: number, m) => s + (m[field] ?? 0), 0) / rows.length
              : 0
          const goals_scored_avg = avg(matches, 'goals_for')
          const goals_conceded_avg = avg(matches, 'goals_against')
          const goals_scored_avg5 = avg(last5, 'goals_for')
          const goals_conceded_avg5 = avg(last5, 'goals_against')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const clean_sheet_pct = matches.filter((m: any) =>
            (m.goals_against ?? 0) === 0).length / matches.length

          // Venue-specific record (last 5 at home or away)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const venueMatches = matches.filter((m: any) =>
            isHome ? m.venue === 'home' : m.venue === 'away'
          ).slice(0, 5)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const vW = venueMatches.filter((m: any) => m.result === 'win').length
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const vD = venueMatches.filter((m: any) => m.result === 'draw').length
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const vL = venueMatches.filter((m: any) => m.result === 'loss').length
          const home_away_record = venueMatches.length > 0 ? `${vW}W ${vD}D ${vL}L` : ''

          // Current streak
          let streakCount = 1
          const firstResult = formResults[0]
          for (let i = 1; i < formResults.length; i++) {
            if (formResults[i] === firstResult) streakCount++
            else break
          }
          const streak = firstResult ? `${streakCount}${firstResult}` : ''

          // Days rest from most recent match
          let days_rest: number | null = null
          if (matches[0]?.date && matchDate) {
            const lastMatchDate = new Date(matches[0].date)
            const thisMatchDate = new Date(matchDate)
            days_rest = Math.round((thisMatchDate.getTime() - lastMatchDate.getTime()) / (1000 * 60 * 60 * 24))
            if (days_rest < 0 || days_rest > 30) days_rest = null
          }

          return {
            form_results: formResults,
            form_pts,
            goals_scored_avg,
            goals_conceded_avg,
            goals_scored_avg5,
            goals_conceded_avg5,
            clean_sheet_pct,
            home_away_record,
            streak,
            days_rest,
            matches_counted: matches.length,
            recent_matches: last5,
          }
        }

        const home = buildTeamFactors(homeRes, true)
        const away = buildTeamFactors(awayRes, false)

        const h2hHomeWins = Number(homeRes?.h2h?.teamWins ?? homeRes?.h2h?.homeWins ?? 0)
        const h2hDraws = Number(homeRes?.h2h?.draws ?? 0)
        const h2hAwayWins = Number(homeRes?.h2h?.opponentWins ?? homeRes?.h2h?.awayWins ?? 0)
        const h2hAvgGoals = Number(homeRes?.h2h?.avgGoals ?? 0)

        const parseVenueRecord = (record: string) => {
          const match = record.match(/(\d+)W\s+(\d+)D\s+(\d+)L/)
          if (!match) return null
          return { wins: Number(match[1]), draws: Number(match[2]), losses: Number(match[3]) }
        }

        // Venue factor — only when both venue samples exist.
        let venueFactor = ''
        const homeVenue = parseVenueRecord(home.home_away_record)
        const awayVenue = parseVenueRecord(away.home_away_record)
        if (homeVenue && awayVenue) {
          const homeVenuePoints = (homeVenue.wins * 3) + homeVenue.draws
          const awayVenuePoints = (awayVenue.wins * 3) + awayVenue.draws
          const venueSample = Math.max(homeVenue.wins + homeVenue.draws + homeVenue.losses, awayVenue.wins + awayVenue.draws + awayVenue.losses, 1)
          const homeRate = homeVenuePoints / (venueSample * 3)
          const awayRate = awayVenuePoints / (venueSample * 3)
          if (homeRate - awayRate >= 0.2) venueFactor = 'Home venue trend favours the host'
          else if (awayRate - homeRate >= 0.2) venueFactor = 'Away side travels well in the recent sample'
          else venueFactor = 'Venue split is balanced'
        }

        setFactors({
          home,
          away,
          h2h_breakdown: { homeWins: h2hHomeWins, draws: h2hDraws, awayWins: h2hAwayWins },
          h2h_avg_goals: h2hAvgGoals,
          venue_factor: venueFactor,
        })
      } catch {
        setFactors(null)
      } finally {
        setLoading(false)
      }
    }

    if (homeTeam && awayTeam) fetchFactors()
  }, [homeTeam, awayTeam, leagueId, matchDate])

  // Missing data renders nothing — never spinners-in-a-card or 0-vs-0 rows.
  if (loading || !factors) return null

  const { home, away } = factors
  const homeHasData = home.matches_counted > 0
  const awayHasData = away.matches_counted > 0
  const h2hTotal =
    factors.h2h_breakdown.homeWins + factors.h2h_breakdown.draws + factors.h2h_breakdown.awayWins
  if (!homeHasData && !awayHasData && h2hTotal === 0) return null

  const meters = buildFactorMeters(factors, homeTeam, awayTeam)

  const teamPanels = [
    { team: homeTeam, tf: home, has: homeHasData, tint: 'var(--team-tint-home, var(--accent-primary))' },
    { team: awayTeam, tf: away, has: awayHasData, tint: 'var(--team-tint-away, var(--accent-info))' },
  ]

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      <div className="border-b border-[var(--border-color)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Key match factors</h3>
        <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
          Form, goals and head-to-head going into kickoff
        </p>
      </div>

      <div className="space-y-5 p-4">
        {/* Recent form + last-5-vs-last-10 trend, per team with data */}
        {(homeHasData || awayHasData) && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {teamPanels.map(({ team, tf, has, tint }) =>
              has ? (
                <div
                  key={team}
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] p-3"
                >
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="h-4 w-1 shrink-0 rounded-full"
                        style={{ background: tint }}
                      />
                      <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{team}</span>
                    </span>
                    {tf.form_results.length > 0 && (
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                        {tf.form_pts}/15 pts
                      </span>
                    )}
                  </div>
                  {tf.form_results.length > 0 && (
                    <TeamForm
                      form={tf.form_results}
                      size="sm"
                      matchDetails={tf.recent_matches.map((match) => ({
                        date: match.date,
                        opponent: match.opponent,
                        venue: match.venue,
                        goals_for: match.goals_for,
                        goals_against: match.goals_against,
                      }))}
                    />
                  )}
                  {/* Last 5 vs last 10 — the FormTrend "hot or cooling" read.
                      A metric renders only when either window is non-zero
                      (0.0-vs-0.0 rows read as fabricated data). */}
                  {tf.matches_counted > 5 &&
                    (tf.goals_scored_avg > 0 ||
                      tf.goals_scored_avg5 > 0 ||
                      tf.goals_conceded_avg > 0 ||
                      tf.goals_conceded_avg5 > 0) && (
                    <div className="mt-3 space-y-3 border-t border-[var(--border-color)] pt-3">
                      {(tf.goals_scored_avg > 0 || tf.goals_scored_avg5 > 0) && (
                        <FormTrend
                          label="Goals scored"
                          baseline={tf.goals_scored_avg}
                          recent={tf.goals_scored_avg5}
                          decimals={1}
                          baselineLabel="Last 10"
                          recentLabel="Last 5"
                        />
                      )}
                      {(tf.goals_conceded_avg > 0 || tf.goals_conceded_avg5 > 0) && (
                        <FormTrend
                          label="Goals conceded"
                          baseline={tf.goals_conceded_avg}
                          recent={tf.goals_conceded_avg5}
                          decimals={1}
                          higherIsBetter={false}
                          baselineLabel="Last 10"
                          recentLabel="Last 5"
                        />
                      )}
                    </div>
                  )}
                  {/* Quiet fact chips — only fields that exist */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {tf.streak && (
                      <span className="rounded border border-[var(--border-color)] bg-[var(--muted-bg)] px-1.5 py-px text-[10px] font-semibold tabular-nums text-[var(--text-secondary)]">
                        Streak {tf.streak}
                      </span>
                    )}
                    {tf.days_rest !== null && (
                      <span className="rounded border border-[var(--border-color)] bg-[var(--muted-bg)] px-1.5 py-px text-[10px] font-semibold tabular-nums text-[var(--text-secondary)]">
                        {tf.days_rest}d rest
                      </span>
                    )}
                    {tf.home_away_record && (
                      <span className="rounded border border-[var(--border-color)] bg-[var(--muted-bg)] px-1.5 py-px text-[10px] font-semibold tabular-nums text-[var(--text-secondary)]">
                        {tf === home ? 'Home' : 'Away'} {tf.home_away_record}
                      </span>
                    )}
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}

        {/* Advantage / risk meters (viz kit) — rendered only when rules fire */}
        {meters.length > 0 && (
          <div>
            <p className="mb-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              What separates the sides
            </p>
            <FactorMeters factors={meters} />
          </div>
        )}

        {/* H2H snapshot — only with a real sample */}
        {h2hTotal > 0 && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Head-to-head</p>
              {factors.h2h_avg_goals > 0 && (
                <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">
                  Avg goals {factors.h2h_avg_goals.toFixed(1)}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm tabular-nums">
              <span className="font-semibold text-[var(--team-tint-home)]">
                {factors.h2h_breakdown.homeWins}W
              </span>
              <span className="text-[var(--text-tertiary)]">{factors.h2h_breakdown.draws}D</span>
              <span className="font-semibold text-[var(--team-tint-away)]">
                {factors.h2h_breakdown.awayWins}W
              </span>
            </div>
            {factors.venue_factor && (
              <p className="mt-2 text-[11px] text-[var(--text-secondary)]">{factors.venue_factor}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
