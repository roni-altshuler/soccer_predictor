'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { KnockoutBracket, type BracketRound, type KnockoutMatch as BracketMatch } from '@/components/knockout'
import BracketChallengeBoard from '@/components/tournament/BracketChallengeBoard'
import MatchCalendar from '@/components/match/MatchCalendar'
import WorldCupCountdown from '@/components/worldcup/WorldCupCountdown'
import WorldCupReadinessPanel from '@/components/worldcup/WorldCupReadinessPanel'
import WorldCupCommandCenter from '@/components/worldcup/WorldCupCommandCenter'
import { useGenderQuery } from '@/hooks/useGenderQuery'

type TournamentId = 'champions_league' | 'europa_league' | 'conference_league' | 'world_cup' | 'euro' | 'copa_america'

interface TournamentHomePageProps {
  tournamentId: TournamentId
  tournamentName: string
}

interface GroupStanding {
  position: number
  team: string
  teamId?: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

interface Group {
  name: string
  standings: GroupStanding[]
}

interface Match {
  id: string
  homeTeam: string
  awayTeam: string
  homeScore?: number
  awayScore?: number
  date: string
  time?: string
  round?: string
  venue?: string
  status?: 'upcoming' | 'live' | 'finished'
}

interface NewsItem {
  headline: string
  description: string
  link: string
  image?: string
  published: string
}

interface TopScorer {
  rank: number
  name: string
  team: string
  goals: number
  assists: number
  matches: number
}

interface TournamentData {
  groups: Group[]
  knockoutMatches: Match[]
  upcomingMatches: Match[]
  recentResults: Match[]
  news: NewsItem[]
  topScorers: TopScorer[]
}

const TOURNAMENT_CONFIG = {
  champions_league: {
    name: 'UEFA Champions League',
    emoji: '🏆',
    gradient: 'from-blue-800 to-indigo-600',
    color: 'blue',
    knockoutType: 'champions_league' as const,
    groupCount: 8,
    leagueId: 'uefa.champions',
    espnId: 'uefa.champions',
    logo: 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2.png',
  },
  europa_league: {
    name: 'UEFA Europa League',
    emoji: '🏆',
    gradient: 'from-orange-500 to-amber-500',
    color: 'orange',
    knockoutType: 'europa_league' as const,
    groupCount: 8,
    leagueId: 'uefa.europa',
    espnId: 'uefa.europa',
    logo: 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/2310.png',
  },
  world_cup: {
    name: 'FIFA World Cup',
    emoji: '🌍',
    gradient: 'from-purple-900 to-red-800',
    color: 'purple',
    knockoutType: 'world_cup' as const,
    groupCount: 8,
    leagueId: 'fifa.world',
    espnId: 'fifa.world',
    logo: 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/4.png',
  },
  euro: {
    name: 'UEFA European Championship',
    emoji: '🏆',
    gradient: 'from-sky-700 to-blue-500',
    color: 'sky',
    knockoutType: 'euro' as const,
    groupCount: 6,
    leagueId: 'uefa.euro',
    espnId: 'uefa.euro',
    logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/74.png',
  },
  copa_america: {
    name: 'Copa America',
    emoji: '🏆',
    gradient: 'from-yellow-500 to-emerald-600',
    color: 'emerald',
    knockoutType: 'copa_america' as const,
    groupCount: 4,
    leagueId: 'conmebol.america',
    espnId: 'conmebol.america',
    logo: 'https://a.espncdn.com/i/leaguelogos/soccer/500/83.png',
  },
  conference_league: {
    name: 'UEFA Conference League',
    emoji: '🏆',
    gradient: 'from-green-600 to-emerald-500',
    color: 'green',
    knockoutType: 'conference_league' as const,
    groupCount: 8,
    leagueId: 'uefa.europa.conf',
    espnId: 'uefa.europa.conf',
    logo: 'https://a.espncdn.com/combiner/i?img=/i/leaguelogos/soccer/500/5765.png',
  },
}

const TABS = ['Overview', 'Groups', 'Knockout', 'Challenge', 'Top Scorers', 'Fixtures', 'Simulator', 'News'] as const
type TabType = typeof TABS[number]

// Available tournament seasons for dropdown
const TOURNAMENT_SEASONS = [
  { value: '2025', label: '2025-26' },
  { value: '2024', label: '2024-25' },
  { value: '2023', label: '2023-24' },
  { value: '2022', label: '2022-23' },
  { value: '2021', label: '2021-22' },
  { value: '2020', label: '2020-21' },
  { value: '2019', label: '2019-20' },
]

const WORLD_CUP_SEASONS = [
  { value: '2026', label: '2026' },
  { value: '2022', label: '2022 (Qatar)' },
  { value: '2018', label: '2018 (Russia)' },
  { value: '2014', label: '2014 (Brazil)' },
  { value: '2010', label: '2010 (South Africa)' },
]

const EURO_SEASONS = [
  { value: '2024', label: '2024 (Germany)' },
  { value: '2020', label: '2020' },
  { value: '2016', label: '2016 (France)' },
  { value: '2012', label: '2012 (Poland/Ukraine)' },
  { value: '2008', label: '2008 (Austria/Switzerland)' },
]

const COPA_AMERICA_SEASONS = [
  { value: '2024', label: '2024 (United States)' },
  { value: '2021', label: '2021 (Brazil)' },
  { value: '2019', label: '2019 (Brazil)' },
  { value: '2016', label: '2016 (Centenario)' },
  { value: '2015', label: '2015 (Chile)' },
]

function getDefaultSeason(tournamentId: TournamentId): string {
  if (tournamentId === 'world_cup') return '2026'
  if (tournamentId === 'euro' || tournamentId === 'copa_america') return '2024'
  return '2025'
}

function getAvailableSeasons(tournamentId: TournamentId) {
  if (tournamentId === 'world_cup') return WORLD_CUP_SEASONS
  if (tournamentId === 'euro') return EURO_SEASONS
  if (tournamentId === 'copa_america') return COPA_AMERICA_SEASONS
  return TOURNAMENT_SEASONS
}

// Simulation count options (like in Predict tab)
const SIMULATION_OPTIONS = [
  { value: 500, label: '500 (Fast)' },
  { value: 1000, label: '1,000' },
  { value: 5000, label: '5,000' },
  { value: 10000, label: '10,000 (Accurate)' },
  { value: 25000, label: '25,000' },
  { value: 50000, label: '50,000' },
]

const SCENARIO_OPTIONS = [
  { value: 'baseline', label: 'Baseline', detail: 'Use current standings and model balance.' },
  { value: 'favorable', label: 'Favorable Path', detail: 'Boost the focus team to test an optimistic route.' },
  { value: 'adverse', label: 'Adverse Path', detail: 'Stress-test the focus team with a harder route.' },
] as const

const VOLATILITY_OPTIONS = [
  { value: 'low', label: 'Low volatility', detail: 'Favorites are more stable.' },
  { value: 'standard', label: 'Standard', detail: 'Balanced tournament randomness.' },
  { value: 'high', label: 'High volatility', detail: 'Upset-prone path simulation.' },
] as const

type ScenarioMode = typeof SCENARIO_OPTIONS[number]['value']
type VolatilityMode = typeof VOLATILITY_OPTIONS[number]['value']

// Simulation constants
const GOAL_DIFF_NORMALIZATION = 10  // Factor to normalize goal difference impact
const RANDOM_VARIANCE = 5  // Random variance added to team strength
const ROUND_VARIANCE = 3   // Random variance for knockout round outcomes

const VOLATILITY_CONFIG: Record<VolatilityMode, { randomVariance: number; roundVariance: number }> = {
  low: { randomVariance: Math.max(2, RANDOM_VARIANCE - 2), roundVariance: Math.max(1, ROUND_VARIANCE - 1.5) },
  standard: { randomVariance: RANDOM_VARIANCE, roundVariance: ROUND_VARIANCE },
  high: { randomVariance: RANDOM_VARIANCE + 3, roundVariance: ROUND_VARIANCE + 2 },
}

const SAVED_SCENARIOS_STORAGE_KEY = 'fotpredict-saved-tournament-scenarios-v1'

type SavedScenarioCard = {
  id: string
  tournamentId: TournamentId
  season: string
  mode: ScenarioMode
  focusTeam: string
  volatility: VolatilityMode
  winner: string
  winnerProbability: number
  nSimulations: number
  createdAt: string
  topContenders: Array<{ team: string; probability: number }>
}

function scenarioLabel(mode?: ScenarioMode): string {
  return SCENARIO_OPTIONS.find(option => option.value === mode)?.label || 'Baseline'
}

function volatilityLabel(mode?: VolatilityMode): string {
  return VOLATILITY_OPTIONS.find(option => option.value === mode)?.label || 'Standard'
}

export default function TournamentHomePage({ tournamentId, tournamentName }: TournamentHomePageProps) {
  const config = TOURNAMENT_CONFIG[tournamentId]
  const router = useRouter()
  const { asQueryParam: genderParam } = useGenderQuery()
  const [activeTab, setActiveTab] = useState<TabType>('Overview')
  const [loading, setLoading] = useState(true)
  const [selectedSeason, setSelectedSeason] = useState(getDefaultSeason(tournamentId))
  const [runningSimulation, setRunningSimulation] = useState(false)
  const [numSimulations, setNumSimulations] = useState(10000)
  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>('baseline')
  const [scenarioFocusTeam, setScenarioFocusTeam] = useState('')
  const [volatilityMode, setVolatilityMode] = useState<VolatilityMode>('standard')
  const [savedScenarioCards, setSavedScenarioCards] = useState<SavedScenarioCard[]>([])
  const [scenarioShareMessage, setScenarioShareMessage] = useState('')
  // New: Probability-based simulation results (like LeagueHomePage)
  const [simulationResults, setSimulationResults] = useState<{
    tournament_name: string
    n_simulations: number
    scenario?: {
      mode: ScenarioMode
      focusTeam: string
      volatility: VolatilityMode
    }
    teams: Array<{
      team_name: string
      current_points: number
      win_probability: number
      final_probability: number
      semi_final_probability: number
      quarter_final_probability: number
    }>
    most_likely_winner: string
    winner_probability: number
  } | null>(null)
  const [bracketRounds, setBracketRounds] = useState<BracketRound[]>([])
  const [simulationProbabilities, setSimulationProbabilities] = useState<{
    champion: { team: string; probability: number }[]
    final: { team: string; probability: number }[]
    semi_finals: { team: string; probability: number }[]
    quarter_finals: { team: string; probability: number }[]
  } | null>(null)
  const [data, setData] = useState<TournamentData>({
    groups: [],
    knockoutMatches: [],
    upcomingMatches: [],
    recentResults: [],
    news: [],
    topScorers: [],
  })

  // Get available seasons based on tournament type
  const availableSeasons = getAvailableSeasons(tournamentId)
  const visibleTabs = TABS
  const isInternationalTournament = tournamentId === 'world_cup' || tournamentId === 'euro' || tournamentId === 'copa_america'

  const simulationTeamOptions = useMemo(() => {
    const names = data.groups
      .flatMap(group => group.standings || [])
      .map(team => team.team)
      .filter((name) => name && name !== 'TBD')
    return Array.from(new Set(names)).sort()
  }, [data.groups])

  const challengeSimulationData = useMemo(() => {
    if (simulationProbabilities) return simulationProbabilities
    if (!simulationResults) return null

    return {
      champion: simulationResults.teams.map((team) => ({
        team: team.team_name,
        probability: team.win_probability,
      })),
      final: simulationResults.teams.map((team) => ({
        team: team.team_name,
        probability: team.final_probability,
      })),
      semi_finals: simulationResults.teams.map((team) => ({
        team: team.team_name,
        probability: team.semi_final_probability,
      })),
      quarter_finals: simulationResults.teams.map((team) => ({
        team: team.team_name,
        probability: team.quarter_final_probability,
      })),
    }
  }, [simulationProbabilities, simulationResults])

  useEffect(() => {
    if (simulationTeamOptions.length === 0) {
      if (scenarioFocusTeam) setScenarioFocusTeam('')
      return
    }
    if (!scenarioFocusTeam || !simulationTeamOptions.includes(scenarioFocusTeam)) {
      setScenarioFocusTeam(simulationTeamOptions[0])
    }
  }, [simulationTeamOptions, scenarioFocusTeam])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY)
      if (!raw) {
        setSavedScenarioCards([])
        return
      }
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) {
        setSavedScenarioCards([])
        return
      }
      setSavedScenarioCards(
        parsed
          .filter((item): item is SavedScenarioCard => {
            if (!item || typeof item !== 'object') return false
            const card = item as Partial<SavedScenarioCard>
            return typeof card.id === 'string' &&
              card.tournamentId === tournamentId &&
              typeof card.season === 'string' &&
              typeof card.winner === 'string' &&
              typeof card.winnerProbability === 'number'
          })
          .slice(0, 6)
      )
    } catch {
      setSavedScenarioCards([])
    }
  }, [tournamentId])

  // Minimum number of teams required for tournament simulation
  const MIN_TEAMS_FOR_SIMULATION = 8

  // Run tournament simulation with probability-based output (like LeagueHomePage)
  const runTournamentSimulation = async () => {
    setRunningSimulation(true)
    try {
      if (tournamentId === 'champions_league') {
        const res = await fetch(`/api/v1/knockout/champions-league/simulate?n_simulations=${numSimulations}`)
        if (res.ok) {
          const simData = await res.json()
          const winnerRows = simData.winnerProbabilities || []
          const finalRows = simData.finalProbabilities || []
          const semiRows = simData.semiFinalProbabilities || []
          const teamNames = Array.from(new Set<string>([
            ...winnerRows.map((row: { team: string }) => row.team),
            ...finalRows.map((row: { team: string }) => row.team),
            ...semiRows.map((row: { team: string }) => row.team),
          ]))

          setSimulationResults({
            tournament_name: `${tournamentName} · ${simData.currentRound || 'Current knockout round'}`,
            n_simulations: simData.n_simulations || numSimulations,
            scenario: {
              mode: 'baseline',
              focusTeam: 'Current semifinal field',
              volatility: 'standard',
            },
            teams: teamNames.map((team) => ({
              team_name: team,
              current_points: 0,
              win_probability: winnerRows.find((row: { team: string }) => row.team === team)?.probability || 0,
              final_probability: finalRows.find((row: { team: string }) => row.team === team)?.probability || 0,
              semi_final_probability: semiRows.find((row: { team: string }) => row.team === team)?.probability || 0,
              quarter_final_probability: 1,
            })).sort((a, b) => b.win_probability - a.win_probability),
            most_likely_winner: simData.mostLikelyWinner || winnerRows[0]?.team || 'Unknown',
            winner_probability: simData.winnerProbability || winnerRows[0]?.probability || 0,
          })
        }
        setRunningSimulation(false)
        return
      }

      // Safely get teams from standings with null checks
      if (!data.groups || data.groups.length === 0) {
        console.error(`Tournament simulation requires group data. Please ensure tournament data is loaded.`)
        setRunningSimulation(false)
        return
      }

      const teams = data.groups.flatMap(g => 
        (g.standings || []).map(s => ({
          team: s.team,
          points: s.points,
          goalDifference: s.goalDifference,
        }))
      ).filter(t => t.team)

      if (teams.length < MIN_TEAMS_FOR_SIMULATION) {
        console.error(`Tournament simulation requires at least ${MIN_TEAMS_FOR_SIMULATION} teams, found ${teams.length}. Please ensure tournament data is loaded.`)
        setRunningSimulation(false)
        return
      }

      // Monte Carlo simulation based on team strength (points + GD)
      const teamResults: Record<string, { wins: number; finals: number; semis: number; quarters: number }> = {}
      teams.forEach(t => {
        teamResults[t.team] = { wins: 0, finals: 0, semis: 0, quarters: 0 }
      })

      // Run simulations
      const volatility = VOLATILITY_CONFIG[volatilityMode]
      const focusDelta = scenarioMode === 'favorable'
        ? 4
        : scenarioMode === 'adverse'
          ? -3
          : 0

      for (let sim = 0; sim < numSimulations; sim++) {
        // Create tournament bracket simulation
        // Weight teams by their points + goal difference using named constants
        const weightedTeams = teams.map(t => ({
          ...t,
          strength: Math.max(
            0.1,
            t.points +
              (t.goalDifference / GOAL_DIFF_NORMALIZATION) +
              (t.team === scenarioFocusTeam ? focusDelta : 0) +
              Math.random() * volatility.randomVariance
          ),
        })).sort((a, b) => b.strength - a.strength)

        // Simulate knockout rounds
        const quarterFinalists = weightedTeams.slice(0, 8)
        quarterFinalists.forEach(t => teamResults[t.team].quarters++)

        // Semi-finals (top 4 based on weighted random)
        const semiFinalists = quarterFinalists
          .map(t => ({ ...t, roundStrength: t.strength + Math.random() * volatility.roundVariance }))
          .sort((a, b) => b.roundStrength - a.roundStrength)
          .slice(0, 4)
        semiFinalists.forEach(t => teamResults[t.team].semis++)

        // Finals (top 2)
        const finalists = semiFinalists
          .map(t => ({ ...t, roundStrength: t.strength + Math.random() * volatility.roundVariance }))
          .sort((a, b) => b.roundStrength - a.roundStrength)
          .slice(0, 2)
        finalists.forEach(t => teamResults[t.team].finals++)

        // Winner - Use weighted probability based on team strength instead of coin flip
        // Calculate probability based on relative strength of finalists
        const totalStrength = finalists[0].roundStrength + finalists[1].roundStrength
        const team1WinProb = finalists[0].roundStrength / totalStrength
        const winner = Math.random() < team1WinProb ? finalists[0] : finalists[1]
        if (winner) teamResults[winner.team].wins++
      }

      // Calculate probabilities
      const teamProbabilities = Object.entries(teamResults)
        .map(([team_name, results]) => ({
          team_name,
          current_points: teams.find(t => t.team === team_name)?.points || 0,
          win_probability: results.wins / numSimulations,
          final_probability: results.finals / numSimulations,
          semi_final_probability: results.semis / numSimulations,
          quarter_final_probability: results.quarters / numSimulations,
        }))
        .sort((a, b) => b.win_probability - a.win_probability)

      const mostLikelyWinner = teamProbabilities[0]

      setSimulationResults({
        tournament_name: tournamentName,
        n_simulations: numSimulations,
        scenario: {
          mode: scenarioMode,
          focusTeam: scenarioFocusTeam || 'No focus team',
          volatility: volatilityMode,
        },
        teams: teamProbabilities,
        most_likely_winner: mostLikelyWinner?.team_name || 'Unknown',
        winner_probability: mostLikelyWinner?.win_probability || 0,
      })
    } catch (error) {
      console.error('Simulation error:', error)
    } finally {
      setRunningSimulation(false)
    }
  }

  const saveScenarioCard = () => {
    if (!simulationResults) return

    const card: SavedScenarioCard = {
      id: `${tournamentId}-${selectedSeason}-${Date.now()}`,
      tournamentId,
      season: selectedSeason,
      mode: simulationResults.scenario?.mode || 'baseline',
      focusTeam: simulationResults.scenario?.focusTeam || 'No focus team',
      volatility: simulationResults.scenario?.volatility || 'standard',
      winner: simulationResults.most_likely_winner,
      winnerProbability: simulationResults.winner_probability,
      nSimulations: simulationResults.n_simulations,
      createdAt: new Date().toISOString(),
      topContenders: simulationResults.teams.slice(0, 3).map((team) => ({
        team: team.team_name,
        probability: team.win_probability,
      })),
    }

    try {
      const raw = localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY)
      const existing = raw ? JSON.parse(raw) as unknown : []
      const existingCards = Array.isArray(existing) ? existing.filter((item): item is SavedScenarioCard => Boolean(item && typeof item === 'object')) : []
      const nextAll = [card, ...existingCards].slice(0, 30)
      localStorage.setItem(SAVED_SCENARIOS_STORAGE_KEY, JSON.stringify(nextAll))
      setSavedScenarioCards(nextAll.filter(item => item.tournamentId === tournamentId).slice(0, 6))
    } catch {
      setSavedScenarioCards((current) => [card, ...current].slice(0, 6))
    }
  }

  const removeScenarioCard = (id: string) => {
    try {
      const raw = localStorage.getItem(SAVED_SCENARIOS_STORAGE_KEY)
      const existing = raw ? JSON.parse(raw) as unknown : []
      const existingCards = Array.isArray(existing) ? existing.filter((item): item is SavedScenarioCard => Boolean(item && typeof item === 'object')) : []
      const nextAll = existingCards.filter(card => card.id !== id)
      localStorage.setItem(SAVED_SCENARIOS_STORAGE_KEY, JSON.stringify(nextAll))
      setSavedScenarioCards(nextAll.filter(card => card.tournamentId === tournamentId).slice(0, 6))
    } catch {
      setSavedScenarioCards((current) => current.filter(card => card.id !== id))
    }
  }

  const copyScenarioCard = async (card: SavedScenarioCard) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(card, null, 2))
      setScenarioShareMessage(`Copied ${card.winner} scenario card to clipboard.`)
    } catch {
      setScenarioShareMessage('Clipboard access failed while exporting the scenario card.')
    }
  }

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        // Fetch all tournament data from server-side API route
        // This ensures ESPN requests happen server-side (not blocked by browser)
        const seasonParam = selectedSeason ? `?season=${selectedSeason}` : ''
        const sep = seasonParam ? '&' : '?'
        const res = await fetch(`/api/tournament/${tournamentId}${seasonParam}${sep}gender=${genderParam}`)
        
        if (res.ok) {
          const apiData = await res.json()
          
          setData({
            groups: apiData.groups || [],
            knockoutMatches: apiData.knockoutMatches || [],
            upcomingMatches: apiData.upcomingMatches || [],
            recentResults: apiData.recentResults || [],
            news: apiData.news || [],
            topScorers: apiData.topScorers || [],
          })
          
          // Build bracket rounds from knockout matches
          const ROUND_ORDER = [
            'Knockout Round Playoffs',
            'Rd of 16',
            'Round of 16',
            'Quarterfinals',
            'Quarter-Finals',
            'Semifinals',
            'Semi-Finals',
            '3rd-Place Match',
            'Third Place',
            'Final',
          ]
          
          const roundsMap: Record<string, BracketMatch[]> = {}
          for (const match of apiData.knockoutMatches || []) {
            const roundName = match.round || 'Knockout'
            if (!roundsMap[roundName]) {
              roundsMap[roundName] = []
            }
            roundsMap[roundName].push({
              id: match.id,
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              homeScore: match.homeScore,
              awayScore: match.awayScore,
              date: match.date,
              time: match.time,
              status: match.status === 'finished' ? 'finished' : match.status === 'live' ? 'live' : 'scheduled',
              round: roundName,
              leg: match.leg as 1 | 2 | undefined,
              winner: match.winner || null,
            })
          }
          
          // Sort rounds in logical order
          const sortedRounds = Object.keys(roundsMap).sort((a, b) => {
            const aIdx = ROUND_ORDER.findIndex(r => a.toLowerCase().includes(r.toLowerCase()))
            const bIdx = ROUND_ORDER.findIndex(r => b.toLowerCase().includes(r.toLowerCase()))
            return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx)
          })
          
          const bracketData: BracketRound[] = sortedRounds.map(name => ({
            name,
            matches: roundsMap[name],
          }))
          setBracketRounds(bracketData)
        } else {
          console.error('Tournament API error:', res.status)
        }
      } catch (error) {
        console.error('Error fetching tournament data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [tournamentId, selectedSeason, genderParam])
  
  // Fetch simulation probabilities for the tournament
  useEffect(() => {
    const fetchSimulation = async () => {
      try {
        const endpoint = tournamentId === 'champions_league'
          ? '/api/v1/knockout/champions-league/simulate'
          : tournamentId === 'europa_league'
            ? '/api/v1/knockout/europa-league/simulate'
            : tournamentId === 'world_cup'
              ? '/api/v1/knockout/world-cup/simulate'
              : null

        if (!endpoint) {
          setSimulationProbabilities(null)
          return
        }
        
        const res = await fetch(`${endpoint}?n_simulations=5000`)
        if (res.ok) {
          const simData = await res.json()
          setSimulationProbabilities({
            champion: simData.winnerProbabilities || [],
            final: simData.finalProbabilities || [],
            semi_finals: simData.semiFinalProbabilities || [],
            quarter_finals: simData.quarterFinalProbabilities || [],
          })
        }
      } catch (error) {
        console.error('Error fetching simulation:', error)
      }
    }
    
    fetchSimulation()
  }, [tournamentId])

  const renderGroupsTable = (group: Group) => (
    <div key={group.name} className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className={`bg-gradient-to-r ${config.gradient} px-4 py-2`}>
        <h3 className="text-white font-semibold">{group.name}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-[var(--text-tertiary)]" style={{ borderColor: 'var(--border-color)' }}>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Team</th>
              <th className="px-3 py-2 text-center">P</th>
              <th className="px-3 py-2 text-center">W</th>
              <th className="px-3 py-2 text-center">D</th>
              <th className="px-3 py-2 text-center">L</th>
              <th className="px-3 py-2 text-center">GD</th>
              <th className="px-3 py-2 text-center font-semibold">Pts</th>
              <th className="px-3 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {group.standings.map((team) => {
              // Determine qualification status based on tournament type
              // For UCL/UEL new league format (36 teams in single league):
              // - Positions 1-8 = Direct to Round of 16
              // - Positions 9-24 = R16 Playoff
              // - Positions 25-36 = Eliminated
              // Calculate overall position across all entries for the league table format
              let overallPos = team.position
              // If there are multiple groups, calculate overall position
              if (data.groups.length > 1) {
                const groupIdx = data.groups.findIndex(g => g.name === group.name)
                const teamsPerGroup = group.standings.length
                overallPos = groupIdx * teamsPerGroup + team.position
              }
              
              let statusBadge = null
              let bgClass = ''
              
              if (isInternationalTournament) {
                // International tournaments: top 2 qualify, 3rd can matter in expanded formats.
                if (team.position <= 2) {
                  statusBadge = <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded whitespace-nowrap font-medium">Qualified</span>
                  bgClass = 'bg-green-500/20 border-l-4 border-l-green-400'
                } else if (team.position === 3) {
                  statusBadge = <span className="text-xs bg-amber-600 text-white px-2 py-0.5 rounded whitespace-nowrap font-medium">Possible</span>
                  bgClass = 'bg-amber-500/20 border-l-4 border-l-amber-400'
                }
              } else {
                // Champions League / Europa League: New league format
                // Top 8 overall = Direct R16, 9-24 = R16 Playoff, 25+ = Eliminated
                if (overallPos <= 8) {
                  statusBadge = <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded whitespace-nowrap font-medium">R16</span>
                  bgClass = 'bg-green-500/20 border-l-4 border-l-green-400'
                } else if (overallPos <= 24) {
                  statusBadge = <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded whitespace-nowrap font-medium">R16 Playoff</span>
                  bgClass = 'bg-blue-500/20 border-l-4 border-l-blue-400'
                } else {
                  statusBadge = <span className="text-xs bg-red-500/80 text-white px-2 py-0.5 rounded whitespace-nowrap font-medium">Eliminated</span>
                  bgClass = 'bg-red-500/10 border-l-4 border-l-red-400'
                }
              }
              
              return (
                <tr 
                  key={team.team}
                  className={`border-b hover:bg-[var(--muted-bg)] transition-colors ${bgClass}`}
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <td className="px-3 py-2 text-[var(--text-tertiary)]">{team.position}</td>
                  <td className="px-3 py-2 text-[var(--text-primary)] font-medium">
                    {team.teamId ? (
                      <Link href={`/teams/${team.teamId}`} className="hover:text-[var(--accent-primary)]">
                        {team.team}
                      </Link>
                    ) : team.team}
                  </td>
                  <td className="px-3 py-2 text-center text-[var(--text-secondary)]">{team.played}</td>
                  <td className="px-3 py-2 text-center text-[var(--text-secondary)]">{team.won}</td>
                  <td className="px-3 py-2 text-center text-[var(--text-secondary)]">{team.drawn}</td>
                  <td className="px-3 py-2 text-center text-[var(--text-secondary)]">{team.lost}</td>
                  <td className="px-3 py-2 text-center text-[var(--text-secondary)]">
                    {team.goalDifference > 0 ? '+' : ''}{team.goalDifference}
                  </td>
                  <td className="px-3 py-2 text-center font-semibold text-[var(--text-primary)]">{team.points}</td>
                  <td className="px-3 py-2 text-center">{statusBadge}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-xs text-[var(--text-tertiary)] border-t flex flex-wrap gap-3" style={{ borderColor: 'var(--border-color)' }}>
        {isInternationalTournament ? (
          <>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-green-400 mr-1"></span> Qualified for knockout</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-amber-400 mr-1"></span> Possible qualification</span>
          </>
        ) : (
          <>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-green-400 mr-1"></span> Round of 16 (Top 8)</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-blue-400 mr-1"></span> R16 Playoff (9-24)</span>
            <span><span className="inline-block w-3 h-3 rounded-sm bg-red-400 mr-1"></span> Eliminated (25+)</span>
          </>
        )}
      </div>
    </div>
  )

  // Helper to determine if a team won based on scores
  const isWinningTeam = (teamScore?: number, opponentScore?: number): boolean => {
    return teamScore !== undefined && opponentScore !== undefined && teamScore > opponentScore
  }

  const renderMatchCard = (match: Match, showResult = false) => {
    const homeWon = showResult && isWinningTeam(match.homeScore, match.awayScore)
    const awayWon = showResult && isWinningTeam(match.awayScore, match.homeScore)

    return (
      <Link
        key={match.id}
        href={`/matches/${match.id}`}
        className="block p-4 hover:bg-[var(--muted-bg)] transition-colors"
      >
        <div className="flex justify-between items-center">
          <div className="flex-1">
            <p className={`font-medium ${homeWon ? 'text-green-500' : 'text-[var(--text-primary)]'}`}>
              {match.homeTeam}
            </p>
            <p className={`font-medium ${awayWon ? 'text-green-500' : 'text-[var(--text-primary)]'}`}>
              {match.awayTeam}
            </p>
          </div>
          {showResult && match.homeScore !== undefined ? (
            <div className="text-right">
              <p className="text-lg font-bold text-[var(--text-primary)]">{match.homeScore}</p>
              <p className="text-lg font-bold text-[var(--text-primary)]">{match.awayScore}</p>
            </div>
          ) : (
            <div className="text-right text-sm">
              <p className="text-[var(--text-secondary)]">{match.date}</p>
              <p className="text-[var(--text-tertiary)]">{match.time}</p>
            </div>
          )}
        </div>
        {match.round && (
          <p className="text-xs text-[var(--text-tertiary)] mt-1">{match.round}</p>
        )}
        {match.status === 'live' && (
          <span className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-500 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
            LIVE
          </span>
        )}
      </Link>
    )
  }

  const renderOverview = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Column - Upcoming Matches */}
      <div className="lg:col-span-2 space-y-6">
        {/* Upcoming Matches */}
        <div className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
          <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Upcoming Matches</h2>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
            {data.upcomingMatches.length > 0 ? (
              data.upcomingMatches.slice(0, 5).map(match => renderMatchCard(match))
            ) : (
              <p className="p-4 text-[var(--text-tertiary)]">No upcoming matches</p>
            )}
          </div>
        </div>

        {/* Recent Results */}
        <div className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
          <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Recent Results</h2>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
            {data.recentResults.length > 0 ? (
              data.recentResults.slice(0, 5).map(match => renderMatchCard(match, true))
            ) : (
              <p className="p-4 text-[var(--text-tertiary)]">No recent results</p>
            )}
          </div>
        </div>
      </div>

      {/* Right Column - Groups Preview & News */}
      <div className="space-y-6">
        {/* Quick Simulator Link - Consistent with LeagueHomePage */}
        <div
          className="bg-gradient-to-br from-[var(--accent-ai)]/18 to-[var(--accent-primary)]/16 rounded-xl p-6 cursor-pointer hover:from-[var(--accent-ai)]/24 hover:to-[var(--accent-primary)]/22 transition-all border border-[var(--accent-ai)]/30 hover:scale-[1.02] hover:shadow-lg"
          onClick={() => setActiveTab('Simulator')}
        >
          <div className="text-4xl mb-3">🎲</div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Run Simulation</h3>
          <p className="text-sm text-[var(--text-secondary)]">Predict the tournament winner</p>
        </div>

        {/* AI Model Accuracy Card */}
        <Link
          href="/tracking"
          className="block bg-gradient-to-br from-emerald-600/20 to-teal-600/20 rounded-xl p-6 hover:from-emerald-600/30 hover:to-teal-600/30 transition-all border border-emerald-500/30 hover:scale-[1.02] hover:shadow-lg"
        >
          <div className="text-4xl mb-3">📊</div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">AI Model Accuracy</h3>
          <p className="text-sm text-[var(--text-secondary)]">Track prediction performance vs real outcomes</p>
        </Link>

        {/* Groups Preview */}
        {data.groups.length > 0 && (
          <div className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
            <div className="p-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--border-color)' }}>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Group Standings</h2>
              <button
                onClick={() => setActiveTab('Groups')}
                className="text-sm text-[var(--accent-primary)] hover:underline"
              >
                View All
              </button>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
              {data.groups.slice(0, 4).map(group => (
                <div key={group.name} className="p-3">
                  <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{group.name}</p>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {group.standings.slice(0, 2).map((t, i) => (
                      <span key={t.team}>
                        {i > 0 && ' • '}{t.team} ({t.points}pts)
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Latest News */}
        {data.news.length > 0 && (
          <div className="bg-[var(--card-bg)] rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Latest News</h2>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
              {data.news.filter(item => item.link).slice(0, 3).map((item, idx) => (
                <a
                  key={idx}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-4 hover:bg-[var(--muted-bg)] transition-colors group"
                >
                  {item.image && (
                    <img
                      src={item.image}
                      alt={item.headline}
                      className="w-full h-32 object-cover rounded-lg mb-2"
                    />
                  )}
                  <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] line-clamp-2">
                    {item.headline}
                  </p>
                  {item.published && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">
                      {formatDistanceToNow(new Date(item.published), { addSuffix: true })}
                    </p>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const renderKnockoutBracket = () => (
    <div className="space-y-6">
      {data.knockoutMatches.length > 0 || bracketRounds.length > 0 ? (
        <KnockoutBracket
          tournament={config.knockoutType}
          rounds={bracketRounds}
          simulationData={simulationProbabilities || undefined}
          showProbabilities={!!simulationProbabilities}
          onMatchClick={(match) => {
            router.push(`/matches/${match.id}`)
          }}
        />
      ) : (
        <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] p-8 text-center">
          <span className="text-5xl mb-4 block">🏆</span>
          <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">Knockout Stage</h3>
          <p className="text-[var(--text-secondary)] max-w-md mx-auto">
            The knockout stage has not started yet or no knockout matches are available for the selected season.
            Check back once the knockout rounds begin.
          </p>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex-1" style={{ backgroundColor: 'var(--background)' }}>
      {/* Hero Header - FotMob Style (consistent with LeagueHomePage) */}
      <div className={`bg-gradient-to-r ${config.gradient} py-8 px-4`}>
        <div className="max-w-6xl mx-auto">
          {/* Back Button */}
          <Link
            href="/matches"
            className="inline-flex items-center gap-2 text-white/80 hover:text-white mb-4 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Leagues
          </Link>
      
          <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
            <div className="flex items-center gap-4">
              {config.logo ? (
                <img 
                  src={config.logo} 
                  alt={tournamentName}
                  className="w-16 h-16 object-contain bg-white rounded-xl p-1"
                />
              ) : (
                <span className="text-5xl">{config.emoji}</span>
              )}
              <div>
                <h1 className="text-3xl font-bold text-white">{tournamentName}</h1>
                <p className="text-white/80">
                  {isInternationalTournament ? 'International Tournament' : 'European Club Competition'} • {availableSeasons.find(s => s.value === selectedSeason)?.label || '2025-26'}
                </p>
              </div>
            </div>
          
            {/* Season Selector */}
            <div className="flex items-center gap-3">
              <select
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(e.target.value)}
                className="px-4 py-2 rounded-lg bg-white/20 text-white border border-white/30 backdrop-blur-sm cursor-pointer hover:bg-white/30 transition-colors"
              >
                {availableSeasons.map(season => (
                  <option key={season.value} value={season.value} className="text-gray-900">
                    {season.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        
          {/* Simulation Results */}
          {simulationResults && (
            <div className="mt-4 p-4 bg-white/10 backdrop-blur-sm rounded-xl border border-white/20">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="text-amber-300 text-sm font-medium">🏆 Monte Carlo Simulation ({simulationResults.n_simulations.toLocaleString()} runs)</p>
                  <p className="text-white font-bold text-lg">{simulationResults.most_likely_winner} to win the tournament</p>
                  <p className="text-white/70 text-sm mt-1">
                    Top contenders: {simulationResults.teams.slice(0, 3).map(t => `${t.team_name} (${(t.win_probability * 100).toFixed(1)}%)`).join(', ')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-amber-400">
                    {(simulationResults.winner_probability * 100).toFixed(1)}%
                  </p>
                  <p className="text-white/60 text-xs">win probability</p>
                </div>
              </div>
            </div>
          )}
        
          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            {/* Group Leader */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <p className="text-white/70 text-sm">Group Leader</p>
              <p className="text-white font-bold text-lg">
                {data.groups[0]?.standings[0]?.team || 'TBD'}
              </p>
              <p className="text-white/80 text-sm">
                {data.groups[0]?.standings[0]?.points || 0} points
              </p>
            </div>
          
            {/* Teams */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <p className="text-white/70 text-sm">Teams</p>
              <p className="text-white font-bold text-lg">
                {data.groups.flatMap(g => g.standings).length || 0}
              </p>
              <p className="text-white/80 text-sm">participating</p>
            </div>
          
            {/* Recent Matches */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <p className="text-white/70 text-sm">Recent Results</p>
              <p className="text-white font-bold text-lg">{data.recentResults.length || 0}</p>
              <p className="text-white/80 text-sm">matches played</p>
            </div>
          
            {/* Upcoming Matches */}
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4">
              <p className="text-white/70 text-sm">Coming Up</p>
              <p className="text-white font-bold text-lg">{data.upcomingMatches.length || 0}</p>
              <p className="text-white/80 text-sm">fixtures scheduled</p>
            </div>
          </div>
        </div>
      </div>

      {tournamentId === 'world_cup' && (
        <div className="max-w-6xl mx-auto space-y-3 px-4 pt-4">
          <WorldCupCommandCenter
            selectedSeason={selectedSeason}
            groups={data.groups}
            upcomingMatches={data.upcomingMatches}
            recentResults={data.recentResults}
            topScorers={data.topScorers}
            simulationProbabilities={simulationProbabilities}
            onOpenTab={setActiveTab}
            surface="public"
          />
          <WorldCupCountdown compact />
          <WorldCupReadinessPanel compact />
        </div>
      )}

      {/* Navigation Tabs - Consistent with LeagueHomePage */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
          {visibleTabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? `bg-gradient-to-r ${config.gradient} text-white`
                  : 'bg-[var(--muted-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-2">
        {/* Loading State */}
        {loading && activeTab !== 'Simulator' ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin h-8 w-8 text-[var(--accent-primary)]" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : (
          <>
            {/* Tab Content */}
            {activeTab === 'Overview' && renderOverview()}
          
          {activeTab === 'Groups' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.groups.length > 0 ? (
                data.groups.map(group => renderGroupsTable(group))
              ) : (
                <div className="col-span-2 text-center py-12">
                  <p className="text-[var(--text-tertiary)]">Group stage data not available</p>
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'Knockout' && renderKnockoutBracket()}

          {activeTab === 'Challenge' && (
            <BracketChallengeBoard
              tournamentId={tournamentId}
              tournamentName={tournamentName}
              season={selectedSeason}
              rounds={bracketRounds}
              simulationData={challengeSimulationData || undefined}
            />
          )}

          {activeTab === 'Top Scorers' && (
            <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
              <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Top Scorers</h2>
              </div>
              {data.topScorers && data.topScorers.length > 0 ? (
                <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                  {data.topScorers.map((scorer) => (
                    <div key={scorer.name} className="flex items-center justify-between p-4 hover:bg-[var(--muted-bg)]">
                      <div className="flex items-center gap-4">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                          scorer.rank <= 3 ? 'bg-amber-500 text-white' : 'bg-[var(--muted-bg)] text-[var(--text-secondary)]'
                        }`}>
                          {scorer.rank}
                        </span>
                        <div>
                          <p className="font-medium text-[var(--text-primary)]">{scorer.name}</p>
                          <p className="text-sm text-[var(--text-tertiary)]">{scorer.team}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-[var(--accent-primary)]">{scorer.goals}</p>
                        <p className="text-xs text-[var(--text-tertiary)]">{scorer.assists} assists</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <span className="text-3xl mb-2 block">⚽</span>
                  <p className="text-[var(--text-tertiary)]">Top scorers data is being loaded...</p>
                  <p className="text-sm text-[var(--text-tertiary)] mt-1">Check back later for the latest statistics</p>
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'Fixtures' && (
            <MatchCalendar leagueId={config.espnId} leagueName={tournamentName} />
          )}
          
          {activeTab === 'Simulator' && (
            <div className="space-y-6">
              <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] p-6">
                <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-[var(--text-primary)]">Tournament Simulation</h3>
                    <p className="text-sm text-[var(--text-secondary)]">
                      {tournamentId === 'champions_league'
                        ? 'Monte Carlo projection from the current semi-final bracket'
                        : 'Monte Carlo simulation using team standings and goal difference'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <select
                      value={numSimulations}
                      onChange={(e) => setNumSimulations(parseInt(e.target.value))}
                      className="px-4 py-2 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                    >
                      {SIMULATION_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                      </select>
                    <button
                      onClick={runTournamentSimulation}
                      disabled={runningSimulation || (tournamentId !== 'champions_league' && data.groups.length === 0)}
                      className="px-6 py-3 rounded-xl font-semibold text-[#041320] bg-gradient-to-r from-[var(--accent-ai-light)] to-[var(--accent-ai)] hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-cyan-500/25 flex items-center gap-2"
                    >
                      {runningSimulation ? (
                        <>
                          <div className="w-5 h-5 border-2 border-[#041320] border-t-transparent rounded-full animate-spin" />
                          <span>Simulating...</span>
                        </>
                      ) : (
                        <span>Run Simulation</span>
                      )}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 border-t border-[var(--border-color)] pt-5 lg:grid-cols-[1fr_1fr_0.8fr]">
                  <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                      Focus team
                    </label>
                    <select
                      value={scenarioFocusTeam}
                      onChange={(e) => setScenarioFocusTeam(e.target.value)}
                      disabled={tournamentId === 'champions_league' || simulationTeamOptions.length === 0}
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {tournamentId === 'champions_league' ? (
                        <option>Current semifinal field</option>
                      ) : simulationTeamOptions.length > 0 ? (
                        simulationTeamOptions.map((team) => (
                          <option key={team} value={team}>{team}</option>
                        ))
                      ) : (
                        <option>Provider teams unavailable</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                      Scenario
                    </p>
                    <div className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] p-1">
                      {SCENARIO_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setScenarioMode(option.value)}
                          disabled={tournamentId === 'champions_league'}
                          title={option.detail}
                          className={`rounded-md px-2 py-1.5 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            scenarioMode === option.value
                              ? 'bg-[var(--accent-primary)] text-[#04120a]'
                              : 'text-[var(--text-secondary)] hover:bg-[var(--card-hover)]'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                      Volatility
                    </label>
                    <select
                      value={volatilityMode}
                      onChange={(e) => setVolatilityMode(e.target.value as VolatilityMode)}
                      disabled={tournamentId === 'champions_league'}
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {VOLATILITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Scenario note</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                    {tournamentId === 'champions_league'
                      ? 'Champions League simulation is anchored to the current semifinal bracket returned by the knockout API; scenario controls remain baseline-only for that live bracket.'
                      : `${SCENARIO_OPTIONS.find(option => option.value === scenarioMode)?.detail || 'Baseline scenario'} ${VOLATILITY_OPTIONS.find(option => option.value === volatilityMode)?.detail || ''}`}
                  </p>
                </div>
              </div>

              {savedScenarioCards.length > 0 && (
                <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
                  <div className="border-b border-[var(--border-color)] p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Saved Scenario Cards</p>
                        <h3 className="text-lg font-bold text-[var(--text-primary)]">Compare saved paths</h3>
                      </div>
                      <span className="text-xs text-[var(--text-secondary)]">{savedScenarioCards.length} saved</span>
                    </div>
                  </div>
                  {scenarioShareMessage && (
                    <div className="border-b border-[var(--border-color)] px-4 py-3 text-xs text-emerald-300">
                      {scenarioShareMessage}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                    {savedScenarioCards.map((card) => (
                      <div key={card.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-[var(--text-primary)]">{card.winner}</p>
                            <p className="mt-1 text-xs text-amber-400">{(card.winnerProbability * 100).toFixed(1)}% title probability</p>
                          </div>
                          <button
                            onClick={() => removeScenarioCard(card.id)}
                            className="rounded-md border border-[var(--border-color)] px-2 py-1 text-[10px] font-bold text-[var(--text-tertiary)] hover:border-red-400 hover:text-red-400"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="mt-3 space-y-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                          <p>{scenarioLabel(card.mode)} · {card.focusTeam}</p>
                          <p>{volatilityLabel(card.volatility)} · {card.nSimulations.toLocaleString()} runs · {card.season}</p>
                        </div>
                        <div className="mt-3 space-y-1">
                          {card.topContenders.map((team) => (
                            <div key={team.team} className="flex items-center justify-between gap-3 text-[11px]">
                              <span className="truncate text-[var(--text-secondary)]">{team.team}</span>
                              <span className="font-bold text-[var(--text-primary)]">{(team.probability * 100).toFixed(1)}%</span>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => copyScenarioCard(card)}
                          className="mt-4 rounded-lg border border-[var(--border-color)] px-3 py-2 text-[11px] font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--accent-primary)]"
                        >
                          Copy JSON
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Simulation Results - Full probability table */}
              {simulationResults && (
                <div className="space-y-6 animate-fade-in">
                  {/* Summary Card */}
                  <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
                    <div className="p-6 bg-gradient-to-r from-[var(--accent-ai)]/18 to-[var(--accent-primary)]/16 border-b border-[var(--border-color)]">
                      <div className="flex items-center justify-between flex-wrap gap-4">
                        <div>
                          <h3 className="text-2xl font-bold text-[var(--text-primary)]">{simulationResults.tournament_name}</h3>
                          <p className="text-[var(--text-secondary)]">
                            {simulationResults.n_simulations.toLocaleString()} simulations completed
                          </p>
                          {simulationResults.scenario && (
                            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                              Scenario: {scenarioLabel(simulationResults.scenario.mode)} · {simulationResults.scenario.focusTeam} · {volatilityLabel(simulationResults.scenario.volatility)}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-[var(--text-secondary)]">Most Likely Winner</p>
                          <p className="text-xl font-bold text-amber-400">{simulationResults.most_likely_winner}</p>
                          <p className="text-sm text-amber-400/80">{(simulationResults.winner_probability * 100).toFixed(1)}% probability</p>
                          <button
                            onClick={saveScenarioCard}
                            className="mt-3 rounded-lg border border-amber-400/40 px-3 py-2 text-xs font-bold text-amber-400 transition-colors hover:bg-amber-400/10"
                          >
                            Save Scenario
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Key Insights */}
                    <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                        <p className="text-sm text-[var(--text-secondary)] mb-2">Title Contenders</p>
                        <div className="space-y-1">
                          {simulationResults.teams
                            .filter(t => t.win_probability > 0.01)
                            .slice(0, 4)
                            .map((team) => (
                              <div key={team.team_name} className="flex justify-between text-sm">
                                <span className="text-[var(--text-primary)]">{team.team_name}</span>
                                <span className="text-amber-400">{(team.win_probability * 100).toFixed(1)}%</span>
                              </div>
                            ))}
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                        <p className="text-sm text-[var(--text-secondary)] mb-2">Finalists</p>
                        <div className="space-y-1">
                          {simulationResults.teams
                            .sort((a, b) => b.final_probability - a.final_probability)
                            .slice(0, 4)
                            .map((team) => (
                              <div key={team.team_name} className="flex justify-between text-sm">
                                <span className="text-[var(--text-primary)]">{team.team_name}</span>
                                <span className="text-blue-400">{(team.final_probability * 100).toFixed(0)}%</span>
                              </div>
                            ))}
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                        <p className="text-sm text-[var(--text-secondary)] mb-2">Semi-Finalists</p>
                        <div className="space-y-1">
                          {simulationResults.teams
                            .sort((a, b) => b.semi_final_probability - a.semi_final_probability)
                            .slice(0, 4)
                            .map((team) => (
                              <div key={team.team_name} className="flex justify-between text-sm">
                                <span className="text-[var(--text-primary)]">{team.team_name}</span>
                                <span className="text-emerald-400">{(team.semi_final_probability * 100).toFixed(0)}%</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Full Standings Table */}
                  <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
                    <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
                      <h3 className="font-semibold text-[var(--text-primary)]">Team Probabilities</h3>
                      <span className="text-sm text-[var(--text-secondary)]">
                        {simulationResults.teams.length} teams analyzed
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="text-xs text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
                            <th className="text-left py-3 px-4">Rank</th>
                            <th className="text-left py-3 px-4">Team</th>
                            <th className="text-center py-3 px-4">{tournamentId === 'champions_league' ? 'Stage' : 'Current Pts'}</th>
                            <th className="text-center py-3 px-4">Win %</th>
                            <th className="text-center py-3 px-4">Final %</th>
                            <th className="text-center py-3 px-4">Semi %</th>
                            <th className="text-center py-3 px-4">Quarter %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {simulationResults.teams.map((team, idx) => (
                            <tr
                              key={team.team_name}
                              className={`border-b border-[var(--border-color)] hover:bg-[var(--background-secondary)] transition-colors ${
                                idx < 1 ? 'border-l-2 border-l-amber-500' : 
                                idx < 4 ? 'border-l-2 border-l-emerald-500' : ''
                              }`}
                            >
                              <td className="py-3 px-4 text-[var(--text-secondary)]">{idx + 1}</td>
                              <td className="py-3 px-4 text-[var(--text-primary)] font-medium">{team.team_name}</td>
                              <td className="py-3 px-4 text-center text-[var(--text-secondary)]">{tournamentId === 'champions_league' ? 'SF' : team.current_points}</td>
                              <td className="py-3 px-4 text-center">
                                {team.win_probability > 0.001 ? (
                                  <span className="text-amber-400 font-semibold">{(team.win_probability * 100).toFixed(1)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.final_probability > 0.01 ? (
                                  <span className="text-blue-400">{(team.final_probability * 100).toFixed(0)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.semi_final_probability > 0.01 ? (
                                  <span className="text-emerald-400">{(team.semi_final_probability * 100).toFixed(0)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {team.quarter_final_probability > 0.01 ? (
                                  <span className="text-[var(--accent-ai)]">{(team.quarter_final_probability * 100).toFixed(0)}%</span>
                                ) : (
                                  <span className="text-[var(--text-tertiary)]">-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Legend */}
                    <div className="p-4 flex gap-6 text-xs text-[var(--text-tertiary)] border-t border-[var(--border-color)]">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-amber-500 rounded" />
                        <span>Winner</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-emerald-500 rounded" />
                        <span>Top Contenders</span>
                      </div>
                    </div>
                  </div>

                  {/* Disclaimer */}
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <p className="text-sm text-amber-800 dark:text-amber-200/80 text-center">
                      <span className="font-semibold">Note:</span> Predictions are based on Monte Carlo simulations using current standings, bracket state, and team ratings.
                      Actual results may vary significantly due to injuries, transfers, and unpredictable events.
                    </p>
                  </div>
                </div>
              )}

              {/* Initial state - no simulation run yet */}
              {!simulationResults && !runningSimulation && (
                <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] p-8 text-center">
                  <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">Tournament Simulation</h3>
                  <p className="text-[var(--text-secondary)] max-w-md mx-auto">
                    Run a Monte Carlo simulation to project the tournament winner and remaining knockout path.
                  </p>
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'News' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.news.length > 0 ? (
                data.news.filter(item => item.link).map((item, idx) => (
                  <a 
                    key={idx} 
                    href={item.link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden transition-all duration-300 group hover:scale-[1.02] hover:shadow-xl hover:border-[var(--accent-primary)]" 
                    style={{ borderColor: 'var(--border-color)' }}
                  >
                    {item.image && (
                      <div className="aspect-video w-full overflow-hidden">
                        <img 
                          src={item.image} 
                          alt={item.headline} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                        />
                      </div>
                    )}
                    <div className="p-4">
                      <h3 className="font-semibold text-[var(--text-primary)] mb-2 group-hover:text-[var(--accent-primary)] transition-colors line-clamp-2">
                        {item.headline}
                      </h3>
                      <p className="text-sm text-[var(--text-secondary)] line-clamp-2">{item.description}</p>
                      {item.published && (
                        <p className="text-xs text-[var(--text-tertiary)] mt-2">
                          {formatDistanceToNow(new Date(item.published), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                  </a>
                ))
              ) : (
                <div className="bg-[var(--card-bg)] border rounded-2xl p-8 text-center col-span-2" style={{ borderColor: 'var(--border-color)' }}>
                  <p className="text-[var(--text-tertiary)]">No news available</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
      </div>
    </div>
  )
}
