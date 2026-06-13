'use client'

import { useEffect, useState } from 'react'
import TeamForm from '@/components/team/TeamForm'

interface TeamFactors {
  form_5: string           // e.g. "W W D L W"
  form_results: string[]
  form_pts: number         // points from last 5 (0-15)
  goals_scored_avg: number
  goals_conceded_avg: number
  clean_sheet_pct: number
  home_away_record: string // e.g. "3W 1D 1L" last 5 home/away
  streak: string           // e.g. "3W" or "2L"
  days_rest: number | null
  recent_matches: Array<{
    date: string
    result: string
    goals_for: number
    goals_against: number
    venue: string
    opponent: string
  }>
}

interface Factors {
  home: TeamFactors
  away: TeamFactors
  h2h_summary: string       // e.g. "Home leads 5-2 (3 draws)"
  h2h_avg_goals: number
  h2h_breakdown: {
    homeWins: number
    draws: number
    awayWins: number
  }
  venue_factor: string       // e.g. "Strong home fortress" or "Neutral"
  league_draw_rate: number
  league_avg_goals: number
  key_edges: Array<{
    title: string
    lean: 'home' | 'away' | 'neutral'
    detail: string
  }>
}

interface Props {
  homeTeam: string
  awayTeam: string
  leagueId?: string
  matchDate?: string
}

