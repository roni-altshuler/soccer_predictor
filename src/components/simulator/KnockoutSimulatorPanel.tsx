'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, RotateCcw, Settings2, X } from 'lucide-react'

import { StatCard } from '@/components/primitives'
import { TournamentCrest } from '@/components/tournament'

interface TeamProbability {
  team: string
  probability: number
  seed?: number
}

interface KnockoutSimulationResult {
  tournament: string
  numSimulations: number
  rounds: {
    round_of_16?: TeamProbability[]
    quarter_finals: TeamProbability[]
    semi_finals: TeamProbability[]
    final: TeamProbability[]
    champion: TeamProbability[]
  }
  winner: { team: string; probability: number }
  runnerUp: { team: string; probability: number }
}

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
  { name: string; crestId: string; defaultTeams: string[] }
> = {
  champions_league: {
    name: 'UEFA Champions League',
    crestId: 'uefa.champions',
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
    defaultTeams: [
      'Argentina', 'Brazil', 'Uruguay', 'Colombia',
      'Ecuador', 'Chile', 'Peru', 'Paraguay',
      'Venezuela', 'Bolivia', 'United States', 'Mexico',
      'Canada', 'Costa Rica', 'Panama', 'Jamaica',
    ],
  },
}

const ROUND_ORDER = ['champion', 'final', 'semi_finals', 'quarter_finals', 'round_of_16'] as const
const ROUND_LABELS: Record<(typeof ROUND_ORDER)[number], string> = {
  champion: 'Winner',
  final: 'Final',
  semi_finals: 'Semi-Finals',
  quarter_finals: 'Quarter-Finals',
  round_of_16: 'Round of 16',
}

/** Display-honest probability format: whole % ≥10, one decimal below. */
function formatProbability(prob: number): string {
  const pct = prob * 100
  if (pct < 0.05) return '<0.1%'
  if (pct < 10) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}

/**
 * KnockoutSimulatorPanel — Monte Carlo knockout simulator in the Broadcast
 * design language: crest identity (no emoji), ≥40px tap targets on every
 * control, a primary CTA with an in-flight progress state, and StatCards for
 * the headline result. Model outputs carry the cyan `--accent-ai` treatment.
 */
