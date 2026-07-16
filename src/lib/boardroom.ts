import fs from 'fs'
import path from 'path'

/**
 * Boardroom v1 — query layer over the committed debate artifact.
 *
 * Server-only (reads the filesystem): import from Node API routes, never from
 * client components. The artifact is produced at pipeline time by
 * `python -m backend.scripts.build_boardroom` and committed under
 * `backend/data/boardroom/debates.json`. Products read this committed file;
 * they never call a model.
 *
 * Honesty rule (docs/VISION_2030.md §3.4): a debate is only ever surfaced for a
 * match that has a committed entry. A missing artifact (e.g. before the pipeline
 * has ever run with a key) resolves to `null` — never an error, never a
 * placeholder.
 */

export type BoardroomStance = 'home' | 'draw' | 'away' | string
export type DissentLevel = 'low' | 'moderate' | 'high'

export interface BoardroomPersona {
  /** Display name, e.g. "The Quant". */
  name: string
  /** Stable persona key: "quant" | "historian" | "skeptic". */
  key: string
  /** Which outcome this persona leans toward. */
  stance: BoardroomStance
  /** The persona's grounded prose (every number traced to the input bundle). */
  text: string
  /** Short grounded bullet claims. */
  claims: string[]
}

export interface BoardroomDebate {
  match_id: string
  home_team: string
  away_team: string
  league: string
  kickoff: string
  gender: string
  personas: BoardroomPersona[]
  /** Spread of the personas' implied 1X2 views, 0 (agree) … 1 (diverge). */
  dissent_index: number
  dissent_level: DissentLevel
  generated_at: string
}

interface BoardroomArtifact {
  schema: number
  generated_at: string
  provider: string
  model: string
  count: number
  debates: Record<string, BoardroomDebate>
}

const ARTIFACT_FILE = path.join(process.cwd(), 'backend', 'data', 'boardroom', 'debates.json')

// -- artifact loading (fs read + mtime-keyed cache, rarity-route pattern) --

interface CacheEntry {
  mtimeMs: number
  data: BoardroomArtifact | null
}

let cache: CacheEntry | null = null

function loadArtifact(): BoardroomArtifact | null {
  try {
    const stat = fs.statSync(ARTIFACT_FILE)
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.data
    const parsed = JSON.parse(fs.readFileSync(ARTIFACT_FILE, 'utf-8')) as BoardroomArtifact
    cache = { mtimeMs: stat.mtimeMs, data: parsed }
    return parsed
  } catch {
    cache = { mtimeMs: -1, data: null }
    return null
  }
}

/**
 * The committed debate for a match, or `null` when there is no entry (or no
 * artifact at all). A valid lookup never throws.
 */
export function getBoardroomDebate(matchId: string): BoardroomDebate | null {
  if (!matchId) return null
  const artifact = loadArtifact()
  return artifact?.debates?.[String(matchId)] ?? null
}
