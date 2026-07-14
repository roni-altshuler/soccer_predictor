/**
 * Knockout tournament simulation — pure TypeScript port of
 * backend/services/simulation/knockout_simulator.py, restructured to the
 * same contract as leagueMonteCarlo.ts:
 *
 *   - No side effects, no global state, no I/O.
 *   - Seeded xorshift32 PRNG reset per call → identical inputs MUST
 *     return identical outputs.
 *
 * Math summary (mirrors the Python service):
 *   1. Single-match win expectancy is logistic in the rating difference:
 *        P(A beats B) = 1 / (1 + 10^(-(eloA − eloB + homeBonus) / 400))
 *      where homeBonus = ±30 rating points (0 at neutral venues).
 *   2. Goals per match are Poisson draws around a calibrated rating → xG
 *      coupling (GOALS_SUPREMACY_PER_ELO = 0.0048, avg 1.35 goals/side,
 *      +0.3 home xG unless neutral) — see backend elo_goals.py.
 *   3. Club rounds before the final are two-legged (each side hosts one
 *      leg); aggregate ties resolve via the neutral win expectancy.
 *      Finals — and every round of a national tournament — are single
 *      matches at neutral venues; draws resolve the same way.
 *   4. Brackets of 4 / 8 / 16 are supported. Fields between sizes are
 *      padded with byes at the end of the input order. Champions-League
 *      style 16-team fields with valid group data (8 winners + 8
 *      runners-up) get a fresh constrained R16 draw every simulation
 *      (winners v runners-up, same group / same country avoided); other
 *      club fields redraw every round; national brackets pair by input
 *      order and never redraw.
 */

export interface KnockoutTeamInput {
  name: string
  elo?: number
  /** Group letter from the group stage ("A"…"H") — drives the R16 draw. */
  group?: string
  /** 1 = group winner, 2 = runner-up. */
  group_position?: number
  country?: string
}

export type KnockoutRoundKey =
  | 'quarter_finals'
  | 'semi_finals'
  | 'final'
  | 'winner'

export interface KnockoutTeamOutcome {
  name: string
  elo: number
  /**
   * P(team reaches round), keyed by round. Only rounds beyond the
   * team's starting round are present; values are monotonically
   * non-increasing along the rounds order.
   */
  reach: Partial<Record<KnockoutRoundKey, number>>
}

export interface KnockoutSimulationResult {
  n_simulations: number
  bracket_size: number
  /** Rounds reported, in play order, ending with 'winner'. */
  rounds: KnockoutRoundKey[]
  /** Sorted by winner probability descending. */
  teams: KnockoutTeamOutcome[]
  most_likely_winner: string
  winner_probability: number
}

export interface KnockoutSimulationOptions {
  /** club = two-legged ties + neutral final; national = all single, all neutral. */
  kind: 'club' | 'national'
  nSimulations: number
}

interface SimTeam {
  index: number
  name: string
  elo: number
  group: string
  groupPosition: number
  country: string
}

/** Rating advantage (in Elo points) for hosting a leg — 0.3 × 100, as Python. */
const HOME_ELO_BONUS = 30
/** Baseline goals per side per match. */
const AVG_GOALS = 1.35
/** Home-side xG bump at a non-neutral venue. */
const HOME_XG_ADV = 0.3
/** Calibrated goals of supremacy per rating point (backend elo_goals.py). */
const GOALS_SUPREMACY_PER_ELO = 0.0048
const HOME_XG_CLAMP: [number, number] = [0.5, 3.5]
const AWAY_XG_CLAMP: [number, number] = [0.3, 3.0]

const MAX_BRACKET = 16
const MIN_TEAMS = 2

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Logistic win expectancy from a rating difference. */
function winProbability(
  eloA: number,
  eloB: number,
  venue: 'home' | 'away' | 'neutral',
): number {
  const bonus = venue === 'home' ? HOME_ELO_BONUS : venue === 'away' ? -HOME_ELO_BONUS : 0
  return 1 / (1 + Math.pow(10, -(eloA - eloB + bonus) / 400))
}

