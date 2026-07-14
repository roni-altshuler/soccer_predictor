'use client'

import { HeadToHeadDisplay } from '@/components/match'

import type { MatchDetails } from './types'

/**
 * H2H tab — the page already fetched the head-to-head block with the match
 * payload, so it is always passed down as initialData (no duplicate
 * `/api/match/[id]` fetch). Derived tiles (avg goals) are computed by the
 * display component from the real recent-meeting list — no fake zeros.
 */
export function H2HTab({ match }: { match: MatchDetails }) {
  const totalMeetings = match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins
  const hasH2H = totalMeetings > 0 || match.h2h.recentMatches.length > 0

  return (
    <div className="space-y-6">
      <HeadToHeadDisplay
        homeTeam={match.home_team}
        awayTeam={match.away_team}
        leagueId={match.leagueId}
        initialData={
          hasH2H
            ? {
                totalMatches: totalMeetings,
                team1: {
                  name: match.home_team,
                  wins: match.h2h.homeWins,
                  ...(match.h2h.homeGoals != null ? { goals: match.h2h.homeGoals } : {}),
                },
                team2: {
                  name: match.away_team,
                  wins: match.h2h.awayWins,
                  ...(match.h2h.awayGoals != null ? { goals: match.h2h.awayGoals } : {}),
                },
                draws: match.h2h.draws,
                // avgGoalsPerMatch intentionally omitted — the display derives
                // it from the recent meetings instead of a fabricated 0.
                recentMatches: match.h2h.recentMatches.map((m, idx) => ({
                  id: `h2h-${idx}`,
                  date: m.date,
                  competition: '',
                  homeTeam: m.homeTeam || match.home_team,
                  awayTeam: m.awayTeam || match.away_team,
                  homeScore: m.home_score,
                  awayScore: m.away_score,
                  winner:
                    m.home_score > m.away_score
                      ? ('home' as const)
                      : m.away_score > m.home_score
                        ? ('away' as const)
                        : ('draw' as const),
                })),
              }
            : undefined
        }
      />
    </div>
  )
}
