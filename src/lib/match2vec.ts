import fs from 'fs'
import path from 'path'

import { normalizeTeamName } from '@/lib/simulation/teamPriors'

/**
 * match2vec — retrieval layer over the committed match-trajectory index
 * (`backend/data/match2vec/index.json`, produced by
 * `python -m backend.scripts.build_match2vec`).
 *
 * Server-only (reads the filesystem): import from Node API routes, never
 * from client components — the same pattern as `src/lib/rarity.ts` and
 * `src/lib/simulation/teamPriors.ts`.
 *
 * VISION rule (docs/VISION_2030.md): embeddings may RETRIEVE, never number.
 * Nothing in this module's public output carries a similarity value — the
 * per-match `facts` are exact event counts from the warehouse and are the
 * only thing callers may verbalise.
 *
 * Honesty rule: a match that cannot be resolved in the index yields no
 * neighbours at all — callers render nothing, never a guess.
 */

export type Match2VecGender = 'M' | 'F'

/** Exact counts stored per match — minutes are effective (base + added). */
export interface MatchFacts {
  leadChanges: number
  equalizers: number
  comebackDepth: number
  /** Effective minute of the goal that decided it; -1 for draws. */
  deciderMinute: number
  /** -1 when goalless. */
  firstGoalMinute: number
  /** -1 when goalless. */
  lastGoalMinute: number
  redsHome: number
  redsAway: number
}

export interface Match2VecEntry {
  id: string
  competitionId: string
  season: number | null
  /** YYYY-MM-DD (UTC). */
  date: string
  home: string
  away: string
  /** "h-a" final score. */
  score: string
  gender: Match2VecGender
  facts: MatchFacts
  /** Unit-normalised feature vector (dequantised from the artifact). */
  vector: Float32Array
}

interface Match2VecMeta {
  schema: number
  feature_version: number
  dim: number
  count: number
  generated_at: string
}

export interface Match2VecIndex {
  meta: Match2VecMeta
  entries: Match2VecEntry[]
  /** ESPN event id (the live match-page id) → entry. */
  byEventId: Map<string, Match2VecEntry>
  /** `${competitionId}|${normHome}|${normAway}` → entries. */
  byFixture: Map<string, Match2VecEntry[]>
}

const INDEX_FILE = path.join(process.cwd(), 'backend', 'data', 'match2vec', 'index.json')

// Warehouse competition ids ↔ the ESPN league ids the frontend routes use.
// Mirrors WOMEN_COMPETITIONS in backend/services/data/espn_loader.py.
const WAREHOUSE_TO_ESPN_LEAGUE: Record<string, string> = {
  'usa.1.w': 'usa.nwsl',
  'eng.1.w': 'eng.w.1',
  'fifa.world.w': 'fifa.wwc',
  'uefa.euro.w': 'uefa.weuro',
  'uefa.champions.w': 'uefa.wchampions',
}
const ESPN_LEAGUE_TO_WAREHOUSE: Record<string, string> = Object.fromEntries(
  Object.entries(WAREHOUSE_TO_ESPN_LEAGUE).map(([wh, espn]) => [espn, wh])
)

/** ESPN league id (or already-warehouse id) → warehouse competition id. */
export function toWarehouseCompetition(league: string): string {
  return ESPN_LEAGUE_TO_WAREHOUSE[league] ?? league
}

/** Warehouse competition id → the ESPN league id match-page URLs expect. */
export function toEspnLeague(competitionId: string): string {
  return WAREHOUSE_TO_ESPN_LEAGUE[competitionId] ?? competitionId
}

/** `espn_{competition_id}_{event_id}` → event_id; null for other sources. */
export function espnEventIdFromMatchId(matchId: string): string | null {
  if (!matchId.startsWith('espn_')) return null
  const eventId = matchId.slice(matchId.lastIndexOf('_') + 1)
  return eventId || null
}

/**
 * Live match-page href for an index entry, or null when the entry has no
 * routable id (football-data / openfootball matches have no live page —
 * an unlinked row is honest, a dead link is not).
 */
export function matchHref(entry: Match2VecEntry): string | null {
  const eventId = espnEventIdFromMatchId(entry.id)
  if (!eventId) return null
  return `/matches/${eventId}?league=${encodeURIComponent(toEspnLeague(entry.competitionId))}`
}

