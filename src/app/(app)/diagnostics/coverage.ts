import fs from 'fs'
import path from 'path'

/**
 * Timeline-coverage report — loader + pure view helpers for /diagnostics.
 *
 * Server-only (reads the filesystem): import from server components or Node
 * API routes, never from client components. The artifact is produced by
 * `python -m backend.scripts.build_event_coverage` and committed under
 * `backend/data/events/` (the warehouse SQLite itself is gitignored and not
 * available on Vercel) — the same pattern as `src/lib/rarity.ts`.
 *
 * Honesty rule (docs/VISION_2030.md §3.2): every number is an exact count of
 * warehouse rows. A missing artifact yields `null` — the page renders an
 * empty state, never a fabricated table.
 */

export interface CoverageCounts {
  matches: number
  covered: number
  with_events: number
  verified_empty: number
  uncovered: number
  coverage: number
}

export interface SeasonCoverage extends CoverageCounts {
  season: number
}

export interface CompetitionCoverage extends CoverageCounts {
  competition_id: string
  name: string | null
  gender: 'M' | 'F' | null
  seasons: SeasonCoverage[]
}

export interface CoverageArtifact {
  schema: number
  generated_at: string
  totals: CoverageCounts
  competitions: CompetitionCoverage[]
}

const COVERAGE_FILE = path.join(process.cwd(), 'backend', 'data', 'events', 'coverage.json')

// -- artifact loading (fs read + mtime-keyed cache, rarity-lib pattern) ------

interface CacheEntry {
  mtimeMs: number
  data: CoverageArtifact | null
}

let coverageCache: CacheEntry | null = null

/** Structural validation — a malformed artifact must not half-render. */
export function parseCoverage(raw: unknown): CoverageArtifact | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.schema !== 'number' || typeof obj.generated_at !== 'string') return null
  if (typeof obj.totals !== 'object' || obj.totals === null) return null
  if (!Array.isArray(obj.competitions)) return null
  return obj as unknown as CoverageArtifact
}

export function loadCoverage(): CoverageArtifact | null {
  try {
    const stat = fs.statSync(COVERAGE_FILE)
    if (coverageCache && coverageCache.mtimeMs === stat.mtimeMs) return coverageCache.data
    const parsed = parseCoverage(JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf-8')))
    coverageCache = { mtimeMs: stat.mtimeMs, data: parsed }
  } catch {
    coverageCache = { mtimeMs: -1, data: null }
  }
  return coverageCache.data
}

// -- pure view helpers --------------------------------------------------------

/** Largest corpora first; id tiebreak keeps the order stable. */
export function sortByMatches(competitions: CompetitionCoverage[]): CompetitionCoverage[] {
  return [...competitions].sort(
    (a, b) => b.matches - a.matches || a.competition_id.localeCompare(b.competition_id)
  )
}

/** Split into men's / women's groups (unknown gender rides with men's). */
export function groupByGender(competitions: CompetitionCoverage[]): {
  men: CompetitionCoverage[]
  women: CompetitionCoverage[]
} {
  const sorted = sortByMatches(competitions)
  return {
    men: sorted.filter((c) => c.gender !== 'F'),
    women: sorted.filter((c) => c.gender === 'F'),
  }
}

/** Seasons newest-first for display (the artifact stores them ascending). */
export function seasonsNewestFirst(seasons: SeasonCoverage[]): SeasonCoverage[] {
  return [...seasons].sort((a, b) => b.season - a.season)
}

/** Season start-year label; -1 marks warehouse rows without a season. */
export function seasonLabel(season: number): string {
  return season === -1 ? 'Unlabelled' : String(season)
}

/** "43.8%" — one decimal, from the artifact's 0..1 ratio. */
export function coveragePercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return '0.0%'
  return `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(1)}%`
}
