'use client'

import { useState } from 'react'

// Simple animation wrapper that doesn't require framer-motion
const AnimatedDiv = ({ 
  children, 
  className = '',
  delay = 0 
}: { 
  children: React.ReactNode
  className?: string
  delay?: number
}) => (
  <div 
    className={`animate-fadeIn ${className}`}
    style={{ animationDelay: `${delay}ms` }}
  >
    {children}
  </div>
)

interface TeamProbability {
  team: string
  probability: number
  seed?: number
}

interface KnockoutRound {
  name: string
  teams: TeamProbability[]
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
  winner: {
    team: string
    probability: number
  }
  runnerUp: {
    team: string
    probability: number
  }
}

interface KnockoutSimulatorProps {
  tournament: 'champions_league' | 'europa_league' | 'world_cup' | 'euro' | 'copa_america'
  initialTeams?: string[]
}

const TOURNAMENT_CONFIGS = {
  champions_league: {
    name: 'UEFA Champions League',
    emoji: '🏆',
    gradient: 'from-blue-800 to-indigo-600',
    rounds: ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    defaultTeams: [
      'Real Madrid', 'Manchester City', 'Bayern Munich', 'PSG',
      'Barcelona', 'Liverpool', 'Chelsea', 'Inter Milan',
      'Arsenal', 'Dortmund', 'Napoli', 'Benfica',
      'Porto', 'AC Milan', 'RB Leipzig', 'Atletico Madrid'
    ]
  },
  europa_league: {
    name: 'UEFA Europa League',
    emoji: '🏆',
    gradient: 'from-orange-500 to-amber-500',
    rounds: ['Round of 32', 'Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    defaultTeams: [
      'Roma', 'West Ham', 'Atalanta', 'Bayer Leverkusen',
      'Villarreal', 'Marseille', 'Ajax', 'Sevilla',
      'Sporting CP', 'Freiburg', 'Real Sociedad', 'Feyenoord',
      'Brighton', 'Union Berlin', 'Toulouse', 'Rennes'
    ]
  },
  world_cup: {
    name: 'FIFA World Cup',
    emoji: '🌍',
    gradient: 'from-purple-900 to-red-800',
    rounds: ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    defaultTeams: [
      'France', 'Brazil', 'Argentina', 'England',
      'Germany', 'Spain', 'Netherlands', 'Portugal',
      'Belgium', 'Croatia', 'Uruguay', 'Denmark',
      'Japan', 'Morocco', 'USA', 'Mexico'
    ]
  },
  euro: {
    name: 'UEFA European Championship',
    emoji: '🏆',
    gradient: 'from-sky-700 to-blue-500',
    rounds: ['Round of 16', 'Quarter-Finals', 'Semi-Finals', 'Final'],
    defaultTeams: [
      'Spain', 'England', 'France', 'Germany',
      'Portugal', 'Netherlands', 'Italy', 'Belgium',
      'Croatia', 'Denmark', 'Switzerland', 'Austria',
      'Türkiye', 'Ukraine', 'Scotland', 'Poland'
    ]
  },
  copa_america: {
    name: 'Copa America',
    emoji: '🏆',
    gradient: 'from-yellow-500 to-emerald-600',
    rounds: ['Quarter-Finals', 'Semi-Finals', 'Third Place', 'Final'],
    defaultTeams: [
      'Argentina', 'Brazil', 'Uruguay', 'Colombia',
      'Ecuador', 'Chile', 'Peru', 'Paraguay',
      'Venezuela', 'Bolivia', 'United States', 'Mexico',
      'Canada', 'Costa Rica', 'Panama', 'Jamaica'
    ]
  }
}