export default function KnockoutSimulatorPanel({
  tournament,
  initialTeams,
}: KnockoutSimulatorPanelProps) {
  const config = TOURNAMENT_CONFIGS[tournament]
  const [teams, setTeams] = useState<string[]>(initialTeams || config.defaultTeams)
  const [results, setResults] = useState<KnockoutSimulationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [numSimulations, setNumSimulations] = useState(10000)
  const [activeRound, setActiveRound] = useState<string>('champion')
  const [showSetup, setShowSetup] = useState(true)

  const teamsRemoved = teams.length < (initialTeams || config.defaultTeams).length

  const runSimulation = async () => {
    setLoading(true)
    setError(null)
    try {
      const endpoint =
        tournament === 'champions_league'
          ? '/api/v1/knockout/champions-league'
          : tournament === 'europa_league'
            ? '/api/v1/knockout/europa-league'
            : '/api/v1/knockout/world-cup'

      const response = await fetch(`${endpoint}?n_simulations=${numSimulations}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teams }),
      })

      if (!response.ok) throw new Error(`Simulation failed (HTTP ${response.status})`)

      const data = await response.json()
      setResults({
        tournament: config.name,
        numSimulations,
        rounds: data.round_probabilities || {},
        winner: data.winner || { team: 'Unknown', probability: 0 },
        runnerUp: data.runner_up || { team: 'Unknown', probability: 0 },
      })
      setShowSetup(false)
      setActiveRound('champion')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed')
    } finally {
      setLoading(false)
    }
  }

  const activeRoundTeams =
    (results?.rounds[activeRound as keyof KnockoutSimulationResult['rounds']] as
      | TeamProbability[]
      | undefined) ?? []
  const maxRoundProb = Math.max(0.0001, ...activeRoundTeams.map((t) => t.probability))

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      {/* Header — crest identity, no emoji, no hard-coded gradients */}
      <div className="flex items-center gap-4 border-b border-[var(--border-color)] p-5">
        <TournamentCrest tournamentId={config.crestId} name={config.name} size={48} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Knockout simulator
          </p>
          <h2 className="text-xl font-bold text-[var(--text-primary)]">{config.name}</h2>
        </div>
      </div>

      {/* Setup */}
      {showSetup && (
        <div className="space-y-5 p-5">
          <div>
            <label
              htmlFor="knockout-n-simulations"
              className="mb-2 block text-sm font-medium text-[var(--text-secondary)]"
            >
              Number of simulations
            </label>
            <select
              id="knockout-n-simulations"
              value={numSimulations}
              onChange={(e) => setNumSimulations(parseInt(e.target.value))}
              className="tabular min-h-[44px] w-full rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] px-4 text-sm text-[var(--text-primary)] md:w-56"
            >
              <option value={1000}>1,000 simulations</option>
              <option value={10000}>10,000 simulations</option>
              <option value={50000}>50,000 simulations</option>
              <option value={100000}>100,000 simulations</option>
            </select>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                Participating teams ({teams.length})
              </p>
              {teamsRemoved && (
                <button
                  type="button"
                  onClick={() => setTeams(initialTeams || config.defaultTeams)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset teams
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {teams.map((team) => (
                <button
                  key={team}
                  type="button"
                  onClick={() => setTeams(teams.filter((t) => t !== team))}
                  aria-label={`Remove ${team}`}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-3.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[color-mix(in_srgb,var(--accent-loss)_45%,transparent)] hover:text-[var(--accent-loss)]"
                >
                  {team}
                  <X className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          {/* Primary CTA with progress state */}
          <button
            type="button"
            onClick={runSimulation}
            disabled={loading || teams.length < 2}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-primary)] px-6 text-sm font-bold text-[var(--accent-on-primary)] shadow-[0_8px_24px_-8px_color-mix(in_srgb,var(--accent-primary)_60%,transparent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--muted-bg)] disabled:text-[var(--text-tertiary)] disabled:shadow-none"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                <span aria-live="polite" className="tabular">
                  Running {numSimulations.toLocaleString()} simulations…
                </span>
              </>
            ) : (
              <span>Run simulation</span>
            )}
          </button>
        </div>
      )}

      {error && (
        <div className="mx-5 mb-5 flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--accent-loss)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-loss)_10%,transparent)] p-3.5 text-sm text-[var(--accent-loss)]">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Results */}
      {results && !showSetup && (
        <div className="space-y-5 p-5">
          {/* Headline — StatCards, model output = cyan */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              size="sm"
              accent="ai"
              label="Most likely champion"
              value={results.winner.team}
              sub={`wins ${formatProbability(results.winner.probability)} of simulations`}
            />
            <StatCard
              size="sm"
              label="Runner-up"
              value={results.runnerUp.team}
              sub={`${formatProbability(results.runnerUp.probability)} of simulations`}
            />
            <StatCard
              size="sm"
              label="Simulations"
              value={results.numSimulations.toLocaleString()}
              sub="tournament runs"
            />
          </div>

          {/* Round tabs */}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Simulation round">
            {ROUND_ORDER.map((round) => {
              const roundData = results.rounds[round as keyof KnockoutSimulationResult['rounds']]
              if (!roundData) return null
              const active = activeRound === round
              return (
                <button
                  key={round}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveRound(round)}
                  className={`min-h-[40px] rounded-full px-4 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[var(--accent-primary)] text-[var(--accent-on-primary)]'
                      : 'border border-[var(--border-color)] bg-[var(--muted-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {ROUND_LABELS[round]}
                </button>
              )
            })}
          </div>

          {/* Round probabilities */}
          <div className="space-y-1.5">
            {activeRoundTeams.map((team, idx) => (
              <div
                key={team.team}
                className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-1.5 transition-colors hover:bg-[var(--card-hover)]"
              >
                <span className="tabular w-6 shrink-0 text-right text-sm text-[var(--text-tertiary)]">
                  {idx + 1}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-primary)]">
                  {team.team}
                </p>
                <span
                  className="hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-[var(--muted-bg)] sm:inline-block"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-[var(--accent-ai)]"
                    style={{
                      width: `${Math.max(2, Math.min(100, (team.probability / maxRoundProb) * 100))}%`,
                    }}
                  />
                </span>
                <span className="tabular w-14 shrink-0 text-right text-sm font-semibold text-[var(--accent-ai)]">
                  {formatProbability(team.probability)}
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowSetup(true)}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-color)] text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--muted-bg)] hover:text-[var(--text-primary)]"
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            Modify teams &amp; re-run
          </button>

          <p className="tabular text-center text-xs text-[var(--text-tertiary)]">
            Based on {results.numSimulations.toLocaleString()} simulated tournament runs over
            long-run team ratings
          </p>
        </div>
      )}
    </div>
  )
}
