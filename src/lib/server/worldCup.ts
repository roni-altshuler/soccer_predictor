/**
 * Server-side access to World Cup bracket simulations.
 *
 * Locally the FastAPI Monte Carlo simulator serves fresh runs; on Vercel
 * (no Python backend) we fall back to the committed snapshot at
 * backend/data/worldcup/bracket_paths.json, refreshed 3×/day by the
 * prediction pipeline — the same pattern the /accuracy routes use with
 * committed prediction JSON.
 */

import { promises as fs } from 'fs'
import path from 'path'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'
const SNAPSHOT_PATH = path.join(process.cwd(), 'backend', 'data', 'worldcup', 'bracket_paths.json')

export interface BracketTeam {
  team_id: number | null
  name: string
  elo?: number
  group?: string
  p_champion: number
  p_final: number
  p_semi: number
  p_quarter: number
  p_r16: number
  p_r32: number
  most_likely_round_reached: string
}

export interface BracketTie {
  match_id: string
  home: string | null
  away: string | null
  home_score: number | null
  away_score: number | null
  winner: string | null
  date: string | null
}

export interface BracketPathsPayload {
  tournament: string
  generated_at: string
  n_simulations: number
  bracket_set: boolean
  teams: BracketTeam[]
  round_matchups: Array<{ round: string; label: string; matches: BracketTie[] }>
  /** Where this payload came from — 'live' simulator or committed 'snapshot'. */
  source?: 'live' | 'snapshot'
  error?: string
}

async function fromBackend(nSimulations: number, seed?: string | null, fresh?: boolean): Promise<BracketPathsPayload | null> {
  try {
    const qs = new URLSearchParams({ n_simulations: String(nSimulations) })
    if (seed) qs.set('seed', seed)
    if (fresh) qs.set('fresh', 'true')
    // Hard timeout so a slow/cold backend (a live 20k-sim Monte Carlo can take
    // tens of seconds) never stalls page prerender or ISR revalidation — we
    // fall back to the committed snapshot instead.
    const res = await fetch(`${BACKEND_URL}/api/v1/world-cup/bracket/paths?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as BracketPathsPayload
    if (!Array.isArray(data.teams) || data.teams.length === 0) return null
    return { ...data, source: 'live' }
  } catch {
    return null
  }
}

async function fromSnapshot(): Promise<BracketPathsPayload | null> {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, 'utf-8')
    const data = JSON.parse(raw) as BracketPathsPayload
    if (!Array.isArray(data.teams) || data.teams.length === 0) return null
    return { ...data, source: 'snapshot' }
  } catch {
    return null
  }
}

export async function getBracketPaths(
  nSimulations = 20_000,
  seed?: string | null,
  fresh?: boolean,
): Promise<BracketPathsPayload | null> {
  return (await fromBackend(nSimulations, seed, fresh)) ?? (await fromSnapshot())
}