// ---------------------------------------------------------------------------
// Vector + row decoding (layout mirrored from build_match2vec.py)
// ---------------------------------------------------------------------------

/** Decode the base64 int8 vector into a unit-normalised Float32Array. */
export function decodeVector(b64: string, dim: number): Float32Array | null {
  const buf = Buffer.from(b64, 'base64')
  if (buf.length !== dim) return null
  const ints = new Int8Array(buf.buffer, buf.byteOffset, buf.length)
  const vec = new Float32Array(dim)
  let sumSq = 0
  for (let i = 0; i < dim; i++) {
    vec[i] = ints[i]
    sumSq += ints[i] * ints[i]
  }
  if (sumSq === 0) return null
  const inv = 1 / Math.sqrt(sumSq)
  for (let i = 0; i < dim; i++) vec[i] *= inv
  return vec
}

export type RawRow = [
  string, // match_id
  string, // competition_id
  number | null, // season
  string, // date YYYY-MM-DD
  string, // home
  string, // away
  string, // final_score
  string, // gender
  string, // vector b64 int8
  number[], // facts
]

export function decodeRow(row: RawRow, dim: number): Match2VecEntry | null {
  const [id, competitionId, season, date, home, away, score, gender, b64, facts] = row
  if (gender !== 'M' && gender !== 'F') return null
  if (!Array.isArray(facts) || facts.length < 8) return null
  const vector = decodeVector(b64, dim)
  if (!vector) return null
  return {
    id,
    competitionId,
    season: typeof season === 'number' ? season : null,
    date,
    home,
    away,
    score,
    gender,
    facts: {
      leadChanges: facts[0],
      equalizers: facts[1],
      comebackDepth: facts[2],
      deciderMinute: facts[3],
      firstGoalMinute: facts[4],
      lastGoalMinute: facts[5],
      redsHome: facts[6],
      redsAway: facts[7],
    },
    vector,
  }
}

// ---------------------------------------------------------------------------
// Artifact loading — fs read + mtime-keyed cache (rarity.ts pattern)
// ---------------------------------------------------------------------------

interface CacheEntry {
  mtimeMs: number
  data: Match2VecIndex | null
}

let indexCache: CacheEntry | null = null

function fixtureKey(competitionId: string, home: string, away: string): string {
  return `${competitionId}|${normalizeTeamName(home)}|${normalizeTeamName(away)}`
}

/** Build the in-memory index from decoded artifact rows. Exported for tests. */
export function buildIndexFromRows(meta: Match2VecMeta, rows: RawRow[]): Match2VecIndex {
  const entries: Match2VecEntry[] = []
  const byEventId = new Map<string, Match2VecEntry>()
  const byFixture = new Map<string, Match2VecEntry[]>()
  for (const row of rows) {
    const entry = decodeRow(row, meta.dim)
    if (!entry) continue
    entries.push(entry)
    const eventId = espnEventIdFromMatchId(entry.id)
    if (eventId) byEventId.set(eventId, entry)
    const key = fixtureKey(entry.competitionId, entry.home, entry.away)
    const bucket = byFixture.get(key)
    if (bucket) bucket.push(entry)
    else byFixture.set(key, [entry])
  }
  return { meta, entries, byEventId, byFixture }
}

function loadIndex(): Match2VecIndex | null {
  try {
    const stat = fs.statSync(INDEX_FILE)
    if (indexCache && indexCache.mtimeMs === stat.mtimeMs) return indexCache.data
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')) as {
      meta: Match2VecMeta
      rows: RawRow[]
    }
    indexCache = { mtimeMs: stat.mtimeMs, data: buildIndexFromRows(parsed.meta, parsed.rows) }
  } catch {
    indexCache = { mtimeMs: -1, data: null }
  }
  return indexCache.data
}

// ---------------------------------------------------------------------------
// Query resolution — mapping a live page's match onto a warehouse entry
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

