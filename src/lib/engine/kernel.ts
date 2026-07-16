import { getEngineParams, type EngineParams, type EngineWeights, type MatchAnchor } from './params'

/**
 * Match Engine kernel — TypeScript port of the minute-conditioned,
 * DC-nested goal-intensity process (`backend/services/prediction/
 * match_engine.py`), executing the committed weights from
 * `backend/data/engine/kernel.json`.
 *
 * `simulateFrom(anchor, state)` runs the exact forward dynamic program over
 * the score lattice from an arbitrary mid-match state: per remaining minute
 * bin, each side scores with intensity `λ · f(state)/90` where the shared
 * residual network `f` sees only match state (minute bucket, score/red-card
 * differences, home flag, gender flag) — team identity enters ONLY through
 * the anchor. The red-card difference is held fixed for the remainder (v0
 * covariate treatment). Parity with the Python engine is pinned to 1e-6 per
 * probability by the committed fixture in `__tests__/fixtures/parity.json`.
 *
 * Server-only transitively (weights come from the params loader) — call it
 * from Node API routes, never from client components.
 */

export type MatchState = {
  minute: number
  homeGoals: number
  awayGoals: number
  homeReds: number
  awayReds: number
}

export type OutcomeDistribution = {
  pHome: number
  pDraw: number
  pAway: number
  expHomeGoals: number
  expAwayGoals: number
  topScorelines: Array<{ home: number; away: number; p: number }>
}

// DP constants this port implements — the artifact's config must agree.
const N_MINUTES = 90
const MAX_GOALS = 10
const MAX_INCREMENT = 6
const SCORE_DIFF_CLIP = 3
const RED_DIFF_CLIP = 2
const LOG_MULT_CLAMP = 3.0
const N_MINUTE_BUCKETS = N_MINUTES / 5 // 18
const N_FEATURES =
  N_MINUTE_BUCKETS + 1 + (2 * SCORE_DIFF_CLIP + 1) + (2 * RED_DIFF_CLIP + 1) + 1 + 1 // 33
const SIZE = MAX_GOALS + 1
const N_DIFF = 2 * MAX_GOALS + 1
const TOP_SCORELINES = 5

function assertCompatible(params: EngineParams): void {
  const c = params.config
  const ok =
    c.n_features === N_FEATURES &&
    c.n_minutes === N_MINUTES &&
    c.max_goals === MAX_GOALS &&
    c.max_increment === MAX_INCREMENT &&
    c.score_diff_clip === SCORE_DIFF_CLIP &&
    c.red_diff_clip === RED_DIFF_CLIP &&
    c.log_mult_clamp === LOG_MULT_CLAMP
  if (!ok) {
    throw new Error('engine kernel artifact does not match this port version')
  }
}

// ---------------------------------------------------------------------------
// Residual network forward pass (float64 — pinned to Python by parity tests)
// ---------------------------------------------------------------------------
function featureVector(
  minuteBin: number,
  scoreDiff: number,
  redDiff: number,
  isHome: number,
  genderF: number
): Float64Array {
  const x = new Float64Array(N_FEATURES)
  const b = Math.min(Math.max(minuteBin, 0), N_MINUTES - 1)
  x[Math.floor(b / 5)] = 1
  let col = N_MINUTE_BUCKETS
  // Added-time-folded bins: minute 45 (bin 44) and minute 90 (bin 89).
  x[col] = minuteBin === 44 || minuteBin === N_MINUTES - 1 ? 1 : 0
  col += 1
  const sd = Math.max(-SCORE_DIFF_CLIP, Math.min(SCORE_DIFF_CLIP, scoreDiff))
  x[col + sd + SCORE_DIFF_CLIP] = 1
  col += 2 * SCORE_DIFF_CLIP + 1
  const rd = Math.max(-RED_DIFF_CLIP, Math.min(RED_DIFF_CLIP, redDiff))
  x[col + rd + RED_DIFF_CLIP] = 1
  col += 2 * RED_DIFF_CLIP + 1
  x[col] = isHome
  x[col + 1] = genderF
  return x
}

function forward(weights: EngineWeights, x: Float64Array): number {
  const { w0, b0, w1, b1, w2, b2 } = weights
  const hidden = b0.length
  const h1 = new Float64Array(hidden)
  for (let i = 0; i < hidden; i++) {
    let sum = b0[i]
    const row = w0[i]
    for (let j = 0; j < N_FEATURES; j++) sum += row[j] * x[j]
    h1[i] = sum > 0 ? sum : 0
  }
  const h2 = new Float64Array(hidden)
  for (let i = 0; i < hidden; i++) {
    let sum = b1[i]
    const row = w1[i]
    for (let j = 0; j < hidden; j++) sum += row[j] * h1[j]
    h2[i] = sum > 0 ? sum : 0
  }
  let r = b2
  for (let j = 0; j < hidden; j++) r += w2[j] * h2[j]
  return Math.max(-LOG_MULT_CLAMP, Math.min(LOG_MULT_CLAMP, r))
}

// ---------------------------------------------------------------------------
// Multiplier tables — f/g over (minute bin, home score diff, side), cached
// per loaded artifact + (gender, red diff) since the network is state-only
// ---------------------------------------------------------------------------
const tableCaches = new WeakMap<EngineParams, Map<string, Float64Array>>()

