import fs from 'fs'
import path from 'path'

/**
 * Match Engine kernel parameters — loader for the committed artifact
 * `backend/data/engine/kernel.json` (produced by
 * `python -m backend.scripts.export_engine_kernel`).
 *
 * Server-only (reads the filesystem): import from Node API routes, never
 * from client components — the same pattern as `src/lib/rarity.ts` and
 * `src/lib/match2vec.ts`. The artifact carries the residual network's exact
 * float32 weights, the DP configuration, and walk-forward per-match anchors
 * (`match_id → [λ, μ, ρ, gender]`), so the engine runs on Vercel where the
 * warehouse SQLite is absent.
 *
 * Honesty rule: a match without an exported anchor yields `null` — callers
 * render nothing, never a guess. Anchors are fitted only on strictly-prior
 * data (the same walk-forward machinery the committed gate diagnostics
 * were scored with).
 */

export type MatchAnchor = { lambda: number; mu: number; rho: number; gender: 'M' | 'F' }

export interface EngineWeights {
  w0: number[][]
  b0: number[]
  w1: number[][]
  b1: number[]
  w2: number[]
  b2: number
}

export interface EngineConfig {
  hidden: number
  version: string
  n_features: number
  n_minutes: number
  max_goals: number
  max_increment: number
  score_diff_clip: number
  red_diff_clip: number
  log_mult_clamp: number
  top_scorelines: number
}

export interface EngineParams {
  config: EngineConfig
  weights: EngineWeights
  generatedAt: string
}

interface KernelArtifact {
  schema: number
  generated_at: string
  config: EngineConfig
  weights: EngineWeights
  anchors: Record<string, number[]>
}

const KERNEL_FILE = path.join(process.cwd(), 'backend', 'data', 'engine', 'kernel.json')

// -- artifact loading (fs read + mtime-keyed cache, rarity.ts pattern) ------

interface CacheEntry {
  mtimeMs: number
  data: KernelArtifact | null
}

let kernelCache: CacheEntry | null = null

function loadKernel(): KernelArtifact | null {
  try {
    const stat = fs.statSync(KERNEL_FILE)
    if (kernelCache && kernelCache.mtimeMs === stat.mtimeMs) return kernelCache.data
    const parsed = JSON.parse(fs.readFileSync(KERNEL_FILE, 'utf-8')) as KernelArtifact
    kernelCache = { mtimeMs: stat.mtimeMs, data: parsed }
  } catch {
    kernelCache = { mtimeMs: -1, data: null }
  }
  return kernelCache.data
}

/**
 * The network weights + DP configuration, or null when the artifact is
 * missing. Consumed by `src/lib/engine/kernel.ts`; the returned object is
 * reference-stable across calls while the artifact file is unchanged, so
 * downstream caches may key on it.
 */
export function getEngineParams(): EngineParams | null {
  const artifact = loadKernel()
  if (!artifact || !artifact.weights || !artifact.config) return null
  return paramsView(artifact)
}

// One EngineParams view per loaded artifact object (stable identity).
const paramsViews = new WeakMap<KernelArtifact, EngineParams>()

function paramsView(artifact: KernelArtifact): EngineParams {
  let view = paramsViews.get(artifact)
  if (!view) {
    view = {
      config: artifact.config,
      weights: artifact.weights,
      generatedAt: artifact.generated_at,
    }
    paramsViews.set(artifact, view)
  }
  return view
}

/**
 * Walk-forward Dixon-Coles anchor for a warehouse match id, or null when
 * the match is not covered / its season had too little prior history for
 * an honest fit. Cross-source duplicates of a fixture are each anchored
 * under their own id, so ESPN event-page ids resolve directly.
 */
export function getMatchAnchor(warehouseMatchId: string): MatchAnchor | null {
  const artifact = loadKernel()
  const row = artifact?.anchors?.[warehouseMatchId]
  if (!row || row.length < 4) return null
  const [lambda, mu, rho, gender] = row
  if (!Number.isFinite(lambda) || !Number.isFinite(mu) || !Number.isFinite(rho)) {
    return null
  }
  return { lambda, mu, rho, gender: gender === 1 ? 'F' : 'M' }
}
