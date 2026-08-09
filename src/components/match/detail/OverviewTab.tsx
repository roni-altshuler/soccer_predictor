'use client'

import { CalendarDays, CheckCircle2, MapPin, MessageSquareText, Scale, Sparkles, Swords, Zap } from 'lucide-react'

import { EventTimeline } from '@/components/match/EventTimeline'
import BettingIntelligence from '@/components/match/BettingIntelligence'
import DerivedMarkets from '@/components/match/DerivedMarkets'
import HighlightsLink from '@/components/match/HighlightsLink'
import KeyMatchFactors from '@/components/match/KeyMatchFactors'
import MatchEventHeatmap from '@/components/match/MatchEventHeatmap'
import MatchMomentum from '@/components/match/MatchMomentum'
import ShotMap from '@/components/match/ShotMap'
import { PlayerAvatar, Prob1X2, RatingPill, TeamBadge } from '@/components/primitives'
import { NarrativeCard } from '@/components/viz'
import MatchWeather from '@/components/weather/MatchWeather'
import { cn } from '@/lib/utils'

import { getPredictionVerdict } from './adaptPrediction'
import { buildModelInsights } from './insights'
import { LiveWinProbabilityPanel } from './LiveWinProbabilityPanel'
import { MATCH_EVENTS_ANCHOR_ID, MatchStory } from './MatchStory'
import { MomentumRiver } from './MomentumRiver'
import { TopStatsPreview } from './StatsTab'
import { formatMatchDate, type DetailTab, type MatchDetails } from './types'

interface OverviewTabProps {
  match: MatchDetails
  isLive: boolean
  isFinished: boolean
  isScheduled: boolean
  onSelectTab: (tab: DetailTab) => void
}

/* ── Compact AI pick card — MatchRow grammar (1X2 boxes + scoreline chip) ── */