/** Calibrated rating → (home xG, away xG); neutral drops the home term. */
function expectedGoals(homeElo: number, awayElo: number, neutral: boolean): [number, number] {
  const c = (GOALS_SUPREMACY_PER_ELO * 400) / (2 * AVG_GOALS)
  const z = (homeElo - awayElo) / 400
  const homeXg = AVG_GOALS * (1 + c * z) + (neutral ? 0 : HOME_XG_ADV)
  const awayXg = AVG_GOALS * (1 - c * z)
  return [
    clamp(homeXg, HOME_XG_CLAMP[0], HOME_XG_CLAMP[1]),
    clamp(awayXg, AWAY_XG_CLAMP[0], AWAY_XG_CLAMP[1]),
  ]
}

/** Round key for a field of `size` teams about to play. */
function roundKeyForFieldSize(size: number): KnockoutRoundKey | null {
  switch (size) {
    case 8:
      return 'quarter_finals'
    case 4:
      return 'semi_finals'
    case 2:
      return 'final'
    default:
      return null
  }
}

/**
 * Run the knockout Monte Carlo. Pure — same inputs → same outputs.
 *
 * @throws Error when fewer than 2 teams are supplied.
 */
export function runKnockoutSimulation(
  inputTeams: KnockoutTeamInput[],
  options: KnockoutSimulationOptions,
): KnockoutSimulationResult {
  const roster = inputTeams.slice(0, MAX_BRACKET)
  if (roster.length < MIN_TEAMS) {
    throw new Error(`Knockout simulation requires at least ${MIN_TEAMS} teams`)
  }

  const nSimulations = Math.max(1, Math.floor(options.nSimulations))

  const teams: SimTeam[] = roster.map((t, index) => ({
    index,
    name: t.name,
    elo: Number.isFinite(t.elo) ? (t.elo as number) : 1500,
    group: t.group ?? '',
    groupPosition: t.group_position ?? 1,
    country: t.country ?? '',
  }))

  const bracketSize =
    teams.length <= 2 ? 2 : teams.length <= 4 ? 4 : teams.length <= 8 ? 8 : 16

  // Rounds every team can still newly reach (beyond its starting round).
  const rounds: KnockoutRoundKey[] = []
  if (bracketSize >= 16) rounds.push('quarter_finals')
  if (bracketSize >= 8) rounds.push('semi_finals')
  if (bracketSize >= 4) rounds.push('final')
  rounds.push('winner')

  // Seeded xorshift32 — reset per call so identical inputs → identical outputs.
  let seed = 42
  function rand(): number {
    seed ^= seed << 13
    seed ^= seed >> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }

  function poisson(lambda: number): number {
    const limit = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k++
      p *= rand()
    } while (p > limit)
    return k - 1
  }

  function simulateMatch(home: SimTeam, away: SimTeam, neutral: boolean): [number, number] {
    const [homeXg, awayXg] = expectedGoals(home.elo, away.elo, neutral)
    return [poisson(homeXg), poisson(awayXg)]
  }

  /** Two-legged tie: a hosts leg 1, b hosts leg 2; aggregate; neutral tiebreak. */
  function simulateTwoLegged(a: SimTeam, b: SimTeam): SimTeam {
    const [leg1Home, leg1Away] = simulateMatch(a, b, false)
    const [leg2Home, leg2Away] = simulateMatch(b, a, false)
    const totalA = leg1Home + leg2Away
    const totalB = leg1Away + leg2Home
    if (totalA > totalB) return a
    if (totalB > totalA) return b
    return rand() < winProbability(a.elo, b.elo, 'neutral') ? a : b
  }

  /** Single neutral-venue match; draws resolve via the neutral expectancy. */
  function simulateSingleNeutral(a: SimTeam, b: SimTeam): SimTeam {
    const [goalsA, goalsB] = simulateMatch(a, b, true)
    if (goalsA > goalsB) return a
    if (goalsB > goalsA) return b
    return rand() < winProbability(a.elo, b.elo, 'neutral') ? a : b
  }

  function shuffleInPlace<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
  }

  // Champions-League style constrained R16 draw is only meaningful for a
  // full 16-team field split into 8 group winners and 8 runners-up.
  const groupWinners = teams.filter((t) => t.groupPosition === 1)
  const groupRunners = teams.filter((t) => t.groupPosition === 2)
  const hasGroupDraw =
    options.kind === 'club' &&
    teams.length === 16 &&
    groupWinners.length === 8 &&
    groupRunners.length === 8

  /**
   * Fresh constrained R16 field: winners v runners-up, avoiding same group
   * and same country where the greedy pass allows; any leftovers pair up
   * unconstrained so every simulation always yields 8 complete ties.
   */
  function drawGroupStageField(): (SimTeam | null)[] {
    const winners = [...groupWinners]
    const runners = [...groupRunners]
    shuffleInPlace(winners)
    shuffleInPlace(runners)

    const field: (SimTeam | null)[] = []
    const usedRunners = new Set<number>()
    const unmatchedWinners: SimTeam[] = []

    for (const winner of winners) {
      let paired = false
      for (const runner of runners) {
        if (usedRunners.has(runner.index)) continue
        if (runner.group !== '' && runner.group === winner.group) continue
        if (runner.country !== '' && runner.country === winner.country) continue
        field.push(winner, runner)
        usedRunners.add(runner.index)
        paired = true
        break
      }
      if (!paired) unmatchedWinners.push(winner)
    }
    const leftoverRunners = runners.filter((r) => !usedRunners.has(r.index))
    for (let i = 0; i < unmatchedWinners.length; i++) {
      field.push(unmatchedWinners[i], leftoverRunners[i] ?? null)
    }
    return field
  }

  // Reach tallies per team per round (indexed as in `rounds`).
  const reachCounts: number[][] = teams.map(() => new Array(rounds.length).fill(0))
  const roundIndex = new Map<KnockoutRoundKey, number>(rounds.map((r, i) => [r, i]))

  for (let sim = 0; sim < nSimulations; sim++) {
    // Byes (null) pad the field to the bracket size at the end of the
    // input order; a team drawn against a bye advances unopposed.
    let field: (SimTeam | null)[]
    if (hasGroupDraw) {
      field = drawGroupStageField()
    } else {
      field = [...teams]
      while (field.length < bracketSize) field.push(null)
    }

    while (field.length > 1) {
      // Club tournaments without a fixed group draw redraw every round.
      if (options.kind === 'club' && !hasGroupDraw) shuffleInPlace(field)

      const isFinal = field.length === 2
      const next: (SimTeam | null)[] = []
      for (let i = 0; i < field.length; i += 2) {
        const a = field[i]
        const b = field[i + 1] ?? null
        let winner: SimTeam | null
        if (a && b) {
          if (options.kind === 'national' || isFinal) {
            winner = simulateSingleNeutral(a, b)
          } else {
            winner = simulateTwoLegged(a, b)
          }
        } else {
          winner = a ?? b
        }
        next.push(winner)
      }

      const reachedKey =
        next.length === 1 ? 'winner' : roundKeyForFieldSize(next.length)
      if (reachedKey) {
        const idx = roundIndex.get(reachedKey)
        if (idx !== undefined) {
          for (const team of next) {
            if (team) reachCounts[team.index][idx]++
          }
        }
      }
      field = next
    }
  }

  const outcomes: KnockoutTeamOutcome[] = teams.map((team) => {
    const reach: Partial<Record<KnockoutRoundKey, number>> = {}
    rounds.forEach((round, i) => {
      reach[round] = parseFloat((reachCounts[team.index][i] / nSimulations).toFixed(4))
    })
    return { name: team.name, elo: team.elo, reach }
  })

  outcomes.sort((a, b) => {
    if ((b.reach.winner ?? 0) !== (a.reach.winner ?? 0)) {
      return (b.reach.winner ?? 0) - (a.reach.winner ?? 0)
    }
    if ((b.reach.final ?? 0) !== (a.reach.final ?? 0)) {
      return (b.reach.final ?? 0) - (a.reach.final ?? 0)
    }
    return a.name.localeCompare(b.name)
  })

  return {
    n_simulations: nSimulations,
    bracket_size: bracketSize,
    rounds,
    teams: outcomes,
    most_likely_winner: outcomes[0]?.name ?? '',
    winner_probability: outcomes[0]?.reach.winner ?? 0,
  }
}
