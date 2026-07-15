import fs from 'fs'
import path from 'path'

/**
 * Team-strength priors for the season simulators — query layer over the
 * committed artifact `backend/data/sim_priors.json` (produced by
 * `python -m backend.scripts.build_sim_priors`, which resolves the committed
 * per-competition team-strength parameters onto the exact team names the
 * simulator receives from the live standings feed).
 *
 * Server-only (reads the filesystem): import from Node API routes, never from
 * client components — the same pattern as `src/lib/rarity.ts`, so this works
 * on Vercel where the Python backend isn't deployed.
 *
 * Honesty rule: a team missing from the artifact gets `undefined` — the
 * simulator then behaves exactly as before (no fabricated differentiation).
 */

export interface TeamPriorEntry {
  params_name: string
  espn_team_id: string
  match: 'exact' | 'normalized' | 'override'
  attack: number
  defence: number
  /** Expected points per game from a full round robin under the fitted model. */
  prior_ppg: number
}

interface CompetitionPriors {
  espn_league_slug: string
  home_adv: number
  rho: number
  fitted_matches: number
  last_match_date: string | null
  /** Keyed by the frontend (standings feed) displayName. */
  teams: Record<string, TeamPriorEntry>
  unmatched_params_teams: string[]
  unmatched_frontend_teams: string[]
}

interface SimPriorsArtifact {
  schema: number
  generated_at: string
  params_generated_at: string
  competitions: Record<string, CompetitionPriors>
}

const PRIORS_FILE = path.join(
  process.cwd(),
  'backend',
  'data',
  'sim_priors.json',
)

/**
 * Normalize a team name for lookup — MUST stay in lockstep with
 * `normalize_team_name` in backend/scripts/build_sim_priors.py (and the
 * fixture matcher in the simulation route): strip diacritics, lowercase,
 * expand `&`, drop FC-style suffix words, collapse punctuation.
 */
export function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(football club|fc|afc|cf|sc|club|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// -- artifact loading (fs read + mtime-keyed cache, rarity.ts pattern) -------

interface CacheEntry {
  mtimeMs: number
  data: SimPriorsArtifact | null
}

let artifactCache: CacheEntry | null = null

function loadArtifact(): SimPriorsArtifact | null {
  try {
    const stat = fs.statSync(PRIORS_FILE)
    if (artifactCache && artifactCache.mtimeMs === stat.mtimeMs) {
      return artifactCache.data
    }
    const parsed = JSON.parse(
      fs.readFileSync(PRIORS_FILE, 'utf-8'),
    ) as SimPriorsArtifact
    artifactCache = { mtimeMs: stat.mtimeMs, data: parsed }
  } catch {
    artifactCache = { mtimeMs: -1, data: null }
  }
  return artifactCache.data
}

/**
 * Prior expected-points-per-game for every matched team of a competition,
 * keyed by BOTH the exact frontend display name and its normalized form.
 * Returns null when the competition (or the artifact itself) is absent —
 * callers then simulate exactly as before.
 */
export function getLeaguePriorPpg(
  competitionId: string,
): Map<string, number> | null {
  const artifact = loadArtifact()
  const comp = artifact?.competitions?.[competitionId]
  if (!comp) return null
  const map = new Map<string, number>()
  for (const [name, entry] of Object.entries(comp.teams)) {
    if (!Number.isFinite(entry.prior_ppg)) continue
    map.set(name, entry.prior_ppg)
    const normalized = normalizeTeamName(name)
    // Normalized keys are collision-checked at artifact build time; a clash
    // here would only shadow an identical value.
    if (normalized && !map.has(normalized)) map.set(normalized, entry.prior_ppg)
  }
  return map.size > 0 ? map : null
}

/**
 * Look up one team's prior PPG: exact display name first, then the
 * normalized form. `undefined` means "no prior" — the honest fallback.
 */
export function lookupPriorPpg(
  priors: Map<string, number> | null,
  teamName: string,
): number | undefined {
  if (!priors) return undefined
  const exact = priors.get(teamName)
  if (exact !== undefined) return exact
  return priors.get(normalizeTeamName(teamName))
}