function multiplierTable(params: EngineParams, genderF: number, redDiffHome: number): Float64Array {
  let cache = tableCaches.get(params)
  if (!cache) {
    cache = new Map()
    tableCaches.set(params, cache)
  }
  const key = `${genderF}:${redDiffHome}`
  const hit = cache.get(key)
  if (hit) return hit
  // Layout: [minute][diff index][side] flattened; side 0 = home, 1 = away.
  const table = new Float64Array(N_MINUTES * N_DIFF * 2)
  for (let side = 0; side < 2; side++) {
    const isHome = side === 0 ? 1 : 0
    const sign = side === 0 ? 1 : -1
    for (let t = 0; t < N_MINUTES; t++) {
      for (let d = 0; d < N_DIFF; d++) {
        const diff = d - MAX_GOALS
        const x = featureVector(t, sign * diff, sign * redDiffHome, isHome, genderF)
        table[(t * N_DIFF + d) * 2 + side] = Math.exp(forward(params.weights, x))
      }
    }
  }
  cache.set(key, table)
  return table
}

// ---------------------------------------------------------------------------
// Exact forward DP over the score lattice
// ---------------------------------------------------------------------------
/**
 * Final-outcome distribution from a mid-match state. `state.minute` is the
 * number of minute bins already played (0 = kickoff, 45 = half time);
 * stoppage/extra-time minutes clamp onto the 90' state. Scores clamp onto
 * the 0..10 lattice; the red-card difference is held fixed for the
 * remainder of the match.
 */
export function simulateFrom(anchor: MatchAnchor, state: MatchState): OutcomeDistribution {
  const params = getEngineParams()
  if (!params) {
    throw new Error('engine kernel artifact is not available')
  }
  assertCompatible(params)

  const startMinute = Math.min(Math.max(Math.floor(state.minute), 0), N_MINUTES)
  const h0 = Math.min(Math.max(Math.floor(state.homeGoals), 0), MAX_GOALS)
  const a0 = Math.min(Math.max(Math.floor(state.awayGoals), 0), MAX_GOALS)
  const redDiffHome = Math.floor(state.homeReds) - Math.floor(state.awayReds)
  const genderF = anchor.gender === 'F' ? 1 : 0

  const table = multiplierTable(params, genderF, redDiffHome)
  const baseH = anchor.lambda / N_MINUTES
  const baseA = anchor.mu / N_MINUTES

  let prob = new Float64Array(SIZE * SIZE)
  prob[h0 * SIZE + a0] = 1
  const pmfH = new Float64Array(MAX_INCREMENT + 1)
  const pmfA = new Float64Array(MAX_INCREMENT + 1)

  for (let t = startMinute; t < N_MINUTES; t++) {
    const next = new Float64Array(SIZE * SIZE)
    for (let h = 0; h < SIZE; h++) {
      for (let a = 0; a < SIZE; a++) {
        const p = prob[h * SIZE + a]
        if (p === 0) continue
        const dIdx = h - a + MAX_GOALS
        const nuH = baseH * table[(t * N_DIFF + dIdx) * 2]
        const nuA = baseA * table[(t * N_DIFF + dIdx) * 2 + 1]
        pmfH[0] = Math.exp(-nuH)
        pmfA[0] = Math.exp(-nuA)
        for (let k = 1; k <= MAX_INCREMENT; k++) {
          pmfH[k] = (pmfH[k - 1] * nuH) / k
          pmfA[k] = (pmfA[k - 1] * nuA) / k
        }
        // Mass that would leave the lattice is dropped (truncated grid).
        for (let k = 0; k <= MAX_INCREMENT && h + k < SIZE; k++) {
          const ph = p * pmfH[k]
          for (let j = 0; j <= MAX_INCREMENT && a + j < SIZE; j++) {
            next[(h + k) * SIZE + (a + j)] += ph * pmfA[j]
          }
        }
      }
    }
    prob = next
  }

  // Dixon-Coles low-score dependence correction (a no-op on unreachable
  // cells mid-match), clip, renormalise.
  const { lambda, mu, rho } = anchor
  prob[0] *= 1 - lambda * mu * rho
  prob[1] *= 1 + lambda * rho
  prob[SIZE] *= 1 + mu * rho
  prob[SIZE + 1] *= 1 - rho
  let total = 0
  for (let i = 0; i < prob.length; i++) {
    if (prob[i] < 0) prob[i] = 0
    total += prob[i]
  }
  if (total > 0) {
    for (let i = 0; i < prob.length; i++) prob[i] /= total
  }

  let pHome = 0
  let pDraw = 0
  let pAway = 0
  let expHomeGoals = 0
  let expAwayGoals = 0
  const cells: Array<{ home: number; away: number; p: number }> = []
  for (let h = 0; h < SIZE; h++) {
    for (let a = 0; a < SIZE; a++) {
      const p = prob[h * SIZE + a]
      if (h > a) pHome += p
      else if (h === a) pDraw += p
      else pAway += p
      expHomeGoals += h * p
      expAwayGoals += a * p
      cells.push({ home: h, away: a, p })
    }
  }
  const s = pHome + pDraw + pAway
  if (s > 0) {
    pHome /= s
    pDraw /= s
    pAway /= s
  }
  cells.sort((x, y) => y.p - x.p || x.home - y.home || x.away - y.away)

  return {
    pHome,
    pDraw,
    pAway,
    expHomeGoals,
    expAwayGoals,
    topScorelines: cells.slice(0, TOP_SCORELINES),
  }
}
