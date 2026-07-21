import fs from 'fs'
import path from 'path'

import { normalizeTeamName } from '@/lib/simulation/teamPriors'

import type { MatchAnchor } from './params'

/**
 * Derive a Match Engine kernel anchor for a LIVE fixture — the seam that lets
 * the roll-forward kernel run on in-progress matches that are NOT in the
 * committed per-match anchor export (`kernel.json` only carries anchors for
 * finished/covered matches).
 *
 * A live anchor is the Dixon-Coles nesting the kernel already assumes, read
 * straight off the committed team-strength artifact `backend/data/sim_priors.json`
 * (produced by `python -m backend.scripts.build_sim_priors`). That artifact
 * already resolves the fitted per-competition attack/defence strengths onto the
 * exact ESPN team names the live surface receives, using the conservative
 * normalized-match-then-refuse-ambiguity rule — so a live fixture's team names
 * resolve directly, and anything ambiguous or uncovered yields `null`.
 *
 *     λ (home) = exp(attack[H] − defence[A] + home_adv)
 *     μ (away) = exp(attack[A] − defence[H])
 *     ρ        = the competition's fitted low-score dependence
 *
 * This is exactly `DixonColesModel.expected_goals` in
 * `backend/services/prediction/dixon_coles.py`, so the kernel consumes the
 * anchor with zero adaptation.
 *
 * Server-only (reads the filesystem): import from Node API routes, never from
 * client components — the same pattern as `src/lib/rarity.ts`,
 * `src/lib/engine/params.ts`, and `src/lib/simulation/teamPriors.ts`, so this
 * works on Vercel where the warehouse SQLite and Python backend are absent.
 *
 * Honesty rule: an uncovered competition, an unresolved team, or an ambiguous
 * name yields `null` — the caller then falls back to existing behaviour, never
 * a fabricated anchor.
 */

// -- committed-artifact shape (subset of backend/data/sim_priors.json) -------

interface SimPriorTeam {
  attack: number
  defence: number
}

interface SimPriorCompetition {
  espn_league_slug: string
  home_adv: number
  rho: number
  teams: Record<string, SimPriorTeam>
}

interface SimPriorsArtifact {
  schema: number
  competitions: Record<string, SimPriorCompetition>
}

const PRIORS_FILE = path.join(process.cwd(), 'backend', 'data', 'sim_priors.json')

// -- artifact loading (fs read + mtime-keyed cache, teamPriors.ts pattern) ---

interface CacheEntry {
  mtimeMs: number
  data: SimPriorsArtifact | null
}

let artifactCache: CacheEntry | null = null

function loadArtifact(): SimPriorsArtifact | null {
  try {
    const stat = fs.statSync(PRIORS_FILE)
    if (artifactCache && artifactCache.mtimeMs === stat.mtimeMs) return artifactCache.data
    const parsed = JSON.parse(fs.readFileSync(PRIORS_FILE, 'utf-8')) as SimPriorsArtifact
    artifactCache = { mtimeMs: stat.mtimeMs, data: parsed }
  } catch {
    artifactCache = { mtimeMs: -1, data: null }
  }
  return artifactCache.data
}

// -- competition resolution (by warehouse id OR ESPN slug) -------------------

interface ResolvedCompetition {
  key: string
  comp: SimPriorCompetition
}

/**
 * Resolve the competition the live fixture carries. The live surface passes an
 * ESPN league slug (`eng.1`, `usa.nwsl`, …); the artifact keys competitions by
 * the warehouse id (`eng.1`, `usa.1.w`, …) and stores the ESPN slug inside, so
 * a match on EITHER identifier resolves. Returns `null` when uncovered.
 */
function resolveCompetition(
  artifact: SimPriorsArtifact,
  competition: string,
): ResolvedCompetition | null {
  const wanted = competition.trim()
  if (!wanted) return null
  const direct = artifact.competitions[wanted]
  if (direct) return { key: wanted, comp: direct }
  for (const [key, comp] of Object.entries(artifact.competitions)) {
    if (comp.espn_league_slug === wanted) return { key, comp }
  }
  return null
}

// -- team resolution (exact → unambiguous normalized; refuse ambiguity) ------

/**
 * Look up one team's attack/defence: exact display-name hit first, then a
 * normalized hit that is unambiguous (exactly one candidate). A name whose
 * normalized form collides with two artifact teams is refused (`undefined`) —
 * the same discipline `build_sim_priors.py` uses, applied at query time so a
 * live name never silently binds to the wrong club.
 */
function lookupStrength(
  comp: SimPriorCompetition,
  teamName: string,
): SimPriorTeam | undefined {
  const exact = comp.teams[teamName]
  if (exact) return exact
  const norm = normalizeTeamName(teamName)
  if (!norm) return undefined
  let hit: SimPriorTeam | undefined
  let matches = 0
  for (const [name, entry] of Object.entries(comp.teams)) {
    if (normalizeTeamName(name) === norm) {
      hit = entry
      matches += 1
      if (matches > 1) return undefined // ambiguous — refuse
    }
  }
  return matches === 1 ? hit : undefined
}

/** Gender is carried by the competition's warehouse id (`*.w` → women's). */
function genderForCompetitionKey(key: string): 'M' | 'F' {
  return /\.w(\.|$)/.test(key) ? 'F' : 'M'
}

export interface LiveAnchorInput {
  /** ESPN league slug or warehouse competition id from the live fixture. */
  competition: string
  homeTeam: string
  awayTeam: string
}

/**
 * Derive a live-fixture kernel anchor, or `null` when the competition is
 * uncovered, either team is unresolved/ambiguous, or the artifact is missing.
 * Deterministic: identical inputs always yield the identical anchor.
 */
export function deriveLiveAnchor(input: LiveAnchorInput): MatchAnchor | null {
  const artifact = loadArtifact()
  if (!artifact?.competitions) return null

  const resolved = resolveCompetition(artifact, input.competition)
  if (!resolved) return null
  const { key, comp } = resolved

  const home = lookupStrength(comp, input.homeTeam)
  const away = lookupStrength(comp, input.awayTeam)
  if (!home || !away) return null

  const homeAdv = comp.home_adv
  const rho = comp.rho
  if (!Number.isFinite(homeAdv) || !Number.isFinite(rho)) return null

  const lambda = Math.exp(home.attack - away.defence + homeAdv)
  const mu = Math.exp(away.attack - home.defence)
  if (!Number.isFinite(lambda) || !Number.isFinite(mu)) return null

  return { lambda, mu, rho, gender: genderForCompetitionKey(key) }
}
