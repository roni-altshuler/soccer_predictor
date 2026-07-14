'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { Stagger, StaggerItem } from '@/components/motion'
import { FlagBadge } from '@/components/primitives'
import { TournamentCrest } from '@/components/tournament'
import type { KnockoutRoundKey } from '@/lib/simulation/knockoutMonteCarlo'
import { cn } from '@/lib/utils'

import AdvancementTable, { type AdvancementRow } from './AdvancementTable'
import SimulatorHero from './SimulatorHero'

export type KnockoutTournament =
  | 'champions_league'
  | 'europa_league'
  | 'world_cup'
  | 'euro'
  | 'copa_america'

interface KnockoutSimulatorPanelProps {
  tournament: KnockoutTournament
  initialTeams?: string[]
}

const TOURNAMENT_CONFIGS: Record<
  KnockoutTournament,
  { name: string; crestId: string; national: boolean; defaultTeams: string[] }
> = {
  champions_league: {
    name: 'UEFA Champions League',
    crestId: 'uefa.champions',
    national: false,
    defaultTeams: [
      'Real Madrid', 'Manchester City', 'Bayern Munich', 'PSG',
      'Barcelona', 'Liverpool', 'Chelsea', 'Inter Milan',
      'Arsenal', 'Dortmund', 'Napoli', 'Benfica',
      'Porto', 'AC Milan', 'RB Leipzig', 'Atletico Madrid',
    ],
  },
  europa_league: {
    name: 'UEFA Europa League',
    crestId: 'uefa.europa',
    national: false,
    defaultTeams: [
      'Roma', 'West Ham', 'Atalanta', 'Bayer Leverkusen',
      'Villarreal', 'Marseille', 'Ajax', 'Sevilla',
      'Sporting CP', 'Freiburg', 'Real Sociedad', 'Feyenoord',
      'Brighton', 'Union Berlin', 'Toulouse', 'Rennes',
    ],
  },
  world_cup: {
    name: 'FIFA World Cup',
    crestId: 'fifa.world',
    national: true,
    defaultTeams: [
      'France', 'Brazil', 'Argentina', 'England',
      'Germany', 'Spain', 'Netherlands', 'Portugal',
      'Belgium', 'Croatia', 'Uruguay', 'Denmark',
      'Japan', 'Morocco', 'USA', 'Mexico',
    ],
  },
  euro: {
    name: 'UEFA European Championship',
    crestId: 'uefa.euro',
    national: true,
    defaultTeams: [
      'Spain', 'England', 'France', 'Germany',
      'Portugal', 'Netherlands', 'Italy', 'Belgium',
      'Croatia', 'Denmark', 'Switzerland', 'Austria',
      'Türkiye', 'Ukraine', 'Scotland', 'Poland',
    ],
  },
  copa_america: {
    name: 'Copa América',
    crestId: 'conmebol.america',
    national: true,
    defaultTeams: [
      'Argentina', 'Brazil', 'Uruguay', 'Colombia',
      'Ecuador', 'Chile', 'Peru', 'Paraguay',
      'Venezuela', 'Bolivia', 'United States', 'Mexico',
      'Canada', 'Costa Rica', 'Panama', 'Jamaica',
    ],
  },
}

interface KnockoutApiResponse {
  n_simulations: number
  bracket_size: number
  rounds: KnockoutRoundKey[]
  most_likely_winner: string
  winner_probability: number
  round_probabilities: Record<string, Partial<Record<KnockoutRoundKey, number>>>
}

/**
 * Team ratings for a custom roster follow the roster order (strongest
 * first), matching the historical simulator behaviour: club fields step
 * down 100 rating points per slot, national fields 80.
 */
function rosterInputs(teams: string[], national: boolean) {
  const step = national ? 80 : 100
  return teams.map((name, idx) => ({
    name,
    elo: 1800 + step * Math.max(0, 16 - idx),
    country: national ? name : undefined,
  }))
}

function KnockoutSkeleton() {
  const block =
    'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] motion-safe:animate-pulse'
  return (
    <div aria-hidden className="space-y-4">
      <div className={cn(block, 'h-[96px]')} />
      <div className={cn(block, 'h-[420px]')} />
    </div>
  )
}

/**
 * KnockoutSimulatorPanel — bracket simulator on the in-app engine
 * (POST /api/simulation/knockout). Auto-runs on mount and debounces roster
 * or run-depth changes; the winner lands in a SimulatorHero and every
 * team's path to the trophy renders as a heat-tinted AdvancementTable.
 */
