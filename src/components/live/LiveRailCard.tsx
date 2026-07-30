'use client'

import { useMemo } from 'react'

import { KICKOFF_STATE, type ForkDistribution } from '@/components/match/detail/engineClient'
import { ProbBar } from '@/components/primitives'
import { getLeagueAccent } from '@/lib/leagueAccents'

import { useEngineDistribution } from './useEngineDistribution'
import { committedProbs, toLiveEngineState, type LiveMatch, type OutcomeProbs } from './types'

function distToProbs(d: ForkDistribution): OutcomeProbs {
  const total = d.pHome + d.pDraw + d.pAway
  if (!(total > 0)) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 }
  return { home: d.pHome / total, draw: d.pDraw / total, away: d.pAway / total }
}

function TinyCrest({ url, name }: { url?: string | null; name: string }) {
  if (!url) {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--muted-bg)] text-[9px] font-black text-[var(--text-tertiary)]">
        {name.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={20} height={20} className="h-5 w-5 shrink-0 object-contain" />
}

/**
 * A compact live/upcoming fixture card for the intelligence rail. Carries its
 * own engine win-probability strip (the kernel roll-forward for a live match, or
 * the pre-match read for an upcoming one), falling back to the committed model
 * or to no bar at all when the competition isn't covered. Selecting it promotes
 * the fixture into the featured spotlight.
 */
export function LiveRailCard({
  match,
  isLive,
  selected,
  onSelect,
}: {
  match: LiveMatch
  isLive: boolean
  selected: boolean
  onSelect: () => void
}) {
  const league = getLeagueAccent(match.leagueId || match.league)
  const liveState = useMemo(() => (isLive ? toLiveEngineState(match) : KICKOFF_STATE), [isLive, match])

  const engine = useEngineDistribution({
    competition: match.leagueId || match.league,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    state: liveState,
  })

  const engineProbs = engine.distribution ? distToProbs(engine.distribution) : null
  const probs = engineProbs ?? committedProbs(match)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="w-full rounded-xl border p-3 text-left transition-all"
      style={{
        borderColor: selected
          ? 'color-mix(in srgb, var(--accent-ai) 55%, var(--border-color))'
          : 'var(--border-color)',
        background: selected
          ? 'color-mix(in srgb, var(--accent-ai) 8%, var(--card-bg))'
          : 'var(--card-bg)',
        boxShadow: selected ? '0 0 0 1px color-mix(in srgb, var(--accent-ai) 30%, transparent)' : 'none',
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          {league.flag} {league.shortName}
        </span>
        {isLive ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--accent-loss)]">
            <span className="live-dot" />
            {typeof match.minute === 'number' ? `${match.minute}'` : match.minute ?? 'LIVE'}
          </span>
        ) : (
          <span className="text-[10px] font-semibold tabular-nums text-[var(--text-tertiary)]">
            {new Date(match.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <TinyCrest url={match.home_crest_url} name={match.home_team} />
            <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{match.home_team}</span>
          </span>
          {isLive && (
            <span className="text-sm font-black tabular-nums text-[var(--text-primary)]">
              {match.home_score ?? 0}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <TinyCrest url={match.away_crest_url} name={match.away_team} />
            <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{match.away_team}</span>
          </span>
          {isLive && (
            <span className="text-sm font-black tabular-nums text-[var(--text-primary)]">
              {match.away_score ?? 0}
            </span>
          )}
        </div>
      </div>

      {probs ? (
        <div className="mt-2.5">
          <ProbBar home={probs.home} draw={probs.draw} away={probs.away} size="sm" />
        </div>
      ) : (
        <p className="mt-2.5 text-[10px] text-[var(--text-tertiary)]">Read unavailable</p>
      )}
    </button>
  )
}