function daysApart(a: string, b: string): number {
  const ta = Date.parse(a.slice(0, 10))
  const tb = Date.parse(b.slice(0, 10))
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY
  return Math.abs(ta - tb) / DAY_MS
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a)
  const nb = normalizeTeamName(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

export interface ResolveQuery {
  /** The live page's match id — an ESPN event id for ESPN-sourced pages. */
  matchId: string
  /** ESPN league id from the page (e.g. "eng.1", "eng.w.1"). */
  league?: string
  /** Kickoff date (ISO or YYYY-MM-DD). */
  date?: string
  home?: string
  away?: string
}

/**
 * Resolve the page's match to an index entry.
 *
 * 1. Direct: the page id matches an `espn_*` entry's event id. When fixture
 *    context is supplied it must corroborate (date within 3 days, or a team
 *    name in common) — this guards against foreign id namespaces (FotMob)
 *    colliding with ESPN event ids.
 * 2. Fixture: competition + kickoff day (±1) + both team names. This is how
 *    matches covered under football-data/openfootball ids resolve.
 *
 * Exported for tests via `resolveEntryIn`; the route uses `resolveEntry`.
 */
export function resolveEntryIn(index: Match2VecIndex, query: ResolveQuery): Match2VecEntry | null {
  const direct = index.byEventId.get(query.matchId)
  if (direct) {
    const dateOk = !query.date || daysApart(query.date, direct.date) <= 3
    const namesOk =
      (!query.home && !query.away) ||
      Boolean(query.home && namesMatch(query.home, direct.home)) ||
      Boolean(query.away && namesMatch(query.away, direct.away))
    if (dateOk && namesOk) return direct
  }

  if (!query.league || !query.date || !query.home || !query.away) return null
  const competitionId = toWarehouseCompetition(query.league)

  const exact = index.byFixture.get(fixtureKey(competitionId, query.home, query.away))
  const withinWindow = (entry: Match2VecEntry) => daysApart(query.date as string, entry.date) <= 1
  const exactHits = (exact ?? []).filter(withinWindow)
  if (exactHits.length === 1) return exactHits[0]
  if (exactHits.length > 1) return null // ambiguous — refuse to guess

  // Containment fallback for name variants the normalizer can't unify.
  const loose = index.entries.filter(
    (entry) =>
      entry.competitionId === competitionId &&
      withinWindow(entry) &&
      namesMatch(query.home as string, entry.home) &&
      namesMatch(query.away as string, entry.away)
  )
  return loose.length === 1 ? loose[0] : null
}

// ---------------------------------------------------------------------------
// Neighbour search — brute-force cosine over unit vectors
// ---------------------------------------------------------------------------

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

function sameFixture(a: Match2VecEntry, b: Match2VecEntry): boolean {
  return (
    daysApart(a.date, b.date) <= 1 &&
    namesMatch(a.home, b.home) &&
    namesMatch(a.away, b.away)
  )
}

/**
 * Top-k nearest entries to `query` by cosine similarity, excluding the
 * query itself and any duplicate of its fixture, and deduping the result
 * so no fixture appears twice. Similarity values stay internal — they are
 * ranking machinery, never public numbers.
 *
 * Exported for tests via `selectNeighborsIn`.
 */
export function selectNeighborsIn(
  entries: Match2VecEntry[],
  query: Match2VecEntry,
  k: number
): Match2VecEntry[] {
  const scored: Array<{ entry: Match2VecEntry; sim: number }> = []
  for (const entry of entries) {
    if (entry.id === query.id) continue
    scored.push({ entry, sim: dot(entry.vector, query.vector) })
  }
  scored.sort((a, b) => b.sim - a.sim || a.entry.id.localeCompare(b.entry.id))

  const picked: Match2VecEntry[] = []
  for (const { entry } of scored) {
    if (picked.length >= k) break
    if (sameFixture(entry, query)) continue
    if (picked.some((p) => sameFixture(p, entry))) continue
    picked.push(entry)
  }
  return picked
}

// ---------------------------------------------------------------------------
// Route-facing API
// ---------------------------------------------------------------------------

export function resolveEntry(query: ResolveQuery): Match2VecEntry | null {
  const index = loadIndex()
  if (!index) return null
  return resolveEntryIn(index, query)
}

export function selectNeighbors(query: Match2VecEntry, k: number): Match2VecEntry[] {
  const index = loadIndex()
  if (!index) return []
  return selectNeighborsIn(index.entries, query, k)
}
