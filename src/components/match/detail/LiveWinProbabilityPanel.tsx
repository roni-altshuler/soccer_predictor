'use client'

import { useEffect, useMemo, useState } from 'react'

import type { ThreeWayProbabilities } from '@/lib/liveWinProbability'

import { fetchLiveEngineDistribution } from './engineClient'
import { formatProbability } from './insights'
import {
  deriveEngineLiveState,
  distributionToProbabilities,
  rarityToBaseRate,
  type BaseRate,
  type RarityCountsResponse,
} from './liveWinProbabilityV2'
import type { MatchDetails } from './types'

function formatProbabilityDelta(current: number, prior: number): string {
  const delta = Math.round((current - prior) * 100)
  if (delta > 0) return `+${delta} pts`
  if (delta < 0) return `${delta} pts`
  return '0 pts'
}

function probabilityPath(prior: number, current: number): string {
  const toY = (value: number) => Math.min(92, Math.max(8, 96 - value * 88))
  return `M 4 ${toY(prior).toFixed(1)} L 96 ${toY(current).toFixed(1)}`
}

interface OutcomeMeta {
  key: keyof ThreeWayProbabilities
  label: string
  shortLabel: string
  color: string
}

/**
 * In-match win-probability panel (v2). When the roll-forward kernel can anchor
 * the fixture, its CURRENT-state win/draw/loss chances are the headline read,
 * recomputed on every live poll; the exact-count historical base rate for the
 * same state is shown alongside as an honest comparison. When the kernel cannot
 * anchor the fixture, the panel falls back to the existing behaviour unchanged.
 * Renders nothing outside live matches with no available probability.
 */
