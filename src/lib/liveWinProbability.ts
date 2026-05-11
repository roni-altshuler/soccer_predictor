export interface ThreeWayProbabilities {
  home_win: number
  draw: number
  away_win: number
}

export interface LiveMatchStats {
  possession: [number, number]
  shots: [number, number]
  shotsOnTarget: [number, number]
  corners: [number, number]
  fouls: [number, number]
}

export interface LiveWinProbabilityInput {
  status: string
  minute?: number
  homeScore: number | null
  awayScore: number | null
  stats?: LiveMatchStats
  preMatch?: ThreeWayProbabilities | null
}

export interface LiveWinProbabilityResult {
  available: boolean
  reason?: string
  method: 'score_clock_stats_heuristic'
  calibrated: false
  minute?: number
  probabilities?: ThreeWayProbabilities
  confidence: 'low' | 'medium'
  inputs: string[]
  note: string
}

const EPSILON = 0.000001

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits)
  const exps = logits.map((value) => Math.exp(value - max))
  const total = exps.reduce((sum, value) => sum + value, 0)
  return exps.map((value) => value / total)
}

function logit(probability: number): number {
  return Math.log(clamp(probability, EPSILON, 1 - EPSILON))
}

function hasMeaningfulStats(stats?: LiveMatchStats): boolean {
  if (!stats) return false
  const activity =
    stats.shots[0] +
    stats.shots[1] +
    stats.shotsOnTarget[0] +
    stats.shotsOnTarget[1] +
    stats.corners[0] +
    stats.corners[1]
  return activity > 0
}

export function computeLiveWinProbability(input: LiveWinProbabilityInput): LiveWinProbabilityResult {
  const status = input.status.toLowerCase()
  const minute = input.minute

  if (status !== 'live') {
    return {
      available: false,
      reason: 'match_not_live',
      method: 'score_clock_stats_heuristic',
      calibrated: false,
      confidence: 'low',
      inputs: [],
      note: 'Live win probability is only generated for in-progress matches.',
    }
  }

  if (typeof minute !== 'number' || !Number.isFinite(minute) || minute <= 0) {
    return {
      available: false,
      reason: 'missing_clock',
      method: 'score_clock_stats_heuristic',
      calibrated: false,
      confidence: 'low',
      inputs: [],
      note: 'Live win probability needs a valid match clock.',
    }
  }

  if (typeof input.homeScore !== 'number' || typeof input.awayScore !== 'number') {
    return {
      available: false,
      reason: 'missing_score',
      method: 'score_clock_stats_heuristic',
      calibrated: false,
      confidence: 'low',
      inputs: [],
      note: 'Live win probability needs the current score.',
    }
  }

  if (!input.preMatch) {
    return {
      available: false,
      reason: 'missing_prematch_prediction',
      method: 'score_clock_stats_heuristic',
      calibrated: false,
      confidence: 'low',
      inputs: [],
      note: 'Live win probability needs a pre-match model probability as its prior.',
    }
  }

  const statsAvailable = hasMeaningfulStats(input.stats)
  if (!statsAvailable && minute >= 15) {
    return {
      available: false,
      reason: 'missing_live_stats',
      method: 'score_clock_stats_heuristic',
      calibrated: false,
      confidence: 'low',
      inputs: ['pre_match_model', 'score', 'clock'],
      note: 'Provider live stats are incomplete, so the app withholds a live probability instead of fabricating momentum.',
    }
  }

  const elapsed = clamp(minute, 1, 90) / 90
  const scoreDiff = input.homeScore - input.awayScore
  const base = [
    logit(input.preMatch.home_win),
    logit(input.preMatch.draw),
    logit(input.preMatch.away_win),
  ]

  const scoreWeight = 1.15 + elapsed * 3.2
  base[0] += scoreDiff * scoreWeight
  base[2] -= scoreDiff * scoreWeight
  base[1] -= Math.abs(scoreDiff) * (0.65 + elapsed * 0.7)
  if (scoreDiff === 0) {
    base[1] += elapsed * 0.55
  }

  const inputs = ['pre_match_model', 'score', 'clock']

  if (input.stats && statsAvailable) {
    const possessionDiff = ((input.stats.possession[0] || 50) - (input.stats.possession[1] || 50)) / 100
    const shotsDiff = (input.stats.shots[0] || 0) - (input.stats.shots[1] || 0)
    const sotDiff = (input.stats.shotsOnTarget[0] || 0) - (input.stats.shotsOnTarget[1] || 0)
    const cornersDiff = (input.stats.corners[0] || 0) - (input.stats.corners[1] || 0)
    const momentum =
      possessionDiff * 0.3 +
      shotsDiff * 0.045 +
      sotDiff * 0.14 +
      cornersDiff * 0.035
    const momentumWeight = 1.05 - elapsed * 0.45
    base[0] += momentum * momentumWeight
    base[2] -= momentum * momentumWeight
    inputs.push('provider_live_stats')
  }

  const [home, draw, away] = softmax(base)
  const confidence = statsAvailable && minute >= 20 ? 'medium' : 'low'

  return {
    available: true,
    method: 'score_clock_stats_heuristic',
    calibrated: false,
    minute,
    probabilities: {
      home_win: home,
      draw,
      away_win: away,
    },
    confidence,
    inputs,
    note: 'Live probabilities are transparent in-match estimates, not betting guarantees.',
  }
}
