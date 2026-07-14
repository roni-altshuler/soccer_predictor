import fs from 'fs'
import path from 'path'

/**
 * Rarity Engine v1 — query layer over the committed exact-count artifacts.
 *
 * Server-only (reads the filesystem): import from Node API routes, never from
 * client components. The artifacts are produced by
 * `python -m backend.scripts.build_rarity` and committed under
 * `backend/data/rarity/` (the warehouse SQLite itself is gitignored and not
 * available on Vercel).
 *
 * Honesty rule (docs/VISION_2030.md §3.2): every number returned here is an
 * exact count of warehouse rows. Unseen states return `n: 0` — never an
 * error, never an estimate.
 */

export type RarityGender = 'M' | 'F'

export interface RarityCounts {
  n: number
  w: number
  d: number
  l: number
}

export interface RarityExample {
  match_id: string
  home: string
  away: string
  final_score: string
  date: string
  competition_id: string
  side: 'home' | 'away'
}

interface StateOutcomesArtifact {
  schema: number
  generated_at: string
  matches_covered: number
  states: Record<string, RarityCounts>
}

interface ExamplesArtifact {
  schema: number
  generated_at: string
  examples: Record<string, { w?: RarityExample[]; d?: RarityExample[] }>
}

export interface RarityQueryResult extends RarityCounts {
  key: string
  gender: RarityGender
  diff: number
  minute_bucket: number
  win_rate: number
  matches_covered: number
}

/** Below this sample size a rarity claim is too thin to surface publicly. */
export const RARITY_MIN_SAMPLE = 50

const DIFF_MIN = -3
const DIFF_MAX = 3
const BUCKET_MAX = 90

const RARITY_DIR = path.join(process.cwd(), 'backend', 'data', 'rarity')
const STATES_FILE = path.join(RARITY_DIR, 'state_outcomes.json')
const EXAMPLES_FILE = path.join(RARITY_DIR, 'examples.json')

/** Floor a raw minute onto the 5-minute state grid; 90+ (incl. ET) → 90. */
export function minuteBucket(minute: number): number {
  if (!Number.isFinite(minute) || minute <= 0) return 0
  return Math.min(BUCKET_MAX, Math.floor(minute / 5) * 5)
}

/** Clamp a score difference to the artifact's [-3, +3] key space. */
export function clampDiff(diff: number): number {
  if (!Number.isFinite(diff)) return 0
  return Math.max(DIFF_MIN, Math.min(DIFF_MAX, Math.trunc(diff)))
}

/** Canonical artifact key — must match backend/scripts/build_rarity.py. */
export function rarityKey(gender: RarityGender, diff: number, minute: number): string {
  return `${gender}:${clampDiff(diff)}:${minuteBucket(minute)}`
}

// -- artifact loading (fs read + mtime-keyed cache, tracking-route pattern) --

interface CacheEntry<T> {
  mtimeMs: number
  data: T | null
}

let statesCache: CacheEntry<StateOutcomesArtifact> | null = null
let examplesCache: CacheEntry<ExamplesArtifact> | null = null

function loadJson<T>(file: string, cache: CacheEntry<T> | null): CacheEntry<T> {
  try {
    const stat = fs.statSync(file)
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as T
    return { mtimeMs: stat.mtimeMs, data: parsed }
  } catch {
    return { mtimeMs: -1, data: null }
  }
}

function loadStates(): StateOutcomesArtifact | null {
  statesCache = loadJson<StateOutcomesArtifact>(STATES_FILE, statesCache)
  return statesCache.data
}

function loadExamples(): ExamplesArtifact | null {
  examplesCache = loadJson<ExamplesArtifact>(EXAMPLES_FILE, examplesCache)
  return examplesCache.data
}

/**
 * Exact-count lookup for a match state. Always resolves: an unseen state (or
 * a missing artifact) yields zero counts rather than an error.
 */
export function queryRarity(
  gender: RarityGender,
  diff: number,
  minute: number
): RarityQueryResult {
  const artifact = loadStates()
  const key = rarityKey(gender, diff, minute)
  const counts = artifact?.states?.[key] ?? { n: 0, w: 0, d: 0, l: 0 }
  return {
    key,
    gender,
    diff: clampDiff(diff),
    minute_bucket: minuteBucket(minute),
    n: counts.n,
    w: counts.w,
    d: counts.d,
    l: counts.l,
    win_rate: counts.n > 0 ? Math.round((counts.w / counts.n) * 10000) / 10000 : 0,
    matches_covered: artifact?.matches_covered ?? 0,
  }
}

/**
 * Precedent matches for a state key — sides that reached this state and won
 * (listed first) or drew. Present only for dramatic keys; empty otherwise.
 */
export function getRarityExamples(
  gender: RarityGender,
  diff: number,
  minute: number
): Array<RarityExample & { outcome: 'w' | 'd' }> {
  const artifact = loadExamples()
  const entry = artifact?.examples?.[rarityKey(gender, diff, minute)]
  if (!entry) return []
  return [
    ...(entry.w ?? []).map((e) => ({ ...e, outcome: 'w' as const })),
    ...(entry.d ?? []).map((e) => ({ ...e, outcome: 'd' as const })),
  ]
}