function CompactAIPickCard({
  match,
  isFinished,
  onSelectTab,
}: {
  match: MatchDetails
  isFinished: boolean
  onSelectTab: (tab: DetailTab) => void
}) {
  const p = match.prediction
  if (!p) return null

  const topScoreline = p.derived_markets?.correct_score_top5?.[0]
  const scoreline = topScoreline
    ? `${topScoreline.home}-${topScoreline.away}`
    : p.most_likely_score ??
      `${Math.round(p.predicted_score.home)}-${Math.round(p.predicted_score.away)}`

  const verdict = isFinished ? getPredictionVerdict(match) : null

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
        <Sparkles className="h-4 w-4 text-[var(--accent-ai)]" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI pick</h3>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">
          <span className="tabular-nums text-[var(--text-primary)]">{p.confidence}%</span>
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            {p.confidence_band ?? 'Medium'} confidence
          </span>
        </span>
      </div>

      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Prob1X2 home={p.home_win} draw={p.draw} away={p.away_win} />
            <span className="inline-flex shrink-0 items-center rounded-md bg-[var(--accent-ai)]/10 px-1.5 py-1 text-[10px] font-semibold tabular-nums text-[var(--accent-ai)]">
              AI {scoreline}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSelectTab('prediction')}
            className="inline-flex min-h-[44px] items-center text-sm font-medium text-[var(--accent-primary)] transition-opacity hover:opacity-80"
          >
            Full prediction →
          </button>
        </div>

        {verdict && verdict.message && (
          <div className="mt-3 border-t border-[var(--border-color)] pt-3">
            <p
              className={cn(
                'inline-flex w-full items-center justify-center gap-1.5 text-center text-xs font-semibold',
                verdict.type === 'exact'
                  ? 'text-[var(--accent-primary)]'
                  : verdict.type === 'close'
                    ? 'text-[var(--accent-warn)]'
                    : 'text-[var(--text-tertiary)]'
              )}
            >
              {verdict.type === 'exact' && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
              {verdict.type === 'close' && <Zap className="h-3.5 w-3.5" aria-hidden />}
              {verdict.message}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Player of the match — highest provider rating across both squads ── */

function PlayerOfTheMatchCard({ match, isFinished }: { match: MatchDetails; isFinished: boolean }) {
  const rated = [
    ...match.lineups.home.map((p) => ({ ...p, team: 'home' as const })),
    ...match.lineups.away.map((p) => ({ ...p, team: 'away' as const })),
  ].filter((p) => typeof p.rating === 'number' && Number.isFinite(p.rating))

  if (rated.length === 0) return null

  const best = rated.reduce((a, b) => ((b.rating ?? 0) > (a.rating ?? 0) ? b : a))
  const teamName = best.team === 'home' ? match.home_team : match.away_team
  const tint = best.team === 'home' ? 'var(--team-tint-home)' : 'var(--team-tint-away)'

  const goals = match.events.filter(
    (e) => e.type === 'goal' && e.team === best.team && e.player === best.name
  ).length
  const assists = match.events.filter(
    (e) => e.type === 'goal' && e.team === best.team && e.relatedPlayer === best.name
  ).length

  const chips: string[] = []
  if (goals > 0) chips.push(`${goals} goal${goals === 1 ? '' : 's'}`)
  if (assists > 0) chips.push(`${assists} assist${assists === 1 ? '' : 's'}`)
  if (chips.length === 0 && best.position) chips.push(best.position)

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      <div className="border-b border-[var(--border-color)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {isFinished ? 'Player of the match' : 'Top rated'}
        </h3>
      </div>
      <div className="flex items-center gap-3 p-4">
        <PlayerAvatar playerId={best.id} name={best.name} size={48} teamColor={tint} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{best.name}</p>
          <p className="truncate text-[11px] text-[var(--text-tertiary)]">{teamName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {chips.slice(0, 2).map((chip) => (
            <span
              key={chip}
              className="rounded border border-[var(--border-color)] bg-[var(--muted-bg)] px-2 py-1 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]"
            >
              {chip}
            </span>
          ))}
          {best.rating != null && <RatingPill value={best.rating} />}
        </div>
      </div>
    </div>
  )
}

/* ── H2H mini-card — record bar, recent meetings, season form ── */

function H2HMiniCard({
  match,
  onSelectTab,
}: {
  match: MatchDetails
  onSelectTab: (tab: DetailTab) => void
}) {
  const totalH2H = match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins
  if (totalH2H === 0 && !match.homeStanding && !match.awayStanding) return null

  return (
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Swords className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden /> Head-to-head &amp; form
        </h3>
      </div>
      <div className="p-4 space-y-4">
        {totalH2H > 0 && (() => {
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
              <div className="flex h-6 rounded-lg overflow-hidden text-xs font-bold tabular-nums text-[var(--accent-on-primary)]">
                {homePct > 0 && (
                  <div className="bg-[var(--team-tint-home)] flex items-center justify-center" style={{ width: `${homePct}%` }}>
                    {match.h2h.homeWins}W
                  </div>
                )}
                {drawPct > 0 && (
                  <div className="bg-[var(--accent-warn)] flex items-center justify-center" style={{ width: `${drawPct}%` }}>
                    {match.h2h.draws}D
                  </div>
                )}
                {awayPct > 0 && (
                  <div className="bg-[var(--team-tint-away)] flex items-center justify-center" style={{ width: `${awayPct}%` }}>
                    {match.h2h.awayWins}W
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {match.h2h.recentMatches.length > 0 && (
          <div>
            <p className="text-xs text-[var(--text-tertiary)] mb-2 font-medium uppercase tracking-wide">Recent meetings</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {match.h2h.recentMatches.slice(0, 4).map((m, idx) => {
                const homeWon = m.home_score > m.away_score
                const awayWon = m.away_score > m.home_score
                return (
                  <div key={idx} className="flex items-center justify-between px-3 py-2 bg-[var(--muted-bg)] rounded-lg text-sm">
                    <span className={`flex-1 text-right pr-2 ${homeWon ? 'font-semibold text-[var(--team-tint-home)]' : 'text-[var(--text-secondary)]'}`}>
                      {m.homeTeam || match.home_team}
                    </span>
                    <span className="font-bold tabular-nums text-[var(--text-primary)] px-2">
                      {m.home_score} - {m.away_score}
                    </span>
                    <span className={`flex-1 text-left pl-2 ${awayWon ? 'font-semibold text-[var(--team-tint-away)]' : 'text-[var(--text-secondary)]'}`}>
                      {m.awayTeam || match.away_team}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* A standing with zero matches played (e.g. the new season's empty
            table while viewing last season's match) carries no form — hide it
            rather than render a fake all-zero grid. */}
        {((match.homeStanding?.played ?? 0) > 0 || (match.awayStanding?.played ?? 0) > 0) && (
          <div>
            <p className="text-xs text-[var(--text-tertiary)] mb-2 font-medium uppercase tracking-wide">Season form</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { standing: match.homeStanding, team: match.home_team, tint: 'var(--team-tint-home)' },
                { standing: match.awayStanding, team: match.away_team, tint: 'var(--team-tint-away)' },
              ].map(({ standing, team, tint }) =>
                standing && standing.played > 0 ? (
                  <div key={team} className="bg-[var(--muted-bg)] rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: tint }} />
                      <span className="text-sm font-medium text-[var(--text-primary)]">{team}</span>
                      <span className="text-xs text-[var(--text-tertiary)] ml-auto">#{standing.position}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-center text-xs tabular-nums">
                      <div><p className="text-[var(--text-tertiary)]">P</p><p className="font-medium text-[var(--text-primary)]">{standing.played}</p></div>
                      <div><p className="text-[var(--text-tertiary)]">W</p><p className="font-medium text-[var(--accent-primary)]">{standing.won}</p></div>
                      <div><p className="text-[var(--text-tertiary)]">D</p><p className="font-medium text-[var(--accent-warn)]">{standing.drawn}</p></div>
                      <div><p className="text-[var(--text-tertiary)]">L</p><p className="font-medium text-[var(--accent-loss)]">{standing.lost}</p></div>
                      <div><p className="text-[var(--text-tertiary)]">Pts</p><p className="font-bold text-[var(--text-primary)]">{standing.points}</p></div>
                    </div>
                  </div>
                ) : null
              )}
            </div>
          </div>
        )}

        <button
          onClick={() => onSelectTab('h2h')}
          className="w-full min-h-[44px] text-center text-sm text-[var(--accent-primary)] hover:opacity-80 transition-opacity font-medium"
        >
          View full H2H &amp; form details →
        </button>
      </div>
    </div>
  )
}

/* ── Match info — venue/maps, attendance bar, kickoff, referee ── */

function MatchInfoCard({ match }: { match: MatchDetails }) {
  return (
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="font-semibold text-[var(--text-primary)]">Match info</h3>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
        {match.venue && (
          <a
            href={`https://www.google.com/maps/search/${encodeURIComponent(match.venue)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--muted-bg)] transition-colors"
          >
            <MapPin className="h-5 w-5 text-[var(--text-secondary)]" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{match.venue}</p>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>View on map →</p>
            </div>
            {(match.attendance || match.capacity) && (
              <div className="text-right flex-shrink-0">
                {match.attendance && (
                  <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {match.attendance.toLocaleString()}
                    {match.capacity ? ` / ${match.capacity.toLocaleString()}` : ''}
                  </p>
                )}
                {match.capacity && match.attendance && (
                  <div className="flex items-center gap-1.5 mt-0.5 justify-end">
                    <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--muted-bg)' }}>
                      <div
                        className="h-full rounded-full bg-[var(--accent-primary)]"
                        style={{ width: `${Math.min(100, (match.attendance / match.capacity) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-medium tabular-nums text-[var(--accent-primary)]">
                      {Math.round((match.attendance / match.capacity) * 100)}%
                    </span>
                  </div>
                )}
                {!match.attendance && match.capacity && (
                  <p className="text-[10px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                    Capacity: {match.capacity.toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </a>
        )}
        <div className="flex items-center gap-3 px-4 py-3">
          <CalendarDays className="h-5 w-5 text-[var(--text-secondary)]" aria-hidden />
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formatMatchDate(match.date)}</p>
            <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{match.league}</p>
          </div>
        </div>
        {match.referee && (
          <div className="flex items-center gap-3 px-4 py-3">
            <Scale className="h-5 w-5 text-[var(--text-secondary)]" aria-hidden />
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
  )
}

/* ── Pre-match mini table — ±1 rows around each team, elided in between ── */

function MiniTableSnippet({
  match,
  onSelectTab,
}: {
  match: MatchDetails
  onSelectTab: (tab: DetailTab) => void
}) {
  const rows = match.fullStandings
  if (!rows || rows.length === 0 || !match.homeStanding || !match.awayStanding) return null

  const anchors = [match.homeStanding.position, match.awayStanding.position].sort((a, b) => a - b)
  const indices = new Set<number>()
  for (const pos of anchors) {
    for (const idx of [pos - 2, pos - 1, pos]) {
      if (idx >= 0 && idx < rows.length) indices.add(idx)
    }
  }
  const ordered = [...indices].sort((a, b) => a - b)
  const hasGD = rows.some((r) => r.goalDiff != null)

  const segments: Array<{ row: (typeof rows)[number]; gapBefore: boolean }> = ordered.map(
    (idx, i) => ({ row: rows[idx], gapBefore: i > 0 && ordered[i - 1] !== idx - 1 })
  )

  return (
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="font-semibold text-[var(--text-primary)]">Table</h3>
        <button
          type="button"
          onClick={() => onSelectTab('table')}
          className="min-h-[44px] text-sm font-medium text-[var(--accent-primary)] transition-opacity hover:opacity-80"
        >
          Full table →
        </button>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] text-[var(--text-tertiary)] border-b" style={{ borderColor: 'var(--border-color)' }}>
            <th className="py-1.5 pl-4 pr-2 text-left font-medium">#</th>
            <th className="py-1.5 px-2 text-left font-medium">Team</th>
            <th className="py-1.5 px-2 text-right font-medium">P</th>
            {hasGD && <th className="py-1.5 px-2 text-right font-medium">GD</th>}
            <th className="py-1.5 pl-2 pr-4 text-right font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {segments.map(({ row, gapBefore }) => {
            const isHome = row.position === match.homeStanding?.position
            const isAway = row.position === match.awayStanding?.position
            const highlighted = isHome || isAway
            return (
              <tr
                key={row.position}
                className={cn(
                  'border-b last:border-b-0',
                  gapBefore && 'border-t border-dashed',
                  highlighted && 'font-semibold'
                )}
                style={{
                  borderColor: 'var(--border-color)',
                  background: isHome
                    ? 'color-mix(in srgb, var(--team-tint-home) 10%, transparent)'
                    : isAway
                      ? 'color-mix(in srgb, var(--team-tint-away) 10%, transparent)'
                      : undefined,
                }}
              >
                <td className="py-2 pl-4 pr-2 tabular-nums text-[var(--text-secondary)]">{row.position}</td>
                <td className="py-2 px-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <TeamBadge teamId={row.teamId} name={row.teamName || ''} size={18} className="shrink-0" />
                    <span className="truncate text-[var(--text-primary)]">{row.teamName}</span>
                  </span>
                </td>
                <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{row.played}</td>
                {hasGD && (
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">
                    {row.goalDiff != null ? (row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff) : ''}
                  </td>
                )}
                <td className="py-2 pl-2 pr-4 text-right font-bold tabular-nums text-[var(--text-primary)]">{row.points}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── Commentary feed ── */

function CommentaryCard({ match }: { match: MatchDetails }) {
  if (!match.commentary || match.commentary.length === 0) return null
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
        <MessageSquareText className="h-4 w-4" aria-hidden /> Commentary
      </h3>
      <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
        <div className="max-h-[400px] overflow-y-auto divide-y" style={{ borderColor: 'var(--border-color)' }}>
          {[...match.commentary]
            .sort((a, b) => b.minute - a.minute)
            .map((item, idx) => (
              <div key={idx} className="flex gap-3 p-3 hover:bg-[var(--muted-bg)] transition-colors">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] font-bold tabular-nums text-[10px] flex-shrink-0">
                  {item.minute}&apos;
                </span>
                <p className="text-xs text-[var(--text-primary)] leading-relaxed">{item.text}</p>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

/* ── The tab body ── */

export function OverviewTab({ match, isLive, isFinished, isScheduled, onSelectTab }: OverviewTabProps) {
  const hasShotmap = (match.shotmap?.length ?? 0) > 0
  const insights = match.prediction ? buildModelInsights(match) : []

  // Half-time score derived from the same goal events the timeline renders.
  const htGoals = match.events.filter(
    (e) => (e.type === 'goal' || e.type === 'own_goal') && e.minute <= 45
  )
  const htScore = match.events.some((e) => e.minute > 45)
    ? `${htGoals.filter((e) => e.team === 'home').length}-${htGoals.filter((e) => e.team === 'away').length}`
    : undefined

  // The quieter bottom cluster shared by both layouts.
  const quietCluster = (
    <>
      {insights.length > 0 && <NarrativeCard heading="What the model sees" insights={insights} />}
      {match.prediction?.derived_markets && (
        <DerivedMarkets
          data={match.prediction.derived_markets}
          homeTeam={match.home_team}
          awayTeam={match.away_team}
        />
      )}
      {match.prediction && !isFinished && (
        <BettingIntelligence
          matchId={match.id}
          leagueId={match.leagueId}
          modelProbs={{
            homeWin: match.prediction.home_win,
            draw: match.prediction.draw,
            awayWin: match.prediction.away_win,
          }}
          kickoff={match.date}
          status={match.status}
        />
      )}
      <MatchWeather
        matchId={match.id}
        venue={match.venue}
        kickoffTime={match.date}
        homeTeam={match.home_team}
        awayTeam={match.away_team}
      />
    </>
  )

  if (isScheduled) {
    return (
      <div className="space-y-6">
        <CompactAIPickCard match={match} isFinished={false} onSelectTab={onSelectTab} />
        <KeyMatchFactors
          homeTeam={match.home_team}
          awayTeam={match.away_team}
          leagueId={match.leagueId}
          matchDate={match.date}
        />
        <H2HMiniCard match={match} onSelectTab={onSelectTab} />
        <MiniTableSnippet match={match} onSelectTab={onSelectTab} />
        <MatchInfoCard match={match} />
        {quietCluster}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Momentum river — the story section's headline visual: stacked
          empirical win/draw/loss bands stepping at every goal and 5-minute
          mark. Renders nothing unless every band span clears the n-gate. */}
      <MomentumRiver match={match} isFinished={isFinished} />

      {/* The story — acts, detected turning points, exact-count receipts.
          Renders nothing unless the match is finished, the events reconcile
          with the final score, and the rarity artifact has real counts. */}
      <MatchStory match={match} isFinished={isFinished} />

      {/* Similar matches — historical matches whose score-state trajectory
          rhymed with this one. Renders nothing unless the match is finished
          and resolvable in the committed retrieval index. */}

      {/* Momentum — real feed series when present, synthesized (labelled) otherwise */}
      {((match.momentum?.length ?? 0) > 0 || match.events.length > 0) && (
        <MatchMomentum
          events={match.events}
          homeTeam={match.home_team}
          awayTeam={match.away_team}
          status={match.status}
          possession={match.stats.possession}
          series={match.momentum}
        />
      )}

      {/* Key events — substitutions included. The id is the story beats'
          anchor-scroll target. */}
      {match.events.length > 0 && (
        <div
          id={MATCH_EVENTS_ANCHOR_ID}
          className="bg-[var(--card-bg)] border rounded-xl overflow-hidden scroll-mt-20"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <h3 className="font-semibold text-[var(--text-primary)]">Events</h3>
          </div>
          <EventTimeline
            events={match.events}
            homeName={match.home_team}
            awayName={match.away_team}
            halftimeScore={htScore}
            className="rounded-none border-0"
          />
          {isFinished && match.home_score !== null && match.away_score !== null && (
            <div className="flex items-center px-4 py-2" style={{ background: 'var(--muted-bg)' }}>
              <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
              <span className="px-3 text-meta font-semibold text-[var(--text-secondary)] font-numeric tabular-nums">
                FT {match.home_score} - {match.away_score}
              </span>
              <div className="flex-1 h-px" style={{ background: 'var(--border-color)' }} />
            </div>
          )}
        </div>
      )}

      {/* Rarity stamp — exact-count history for the match's most dramatic
          state; renders nothing unless the claim is countable and legible. */}

      {/* Top stats preview → Stats tab */}
      <TopStatsPreview match={match} onSeeAll={() => onSelectTab('stats')} />

      {/* Real shot map when coordinates exist; approximate heatmap only without it */}
      {hasShotmap ? (
        <ShotMap shots={match.shotmap!} homeTeam={match.home_team} awayTeam={match.away_team} />
      ) : (
        <MatchEventHeatmap
          events={match.events}
          homeTeam={match.home_team}
          awayTeam={match.away_team}
        />
      )}

      <CompactAIPickCard match={match} isFinished={isFinished} onSelectTab={onSelectTab} />

      {isLive && <LiveWinProbabilityPanel match={match} />}

      <PlayerOfTheMatchCard match={match} isFinished={isFinished} />

      <H2HMiniCard match={match} onSelectTab={onSelectTab} />

      <MatchInfoCard match={match} />

      <HighlightsLink
        homeTeam={match.home_team}
        awayTeam={match.away_team}
        homeScore={match.home_score}
        awayScore={match.away_score}
        date={match.date}
        league={match.league}
        status={match.status}
      />

      {quietCluster}

      <CommentaryCard match={match} />
    </div>
  )
}