function StatBar({ label, homeVal, awayVal, unit, higherIsBetter = true }: {
  label: string; homeVal: number; awayVal: number; unit?: string; higherIsBetter?: boolean
}) {
  const max = Math.max(homeVal, awayVal, 0.01)
  const homePct = (homeVal / max) * 100
  const awayPct = (awayVal / max) * 100
  const homeIsBetter = higherIsBetter ? homeVal >= awayVal : homeVal <= awayVal
  const awayIsBetter = !homeIsBetter

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        <span className={homeIsBetter ? 'font-semibold text-[var(--accent-primary)]' : ''}>
          {homeVal.toFixed(2)}{unit}
        </span>
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
        <span className={awayIsBetter ? 'font-semibold text-[var(--accent-primary)]' : ''}>
          {awayVal.toFixed(2)}{unit}
        </span>
      </div>
      <div className="flex gap-1 h-1.5">
        <div className="flex-1 flex justify-end">
          <div
            className="h-full rounded-l-full transition-all"
            style={{
              width: `${homePct}%`,
              background: homeIsBetter ? 'var(--accent-primary)' : 'var(--border-color)',
            }}
          />
        </div>
        <div className="flex-1">
          <div
            className="h-full rounded-r-full transition-all"
            style={{
              width: `${awayPct}%`,
              background: awayIsBetter ? 'var(--accent-primary)' : 'var(--border-color)',
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default function KeyMatchFactors({ homeTeam, awayTeam, leagueId, matchDate }: Props) {
  const [factors, setFactors] = useState<Factors | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const fetchFactors = async () => {
      try {
        setLoading(true)
        // Fetch recent results for both teams from backend
        setError(false)
        const leagueParam = leagueId || 'all'
        const [homeResponse, awayResponse] = await Promise.all([
          fetch(`/api/team_form/${encodeURIComponent(leagueParam)}/${encodeURIComponent(homeTeam)}?opponent=${encodeURIComponent(awayTeam)}`, { cache: 'no-store' }),
          fetch(`/api/team_form/${encodeURIComponent(leagueParam)}/${encodeURIComponent(awayTeam)}?opponent=${encodeURIComponent(homeTeam)}`, { cache: 'no-store' }),
        ])

        const homeRes = homeResponse.ok ? await homeResponse.json() : null
        const awayRes = awayResponse.ok ? await awayResponse.json() : null

        const buildTeamFactors = (data: any, isHome: boolean): TeamFactors => {
          if (!data?.matches?.length) {
            return {
              form_5: '- - - - -',
              form_results: [],
              form_pts: 0,
              goals_scored_avg: 0,
              goals_conceded_avg: 0,
              clean_sheet_pct: 0,
              home_away_record: 'N/A',
              streak: '-',
              days_rest: null,
              recent_matches: [],
            }
          }

          const matches = data.matches.slice(0, 10)
          const last5 = matches.slice(0, 5)

          // Form string (last 5) — API returns result as "win"/"loss"/"draw"
          const formResults = last5.map((m: any) => {
            const rawResult = String(m.result || '').toLowerCase()
            if (rawResult === 'win' || rawResult === 'w') return 'W'
            if (rawResult === 'loss' || rawResult === 'l') return 'L'
            return 'D'
          })
          const form_5 = formResults.join(' ') || '- - - - -'
          const form_pts = formResults.reduce((s: number, r: string) =>
            s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0)

          // Goals averages from match-level data
          const goals_scored_avg = matches.reduce((s: number, m: any) =>
            s + (m.goals_for ?? 0), 0) / matches.length
          const goals_conceded_avg = matches.reduce((s: number, m: any) =>
            s + (m.goals_against ?? 0), 0) / matches.length
          const clean_sheet_pct = matches.filter((m: any) =>
            (m.goals_against ?? 0) === 0).length / matches.length

          // Venue-specific record (last 5 at home or away)
          const venueMatches = matches.filter((m: any) =>
            isHome ? m.venue === 'home' : m.venue === 'away'
          ).slice(0, 5)
          const vW = venueMatches.filter((m: any) => m.result === 'win').length
          const vD = venueMatches.filter((m: any) => m.result === 'draw').length
          const vL = venueMatches.filter((m: any) => m.result === 'loss').length
          const home_away_record = venueMatches.length > 0
            ? `${vW}W ${vD}D ${vL}L`
            : 'N/A'

          // Current streak
          let streakCount = 1
          const firstResult = formResults[0]
          for (let i = 1; i < formResults.length; i++) {
            if (formResults[i] === firstResult) streakCount++
            else break
          }
          const streak = `${streakCount}${firstResult || '-'}`

          // Days rest from most recent match
          let days_rest: number | null = null
          if (matches[0]?.date && matchDate) {
            const lastMatchDate = new Date(matches[0].date)
            const thisMatchDate = new Date(matchDate)
            days_rest = Math.round((thisMatchDate.getTime() - lastMatchDate.getTime()) / (1000 * 60 * 60 * 24))
            if (days_rest < 0 || days_rest > 30) days_rest = null
          }

          return {
            form_5,
            form_results: formResults,
            form_pts,
            goals_scored_avg,
            goals_conceded_avg,
            clean_sheet_pct,
            home_away_record,
            streak,
            days_rest,
            recent_matches: last5,
          }
        }

        const home = buildTeamFactors(homeRes, true)
        const away = buildTeamFactors(awayRes, false)

        const h2hHomeWins = Number(homeRes?.h2h?.teamWins ?? homeRes?.h2h?.homeWins ?? 0)
        const h2hDraws = Number(homeRes?.h2h?.draws ?? 0)
        const h2hAwayWins = Number(homeRes?.h2h?.opponentWins ?? homeRes?.h2h?.awayWins ?? 0)
        const h2hTotal = h2hHomeWins + h2hDraws + h2hAwayWins
        const h2hSummary = h2hTotal > 0
          ? `${h2hHomeWins}W ${h2hDraws}D ${h2hAwayWins}L`
          : 'No recent H2H data'
        const h2hAvgGoals = Number(homeRes?.h2h?.avgGoals ?? 0) || (home.goals_scored_avg + away.goals_scored_avg)

        const parseVenueRecord = (record: string) => {
          const match = record.match(/(\d+)W\s+(\d+)D\s+(\d+)L/)
          if (!match) return null
          return {
            wins: Number(match[1]),
            draws: Number(match[2]),
            losses: Number(match[3]),
          }
        }

        // Venue factor
        let venueFactor = 'Neutral venue'
        const homeVenue = parseVenueRecord(home.home_away_record)
        const awayVenue = parseVenueRecord(away.home_away_record)
        if (homeVenue && awayVenue) {
          const homeVenuePoints = (homeVenue.wins * 3) + homeVenue.draws
          const awayVenuePoints = (awayVenue.wins * 3) + awayVenue.draws
          const venueSample = Math.max(homeVenue.wins + homeVenue.draws + homeVenue.losses, awayVenue.wins + awayVenue.draws + awayVenue.losses, 1)
          const homeRate = homeVenuePoints / (venueSample * 3)
          const awayRate = awayVenuePoints / (venueSample * 3)
          if (homeRate - awayRate >= 0.2) venueFactor = 'Home venue trend favors the host'
          else if (awayRate - homeRate >= 0.2) venueFactor = 'Away side travels well in recent sample'
          else venueFactor = 'Venue split is balanced'
        }

        const formDiff = home.form_pts - away.form_pts
        const attackDiff = home.goals_scored_avg - away.goals_scored_avg
        const defenseDiff = away.goals_conceded_avg - home.goals_conceded_avg
        const h2hDiff = h2hHomeWins - h2hAwayWins

        const keyEdges: Factors['key_edges'] = [
          {
            title: 'Recent form edge',
            lean: formDiff > 1 ? 'home' : formDiff < -1 ? 'away' : 'neutral',
            detail: `${home.form_pts}/15 vs ${away.form_pts}/15 points (last 5)`,
          },
          {
            title: 'Attacking output',
            lean: attackDiff > 0.2 ? 'home' : attackDiff < -0.2 ? 'away' : 'neutral',
            detail: `${home.goals_scored_avg.toFixed(2)} vs ${away.goals_scored_avg.toFixed(2)} goals scored per game`,
          },
          {
            title: 'Defensive resistance',
            lean: defenseDiff > 0.2 ? 'home' : defenseDiff < -0.2 ? 'away' : 'neutral',
            detail: `${home.goals_conceded_avg.toFixed(2)} vs ${away.goals_conceded_avg.toFixed(2)} goals conceded per game`,
          },
          {
            title: 'H2H trend',
            lean: h2hDiff > 0 ? 'home' : h2hDiff < 0 ? 'away' : 'neutral',
            detail: h2hTotal > 0 ? `${h2hSummary} in recent direct meetings` : 'Insufficient direct-meeting sample',
          },
        ]

        setFactors({
          home,
          away,
          h2h_summary: h2hSummary,
          h2h_avg_goals: h2hAvgGoals,
          h2h_breakdown: {
            homeWins: h2hHomeWins,
            draws: h2hDraws,
            awayWins: h2hAwayWins,
          },
          venue_factor: venueFactor,
          league_draw_rate: 0.26,
          league_avg_goals: 2.65,
          key_edges: keyEdges,
        })
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    if (homeTeam && awayTeam) fetchFactors()
  }, [homeTeam, awayTeam, leagueId, matchDate])

  if (loading) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-2xl p-6" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <span>📊</span> Key Match Factors
        </h3>
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent-primary)' }} />
        </div>
      </div>
    )
  }

  if (error || !factors) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-2xl p-6" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <span>📊</span> Key Match Factors
        </h3>
        <p className="text-sm text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
          Match factor data not available
        </p>
      </div>
    )
  }

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <span>📊</span> Key Match Factors
        </h3>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          Research-backed indicators driving the prediction model
        </p>
      </div>

      <div className="p-4 space-y-5">
        {/* Team names header */}
        <div className="flex justify-between text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          <span>{homeTeam}</span>
          <span>{awayTeam}</span>
        </div>

        {/* Recent Form */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-center mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Recent Form (Last 5)
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-color)', background: 'var(--muted-bg)' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-[var(--text-primary)]">{homeTeam}</span>
                <span className="text-[11px] text-[var(--text-tertiary)]">{factors.home.form_pts}/15 pts</span>
              </div>
              <TeamForm
                form={factors.home.form_results}
                size="sm"
                matchDetails={factors.home.recent_matches.map((match) => ({
                  date: match.date,
                  opponent: match.opponent,
                  venue: match.venue,
                  goals_for: match.goals_for,
                  goals_against: match.goals_against,
                }))}
              />
            </div>
            <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-color)', background: 'var(--muted-bg)' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-[var(--text-primary)]">{awayTeam}</span>
                <span className="text-[11px] text-[var(--text-tertiary)]">{factors.away.form_pts}/15 pts</span>
              </div>
              <TeamForm
                form={factors.away.form_results}
                size="sm"
                matchDetails={factors.away.recent_matches.map((match) => ({
                  date: match.date,
                  opponent: match.opponent,
                  venue: match.venue,
                  goals_for: match.goals_for,
                  goals_against: match.goals_against,
                }))}
              />
            </div>
          </div>
        </div>

        {/* Streaks & Rest */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-[var(--bg-secondary)] rounded-xl p-2.5">
            <p className="text-[10px] uppercase mb-1" style={{ color: 'var(--text-tertiary)' }}>Streak</p>
            <div className="flex justify-between px-2">
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {factors.home.streak}
              </span>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {factors.away.streak}
              </span>
            </div>
          </div>
          <div className="bg-[var(--bg-secondary)] rounded-xl p-2.5">
            <p className="text-[10px] uppercase mb-1" style={{ color: 'var(--text-tertiary)' }}>Rest Days</p>
            <div className="flex justify-between px-2">
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {factors.home.days_rest ?? '–'}
              </span>
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {factors.away.days_rest ?? '–'}
              </span>
            </div>
          </div>
          <div className="bg-[var(--bg-secondary)] rounded-xl p-2.5">
            <p className="text-[10px] uppercase mb-1" style={{ color: 'var(--text-tertiary)' }}>Venue Record</p>
            <div className="flex justify-between">
              <span className="text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {factors.home.home_away_record}
              </span>
              <span className="text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {factors.away.home_away_record}
              </span>
            </div>
          </div>
        </div>

        {/* Statistical comparisons */}
        <div className="space-y-3">
          <StatBar
            label="Goals Scored /g"
            homeVal={factors.home.goals_scored_avg}
            awayVal={factors.away.goals_scored_avg}
          />
          <StatBar
            label="Goals Conceded /g"
            homeVal={factors.home.goals_conceded_avg}
            awayVal={factors.away.goals_conceded_avg}
            higherIsBetter={false}
          />
          <StatBar
            label="Clean Sheet %"
            homeVal={factors.home.clean_sheet_pct * 100}
            awayVal={factors.away.clean_sheet_pct * 100}
            unit="%"
          />
        </div>

        {/* Matchup context and key edges */}
        <div className="rounded-2xl border p-3.5" style={{ borderColor: 'var(--border-color)', background: 'var(--muted-bg)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>H2H Snapshot</p>
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Avg goals {factors.h2h_avg_goals.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-semibold text-[var(--team-tint-home)]">{factors.h2h_breakdown.homeWins}W</span>
            <span style={{ color: 'var(--text-tertiary)' }}>{factors.h2h_breakdown.draws}D</span>
            <span className="font-semibold text-[var(--team-tint-away)]">{factors.h2h_breakdown.awayWins}W</span>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{factors.venue_factor}</p>
        </div>

        <div className="space-y-2.5">
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Key model factors</p>
          {factors.key_edges.map((edge) => (
            <div key={edge.title} className="rounded-xl border px-3 py-2.5 flex items-start justify-between gap-3" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}>
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">{edge.title}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{edge.detail}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                edge.lean === 'home'
                  ? 'bg-[color-mix(in_srgb,var(--team-tint-home)_20%,transparent)] text-[var(--team-tint-home)]'
                  : edge.lean === 'away'
                    ? 'bg-[color-mix(in_srgb,var(--team-tint-away)_20%,transparent)] text-[var(--team-tint-away)]'
                    : 'bg-[var(--muted-bg)] text-[var(--text-secondary)]'
              }`}>
                {edge.lean === 'home' ? 'Home lean' : edge.lean === 'away' ? 'Away lean' : 'Even'}
              </span>
            </div>
          ))}
        </div>

        {/* Research citation */}
        <div className="text-[10px] text-center pt-2 border-t" style={{ borderColor: 'var(--border-color)', color: 'var(--text-tertiary)' }}>
          Factors based on Geurkink et al. (2021) &amp; Yeung et al. (2024) match prediction research
        </div>
      </div>
    </div>
  )
}