export default function KnockoutSimulatorPanel({
  tournament,
  initialTeams,
}: KnockoutSimulatorPanelProps) {
  const config = TOURNAMENT_CONFIGS[tournament]
  const rosterForTournament = useMemo(
    () => initialTeams ?? TOURNAMENT_CONFIGS[tournament].defaultTeams,
    [tournament, initialTeams],
  )

  const [teams, setTeams] = useState<string[]>(rosterForTournament)
  const [result, setResult] = useState<KnockoutApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [numSimulations, setNumSimulations] = useState(10000)
  const [runToken, setRunToken] = useState(0)
  const firstRun = useRef(true)

  // Fresh roster when the tournament changes.
  useEffect(() => {
    setTeams(rosterForTournament)
    setResult(null)
    firstRun.current = true
  }, [rosterForTournament])

  // Auto-run: immediately on mount / tournament change, debounced while the
  // roster or run depth is being edited.
  useEffect(() => {
    if (teams.length < 2) return
    const controller = new AbortController()
    let cancelled = false

    async function run() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/simulation/knockout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tournament,
            n_simulations: numSimulations,
            teams: rosterInputs(teams, config.national),
          }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('The simulation is unavailable right now')
        const data = (await response.json()) as KnockoutApiResponse
        if (cancelled) return
        if (!Array.isArray(data.rounds) || typeof data.round_probabilities !== 'object') {
          throw new Error('The simulation returned an unexpected result')
        }
        setResult(data)
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        setError(
          err instanceof Error ? err.message : 'The simulation is unavailable right now',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const delay = firstRun.current ? 0 : 350
    firstRun.current = false
    const timer = window.setTimeout(run, delay)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [tournament, teams, numSimulations, runToken, config.national])

  const rows = useMemo<AdvancementRow[]>(() => {
    if (!result) return []
    return Object.entries(result.round_probabilities)
      .map(([name, reach]) => ({ name, reach }))
      .sort((a, b) => (b.reach.winner ?? 0) - (a.reach.winner ?? 0))
  }, [result])

  const teamsRemoved = teams.length < rosterForTournament.length

  return (
    <div className="space-y-4">
      {/* Header + roster controls */}
      <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
        <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border-color)] p-4 md:p-5">
          <TournamentCrest tournamentId={config.crestId} name={config.name} size={44} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Bracket simulator
            </p>
            <h2 className="truncate text-lg font-bold text-[var(--text-primary)]">
              {config.name}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="knockout-n-simulations"
              className="text-[12px] text-[var(--text-secondary)]"
            >
              Runs
            </label>
            <select
              id="knockout-n-simulations"
              value={numSimulations}
              onChange={(e) => setNumSimulations(parseInt(e.target.value, 10))}
              className="min-h-[44px] rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 text-[13px] tabular-nums text-[var(--text-primary)]"
            >
              <option value={1000}>1,000</option>
              <option value={10000}>10,000</option>
              <option value={25000}>25,000</option>
              <option value={50000}>50,000</option>
            </select>
            {loading && result && (
              <span className="text-[12px] text-[var(--text-tertiary)]" aria-live="polite">
                Updating…
              </span>
            )}
          </div>
        </div>

        <div className="p-4 md:p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[12px] text-[var(--text-secondary)]">
              Field · <span className="tabular-nums">{teams.length}</span> teams — tap to
              remove
            </p>
            {teamsRemoved && (
              <button
                type="button"
                onClick={() => setTeams(rosterForTournament)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset field
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <button
                key={team}
                type="button"
                onClick={() => setTeams(teams.filter((t) => t !== team))}
                aria-label={`Remove ${team} from the field`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:border-[color-mix(in_srgb,var(--accent-loss)_45%,transparent)] hover:text-[var(--accent-loss)]"
              >
                <FlagBadge
                  teamName={team}
                  country={config.national ? team : undefined}
                  size={16}
                />
                {team}
                <X className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && !result && !loading && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
          <EmptyState
            illustration="data-error"
            title="Simulation unavailable"
            description="The bracket could not be simulated. Nothing is shown rather than made-up numbers."
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
      {error && result && (
        <div
          role="alert"
          className="rounded-xl border border-[color-mix(in_srgb,var(--accent-loss)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-loss)_10%,transparent)] p-3.5 text-[13px] text-[var(--accent-loss)]"
        >
          {error} — showing the last completed run.
        </div>
      )}

      {loading && !result && <KnockoutSkeleton />}

      {result && rows.length > 0 && (
        <div className={cn(loading && 'pointer-events-none opacity-60')} aria-busy={loading}>
          <Stagger key={tournament} inView={false} className="space-y-4">
            <StaggerItem>
              <SimulatorHero
                kicker="Most likely winner"
                teamName={result.most_likely_winner}
                probability={result.winner_probability}
                badge={
                  <FlagBadge
                    teamName={result.most_likely_winner}
                    country={config.national ? result.most_likely_winner : undefined}
                    size={56}
                  />
                }
                chips={[
                  { label: `${result.bracket_size}-team bracket` },
                  { label: `${result.n_simulations.toLocaleString()} tournament runs` },
                ]}
              />
            </StaggerItem>
            <StaggerItem>
              <AdvancementTable
                rounds={result.rounds}
                teams={rows}
                national={config.national}
              />
            </StaggerItem>
          </Stagger>
        </div>
      )}
    </div>
  )
}