export default function KnockoutSimulator({ tournament, initialTeams }: KnockoutSimulatorProps) {
  const config = TOURNAMENT_CONFIGS[tournament]
  const [teams, setTeams] = useState<string[]>(initialTeams || config.defaultTeams)
  const [results, setResults] = useState<KnockoutSimulationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [numSimulations, setNumSimulations] = useState(10000)
  const [activeRound, setActiveRound] = useState<string>('champion')
  const [showSetup, setShowSetup] = useState(true)

  const runSimulation = async () => {
    setLoading(true)
    try {
      const endpoint = tournament === 'champions_league' 
        ? '/api/v1/knockout/champions-league'
        : tournament === 'europa_league'
        ? '/api/v1/knockout/europa-league'
        : '/api/v1/knockout/world-cup'

      const response = await fetch(`${endpoint}?n_simulations=${numSimulations}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teams })
      })

      if (!response.ok) throw new Error('Simulation failed')

      const data = await response.json()
      setResults({
        tournament: config.name,
        numSimulations,
        rounds: data.round_probabilities || {},
        winner: data.winner || { team: 'Unknown', probability: 0 },
        runnerUp: data.runner_up || { team: 'Unknown', probability: 0 }
      })
      setShowSetup(false)
      setActiveRound('champion')
    } catch (error) {
      console.error('Simulation error:', error)
    } finally {
      setLoading(false)
    }
  }

  const getProbabilityColor = (probability: number): string => {
    if (probability >= 0.25) return 'bg-green-500'
    if (probability >= 0.15) return 'bg-emerald-400'
    if (probability >= 0.10) return 'bg-blue-500'
    if (probability >= 0.05) return 'bg-blue-400'
    return 'bg-gray-400'
  }

  const formatProbability = (prob: number): string => {
    return (prob * 100).toFixed(1) + '%'
  }

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      {/* Header */}
      <div className={`bg-gradient-to-r ${config.gradient} p-6`}>
        <div className="flex items-center gap-3">
          <span className="text-4xl">{config.emoji}</span>
          <div>
            <h2 className="text-2xl font-bold text-white">{config.name}</h2>
            <p className="text-white/80 text-sm">Monte Carlo Knockout Simulation</p>
          </div>
        </div>
      </div>

      {/* Setup Panel */}
      {showSetup && (
        <div
          className="border-b overflow-hidden transition-all duration-300"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Number of Simulations
              </label>
                <select
                  value={numSimulations}
                  onChange={(e) => setNumSimulations(parseInt(e.target.value))}
                  className="w-full md:w-48 px-3 py-2 rounded-lg bg-[var(--muted-bg)] border text-[var(--text-primary)]"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <option value={1000}>1,000 simulations</option>
                  <option value={10000}>10,000 simulations</option>
                  <option value={50000}>50,000 simulations</option>
                  <option value={100000}>100,000 simulations</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Participating Teams ({teams.length})
                </label>
                <div className="flex flex-wrap gap-2">
                  {teams.map((team, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 rounded-full text-sm bg-[var(--muted-bg)] text-[var(--text-primary)] flex items-center gap-2"
                    >
                      {team}
                      <button
                        onClick={() => setTeams(teams.filter((_, i) => i !== idx))}
                        className="text-[var(--text-tertiary)] hover:text-red-400"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={runSimulation}
                disabled={loading || teams.length < 2}
                className={`w-full py-3 rounded-xl font-semibold transition-all ${
                  loading || teams.length < 2
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r ' + config.gradient + ' text-white hover:opacity-90'
                }`}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Running {numSimulations.toLocaleString()} simulations...
                  </span>
                ) : (
                  '🎲 Run Simulation'
                )}
              </button>
            </div>
          </div>
        )}

      {/* Results */}
      {results && !showSetup && (
        <div className="p-6">
          {/* Winner Banner */}
          <div
            className="mb-6 p-6 rounded-xl bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/30 animate-fadeIn"
          >
            <div className="text-center">
              <p className="text-amber-600 dark:text-amber-400 text-sm font-medium mb-1">Most Likely Champion</p>
              <h3 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
                🏆 {results.winner.team}
              </h3>
              <p className="text-lg text-amber-600 dark:text-amber-400">
                {formatProbability(results.winner.probability)} chance to win
              </p>
              <p className="text-sm text-[var(--text-tertiary)] mt-2">
                Runner-up: {results.runnerUp.team} ({formatProbability(results.runnerUp.probability)})
              </p>
            </div>
          </div>

          {/* Round Tabs */}
          <div className="flex flex-wrap gap-2 mb-4">
            {['champion', 'final', 'semi_finals', 'quarter_finals', 'round_of_16'].map((round) => {
              const roundData = round === 'champion' 
                ? results.rounds.champion 
                : results.rounds[round as keyof typeof results.rounds]
              if (!roundData) return null

              const displayName = round === 'champion' ? 'Winner' 
                : round === 'final' ? 'Final'
                : round === 'semi_finals' ? 'Semi-Finals'
                : round === 'quarter_finals' ? 'Quarter-Finals'
                : 'Round of 16'

              return (
                <button
                  key={round}
                  onClick={() => setActiveRound(round)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeRound === round
                      ? 'bg-[var(--accent-primary)] text-white'
                      : 'bg-[var(--muted-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {displayName}
                </button>
              )
            })}
          </div>

          {/* Round Results */}
          <div className="space-y-3">
            {(results.rounds[activeRound as keyof typeof results.rounds] || []).map((team, idx) => (
              <div
                key={team.team}
                className="flex items-center gap-4 p-3 rounded-xl bg-[var(--muted-bg)] hover:bg-[var(--muted-bg-hover)] transition-colors animate-slideIn"
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <span className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--card-bg)] text-[var(--text-secondary)] font-medium">
                  {idx + 1}
                </span>
                <div className="flex-1">
                  <p className="font-medium text-[var(--text-primary)]">{team.team}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-32 h-2 rounded-full bg-[var(--card-bg)] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${getProbabilityColor(team.probability)}`}
                      style={{ width: `${Math.min(team.probability * 100, 100)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right font-semibold text-[var(--text-primary)]">
                    {formatProbability(team.probability)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Re-run button */}
          <button
            onClick={() => setShowSetup(true)}
            className="w-full mt-6 py-3 rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--muted-bg)] transition-colors"
          >
            ⚙️ Modify Teams & Re-run
          </button>

          {/* Methodology Note */}
          <p className="text-xs text-[var(--text-tertiary)] mt-4 text-center">
            Based on {numSimulations.toLocaleString()} Monte Carlo simulations using ELO ratings and Bradley-Terry model
          </p>
        </div>
      )}
    </div>
  )
}
