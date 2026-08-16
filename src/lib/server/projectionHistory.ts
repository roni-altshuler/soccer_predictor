import { promises as fs } from 'fs'
import path from 'path'

/**
 * What the season projection said last time, and what moved it.
 *
 * `season_projections.json` is a snapshot regenerated in place, so a reader
 * only ever sees today's number and has to take it on trust.
 * `capture_projection_history.py` appends each run's figures to
 * `projection_history.jsonl` first, and this reads the last two of them.
 *
 * THE INTEGRITY RULE, and it is the whole reason this file is careful:
 * **a projection can move without any football having been played.** The model
 * retrains nightly, so two snapshots taken over a quiet day differ for reasons
 * that have nothing to do with any team. Narrating that as "Arsenal's title
 * chance rose" would be inventing a result.
 *
 * `played` is captured per TEAM, which makes the rule three-way rather than
 * two-way, and each case gets a different sentence:
 *
 *   1. **Nobody in the competition played.** The entire delta is a retrain.
 *      Nothing is rendered — not a caveat, a refusal.
 *   2. **This team played.** Its own result moved it. `movedBy: 'own-result'`.
 *   3. **This team did not, but others did.** It was moved by other people's
 *      results — real football, but not this club's. `movedBy: 'other-results'`.
 *
 * Case 3 is the one a naive implementation gets wrong: it is tempting to show
 * every mover under one heading, which quietly credits a club for a Saturday
 * it spent at home. Measured 2026-08-16: of the four biggest esp.1 movers, two
 * had played nothing.
 */

const FILE = path.join(
  process.cwd(),
  'backend',
  'data',
  'predictions',
  'projection_history.jsonl',
)

/** The figures worth following. Mirrors FIGURES in capture_projection_history.py. */
export const FIGURES = ['p_title', 'p_top_cut', 'p_relegated'] as const
export type Figure = (typeof FIGURES)[number]

interface Row {
  generated_at?: string
  competition_id?: string
  season?: number
  team?: string
  played?: number | null
  points?: number | null
  p_title?: number | null
  p_top_cut?: number | null
  p_relegated?: number | null
}

export interface Move {
  team: string
  figure: Figure
  from: number
  to: number
  delta: number
  /** Whether this club played between the two snapshots, or was moved by others. */
  movedBy: 'own-result' | 'other-results'
  playedFrom: number | null
  playedTo: number | null
}

export interface Movement {
  competitionId: string
  season: number | null
  from: string
  to: string
  /** Matches played across the competition between the two snapshots. */
  matchesPlayed: number
  moves: Move[]
}

let cache: { stamp: string; rows: Row[] } | null = null

async function read(): Promise<Row[]> {
  let stat
  try {
    stat = await fs.stat(FILE)
  } catch {
    return []
  }
  const stamp = `${stat.mtimeMs}:${stat.size}`
  if (cache?.stamp === stamp) return cache.rows

  const rows: Row[] = []
  const text = await fs.readFile(FILE, 'utf8')
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line) as Row)
    } catch {
      // A half-written line costs that line, never the rest of the file.
    }
  }
  cache = { stamp, rows }
  return rows
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Movement in one competition between its two most recent snapshots.
 *
 * Returns null when there is nothing honest to say: fewer than two snapshots,
 * or two snapshots with no football between them.
 */
export async function projectionMovement(
  competitionId: string,
  { minDelta = 0.005, limit = 6 }: { minDelta?: number; limit?: number } = {},
): Promise<Movement | null> {
  const rows = (await read()).filter((r) => r.competition_id === competitionId)
  if (!rows.length) return null

  const stamps = [...new Set(rows.map((r) => r.generated_at).filter(Boolean))].sort() as string[]
  if (stamps.length < 2) return null
  const [from, to] = [stamps[stamps.length - 2], stamps[stamps.length - 1]]

  const before = new Map<string, Row>()
  const after = new Map<string, Row>()
  for (const r of rows) {
    if (!r.team) continue
    if (r.generated_at === from) before.set(r.team, r)
    if (r.generated_at === to) after.set(r.team, r)
  }

  // Rule 1. No football between the snapshots means the whole delta is a
  // retrain. There is no honest version of this panel, so there is no panel.
  let matchesPlayed = 0
  for (const [team, b] of after) {
    const a = before.get(team)
    if (!a || !finite(a.played) || !finite(b.played)) continue
    matchesPlayed += Math.max(0, b.played - a.played)
  }
  if (matchesPlayed === 0) return null

  const moves: Move[] = []
  for (const [team, b] of after) {
    const a = before.get(team)
    if (!a) continue
    const playedFrom = finite(a.played) ? a.played : null
    const playedTo = finite(b.played) ? b.played : null
    // Rules 2 and 3. Same movement, different sentence.
    const movedBy: Move['movedBy'] =
      playedFrom !== null && playedTo !== null && playedTo > playedFrom
        ? 'own-result'
        : 'other-results'

    // Two figures carrying the same pair of values are ONE number under two
    // names, and listing both invents a second finding. MLS is the live case:
    // its `top_cut_label` is "Supporters' Shield", so `p_top_cut` is exactly
    // `p_title` — Nashville rendered twice, identically, as though its title
    // odds and its top-cut odds had each moved 16.3 points.
    //
    // FIGURES order decides the survivor, so the primary name wins.
    const seen = new Set<string>()
    for (const figure of FIGURES) {
      const x = a[figure]
      const y = b[figure]
      if (!finite(x) || !finite(y)) continue
      const delta = y - x
      if (Math.abs(delta) < minDelta) continue
      const shape = `${x}:${y}`
      if (seen.has(shape)) continue
      seen.add(shape)
      moves.push({ team, figure, from: x, to: y, delta, movedBy, playedFrom, playedTo })
    }
  }

  moves.sort((m, n) => Math.abs(n.delta) - Math.abs(m.delta))
  return {
    competitionId,
    season: after.values().next().value?.season ?? null,
    from,
    to,
    matchesPlayed,
    moves: moves.slice(0, limit),
  }
}

/** Competitions that currently have something honest to show. */
export async function competitionsWithMovement(): Promise<string[]> {
  const rows = await read()
  const ids = [...new Set(rows.map((r) => r.competition_id).filter(Boolean))] as string[]
  const out: string[] = []
  for (const id of ids) {
    if (await projectionMovement(id)) out.push(id)
  }
  return out.sort()
}