export function LiveWinProbabilityPanel({ match }: { match: MatchDetails }) {
  const isCurrentlyLive =
    match.status.includes('IN_PROGRESS') ||
    match.status.includes('HALF') ||
    match.status.includes('LIVE')
  const liveProbability = match.liveWinProbability

  const matchId = match.id
  const competition = match.leagueId || match.league
  const homeTeam = match.home_team
  const awayTeam = match.away_team
  const engineState = useMemo(() => deriveEngineLiveState(match), [match])

  // Engine win chances recomputed each poll, plus the exact-count base rate for
  // the same live state. Both null until (and unless) they resolve honestly.
  const [engineProbabilities, setEngineProbabilities] = useState<ThreeWayProbabilities | null>(null)
  const [baseRate, setBaseRate] = useState<BaseRate | null>(null)

  useEffect(() => {
    if (!isCurrentlyLive || !engineState || !competition || !homeTeam || !awayTeam) {
      setEngineProbabilities(null)
      setBaseRate(null)
      return
    }
    let cancelled = false
    const controller = new AbortController()

    fetchLiveEngineDistribution({ competition, homeTeam, awayTeam, state: engineState })
      .then(async (result) => {
        if (cancelled) return
        if (!result) {
          setEngineProbabilities(null)
          setBaseRate(null)
          return
        }
        setEngineProbabilities(distributionToProbabilities(result.distribution))

        // Historical base rate for the current live state (home-side view).
        if (!result.gender) {
          setBaseRate(null)
          return
        }
        const diff = engineState.homeGoals - engineState.awayGoals
        try {
          const res = await fetch(
            `/api/v1/rarity?gender=${result.gender}&diff=${diff}&minute=${engineState.minute}`,
            { signal: controller.signal },
          )
          if (!res.ok) {
            if (!cancelled) setBaseRate(null)
            return
          }
          const counts = (await res.json()) as RarityCountsResponse | null
          if (!cancelled) setBaseRate(rarityToBaseRate(counts))
        } catch {
          if (!cancelled) setBaseRate(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEngineProbabilities(null)
          setBaseRate(null)
        }
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [isCurrentlyLive, engineState, competition, homeTeam, awayTeam, matchId])

  const engineAvailable = engineProbabilities !== null

  if (!isCurrentlyLive && !liveProbability?.available && !engineAvailable) return null

  const outcomes: OutcomeMeta[] = [
    { key: 'home_win', label: match.home_team, shortLabel: 'Home', color: 'var(--accent-primary)' },
    { key: 'draw', label: 'Draw', shortLabel: 'Draw', color: 'var(--accent-warn)' },
    { key: 'away_win', label: match.away_team, shortLabel: 'Away', color: 'var(--accent-info)' },
  ]

  // --- v2: kernel anchored the live fixture — engine chances are the headline.
  if (engineAvailable && engineProbabilities) {
    const prior: ThreeWayProbabilities | null = match.prediction
      ? {
          home_win: match.prediction.home_win,
          draw: match.prediction.draw,
          away_win: match.prediction.away_win,
        }
      : null
    const current = engineProbabilities
    const minute = match.minute ?? liveProbability?.minute

    return (
      <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
        <div className="p-4 border-b flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: 'var(--border-color)' }}>
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-[var(--accent-ai)]">Live probability</p>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Live win chance</h3>
          </div>
          {minute !== undefined && (
            <span className="rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] tabular-nums">
              {minute}&apos;
            </span>
          )}
        </div>

        <div className="p-4">
          {prior && (
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
              <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                <span>Pre-match</span>
                <span>Now</span>
              </div>
              <svg viewBox="0 0 100 100" className="h-36 w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Live win chance shift from the pre-match estimate">
                {[25, 50, 75].map((line) => (
                  <line key={line} x1="0" x2="100" y1={line} y2={line} stroke="currentColor" strokeOpacity="0.12" vectorEffect="non-scaling-stroke" />
                ))}
                {outcomes.map((outcome) => (
                  <path
                    key={outcome.key}
                    d={probabilityPath(prior[outcome.key], current[outcome.key])}
                    fill="none"
                    stroke={outcome.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
            </div>
          )}

          <div className={`grid gap-2 ${prior ? 'mt-4' : ''}`}>
            {outcomes.map((outcome) => {
              const value = current[outcome.key]
              return (
                <div key={outcome.key} className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[var(--text-primary)]">{outcome.label}</p>
                      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{outcome.shortLabel}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-[var(--text-primary)] tabular-nums">{formatProbability(value)}</p>
                      {prior && (
                        <p className={`text-[10px] font-bold tabular-nums ${value >= prior[outcome.key] ? 'text-[var(--accent-primary)]' : 'text-[var(--accent-loss)]'}`}>
                          {formatProbabilityDelta(value, prior[outcome.key])}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--background-secondary)]">
                    <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, backgroundColor: outcome.color }} />
                  </div>
                </div>
              )
            })}
          </div>

          {baseRate && (
            <div className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-[var(--text-tertiary)]">Historical base rate</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {outcomes.map((outcome) => (
                  <div key={outcome.key} className="text-center">
                    <p className="text-sm font-bold text-[var(--text-primary)] tabular-nums">
                      {formatProbability(baseRate.probabilities[outcome.key])}
                    </p>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{outcome.shortLabel}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-tertiary)] tabular-nums">
                Based on {baseRate.sample.toLocaleString()} similar matches at this scoreline and minute.
              </p>
            </div>
          )}

          <p className="mt-4 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            Live win chance recalculates from the current score and clock. It is a transparent in-match estimate, not a betting guarantee.
          </p>
        </div>
      </div>
    )
  }

  // --- Honest fallback: kernel could not anchor the fixture. Existing behaviour.
  if (!liveProbability?.available || !liveProbability.probabilities || !match.prediction) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
        <div className="p-4 border-b flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: 'var(--border-color)' }}>
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-[var(--accent-ai)]">Live probability</p>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Awaiting complete live data</h3>
          </div>
          <span className="rounded-full border border-[color-mix(in_srgb,var(--accent-warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-warn)_10%,transparent)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent-warn)]">
            Guarded
          </span>
        </div>
        <div className="p-4">
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            {liveProbability?.note || 'The app withholds in-match probabilities until score, clock, pre-match prediction, and live stats are complete.'}
          </p>
          {liveProbability?.inputs && liveProbability.inputs.length > 0 && (
            <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Inputs ready: {liveProbability.inputs.join(', ')}
            </p>
          )}
        </div>
      </div>
    )
  }

  const prior: ThreeWayProbabilities = {
    home_win: match.prediction.home_win,
    draw: match.prediction.draw,
    away_win: match.prediction.away_win,
  }
  const current = liveProbability.probabilities

  return (
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-4 border-b flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: 'var(--border-color)' }}>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-[var(--accent-ai)]">Live probability</p>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">Win-probability shift</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            {liveProbability.minute ?? match.minute ?? 'Live'}&apos;
          </span>
          <span className="rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            {liveProbability.confidence} confidence
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            <span>Pre-match</span>
            <span>Live</span>
          </div>
          <svg viewBox="0 0 100 100" className="h-36 w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Live win probability shift">
            {[25, 50, 75].map((line) => (
              <line key={line} x1="0" x2="100" y1={line} y2={line} stroke="currentColor" strokeOpacity="0.12" vectorEffect="non-scaling-stroke" />
            ))}
            {outcomes.map((outcome) => (
              <path
                key={outcome.key}
                d={probabilityPath(prior[outcome.key], current[outcome.key])}
                fill="none"
                stroke={outcome.color}
                strokeWidth="3"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>

        <div className="mt-4 grid gap-2">
          {outcomes.map((outcome) => {
            const value = current[outcome.key]
            return (
              <div key={outcome.key} className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[var(--text-primary)]">{outcome.label}</p>
                    <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{outcome.shortLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-[var(--text-primary)] tabular-nums">{formatProbability(value)}</p>
                    <p className={`text-[10px] font-bold tabular-nums ${value >= prior[outcome.key] ? 'text-[var(--accent-primary)]' : 'text-[var(--accent-loss)]'}`}>
                      {formatProbabilityDelta(value, prior[outcome.key])}
                    </p>
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--background-secondary)]">
                  <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, backgroundColor: outcome.color }} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">{liveProbability.note}</p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            Inputs: {liveProbability.inputs.join(', ')}
          </p>
        </div>
      </div>
    </div>
  )
}
