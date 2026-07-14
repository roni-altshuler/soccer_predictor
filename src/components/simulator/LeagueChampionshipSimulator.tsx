'use client'

import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { LeagueChip } from '@/components/primitives'
import type { LeagueSimulationResult } from '@/lib/api'
import { cn } from '@/lib/utils'

import SeasonSimulationResults, { SeasonSimulationSkeleton } from './SeasonSimulationResults'
import { type FixtureOverrideSelection } from './WhatIfLab'
import { fetchLeagueTeamMeta, type TeamMeta } from './shared'

// The title-race math lives with the shared results view; re-exported here so
// existing imports (and the buildTitleRace unit tests) keep their path.
export { buildTitleRace, type TitleRaceRow } from './SeasonSimulationResults'

// League options for simulation. `competitionId` drives the LeagueChip crest
// + accent (matches src/lib/leagueAccents.ts ids).
const SIMULATION_LEAGUES = [
  { id: 47, name: 'Premier League', competitionId: 'eng.1' },
  { id: 87, name: 'La Liga', competitionId: 'esp.1' },
  { id: 55, name: 'Serie A', competitionId: 'ita.1' },
  { id: 54, name: 'Bundesliga', competitionId: 'ger.1' },
  { id: 53, name: 'Ligue 1', competitionId: 'fra.1' },
  { id: 57, name: 'Eredivisie', competitionId: 'ned.1' },
  { id: 61, name: 'Primeira Liga', competitionId: 'por.1' },
  { id: 130, name: 'MLS', competitionId: 'usa.1' },
]

/**
 * Standalone /simulator league surface: league picker + run controls +
 * fetch/error/loading states. All result rendering is delegated to the
 * shared SeasonSimulationResults view (also used by the league pages'
 * Simulator tab).
 */
export default function LeagueChampionshipSimulator() {
  const [selectedLeague, setSelectedLeague] = useState(SIMULATION_LEAGUES[0])
  const [nSimulations, setNSimulations] = useState(10000)
  const [result, setResult] = useState<LeagueSimulationResult | null>(null)
  const [baseline, setBaseline] = useState<LeagueSimulationResult | null>(null)
  const [override, setOverride] = useState<FixtureOverrideSelection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [teamMeta, setTeamMeta] = useState<Record<string, TeamMeta>>({})
  const [runToken, setRunToken] = useState(0)

  // Crest ids + brand colours for the selected league (same ESPN feed the
  // simulation route reads, so team names line up exactly).
  useEffect(() => {
    const controller = new AbortController()
    setTeamMeta({})
    fetchLeagueTeamMeta(selectedLeague.competitionId, controller.signal).then(setTeamMeta)
    return () => controller.abort()
  }, [selectedLeague])

  // Auto-run: league select, sim-count change, what-if override, manual re-run.
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function run() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ n_simulations: String(nSimulations) })
        if (override) {
          params.set('what_if_fixture', override.fixtureKey)
          params.set('what_if_outcome', override.outcome)
        }
        const response = await fetch(
          `/api/simulation/${selectedLeague.id}?${params.toString()}`,
          { signal: controller.signal },
        )
        if (!response.ok) throw new Error('The simulation is unavailable right now')
        const data = (await response.json()) as LeagueSimulationResult
        if (cancelled) return
        if (!Array.isArray(data.standings) || data.standings.length === 0) {
          throw new Error('The simulation returned no standings')
        }
        setResult(data)
        // Runs without an override are the delta baseline for the what-if lab.
        if (!override) setBaseline(data)
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        setError(
          err instanceof Error ? err.message : 'The simulation is unavailable right now',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedLeague, nSimulations, override, runToken])

  const selectLeague = (league: (typeof SIMULATION_LEAGUES)[number]) => {
    if (league.id === selectedLeague.id) return
    setSelectedLeague(league)
    setResult(null)
    setBaseline(null)
    setOverride(null)
  }

  const changeSimCount = (n: number) => {
    setNSimulations(n)
    // A different run depth is a different baseline — clear any override.
    setBaseline(null)
    setOverride(null)
  }

  return (
    <div className="space-y-5">
      {/* Setup — league picker + run depth. The simulation runs itself. */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
        <div className="flex flex-wrap gap-2">
          {SIMULATION_LEAGUES.map((league) => (
            <LeagueChip
              key={league.id}
              leagueId={league.competitionId}
              name={league.name}
              active={selectedLeague.id === league.id}
              onClick={() => selectLeague(league)}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label
            htmlFor="league-n-simulations"
            className="text-[12px] text-[var(--text-secondary)]"
          >
            Season runs
          </label>
          <select
            id="league-n-simulations"
            value={nSimulations}
            onChange={(e) => changeSimCount(Number(e.target.value))}
            className="min-h-[44px] rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 text-[13px] tabular-nums text-[var(--text-primary)]"
          >
            <option value={1000}>1,000</option>
            <option value={5000}>5,000</option>
            <option value={10000}>10,000</option>
            <option value={25000}>25,000</option>
          </select>
          <button
            type="button"
            onClick={() => setRunToken((t) => t + 1)}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw
              className={cn('h-3.5 w-3.5', loading && 'motion-safe:animate-spin')}
              aria-hidden="true"
            />
            Re-run
          </button>
          {loading && result && (
            <span className="text-[12px] text-[var(--text-tertiary)]" aria-live="polite">
              Updating…
            </span>
          )}
        </div>
      </div>

      {/* Inline error over stale results; full empty state when nothing to show. */}
      {error && result && (
        <div
          role="alert"
          className="rounded-xl border border-[color-mix(in_srgb,var(--accent-loss)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-loss)_10%,transparent)] p-3.5 text-[13px] text-[var(--accent-loss)]"
        >
          {error} — showing the last completed run.
        </div>
      )}
      {error && !result && !loading && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
          <EmptyState
            illustration="data-error"
            title="Simulation unavailable"
            description={`${selectedLeague.name} standings could not be loaded. Nothing is shown rather than made-up numbers.`}
            action={
              <button
                type="button"
                onClick={() => setRunToken((t) => t + 1)}
                className="min-h-[44px] rounded-lg border border-[var(--border-color)] px-4 text-[13px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)]"
              >
                Try again
              </button>
            }
          />
        </div>
      )}

      {loading && !result && <SeasonSimulationSkeleton />}

      {result && (
        <SeasonSimulationResults
          key={result.league_id}
          result={result}
          baseline={baseline}
          override={override}
          onOverrideChange={setOverride}
          loading={loading}
          teamMeta={teamMeta}
        />
      )}
    </div>
  )
}
