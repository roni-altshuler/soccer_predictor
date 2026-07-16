/**
 * Client fetch helper for the match-engine fork endpoint.
 *
 * FROZEN CONTRACT (the kernel implements exactly this — do not deviate):
 *
 *   POST /api/v1/engine/fork
 *   body: { matchId: string, state: { minute, homeGoals, awayGoals, homeReds, awayReds } }
 *   →    { available: boolean, distribution?: { pHome, pDraw, pAway,
 *          expHomeGoals, expAwayGoals, topScorelines: [{ home, away, p }] } }
 *
 * `available: false`, a non-OK response, a network failure, or a malformed
 * distribution all collapse to `null` — the caller renders NOTHING for that
 * fork. Never fabricate a distribution.
 *
 * This file must stay client-safe: it must NOT import from `src/lib/engine/`
 * (server-only) — the contract above is the only coupling to the kernel.
 */

export const ENGINE_FORK_ENDPOINT = '/api/v1/engine/fork'

/** The state the kernel continues from — field-for-field the contract shape. */
export interface EngineForkState {
  minute: number
  homeGoals: number
  awayGoals: number
  homeReds: number
  awayReds: number
}

export interface ForkScoreline {
  home: number
  away: number
  p: number
}

export interface ForkDistribution {
  pHome: number
  pDraw: number
  pAway: number
  expHomeGoals: number
  expAwayGoals: number
  topScorelines: ForkScoreline[]
}

/** Kickoff state — the availability probe: minute 1, 0–0, full sides. */
export const KICKOFF_STATE: EngineForkState = Object.freeze({
  minute: 1,
  homeGoals: 0,
  awayGoals: 0,
  homeReds: 0,
  awayReds: 0,
})

/** Minimal fetch shape so tests can inject a mock without faking a Response. */
export type EngineFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; json(): Promise<unknown> }>

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Validate the kernel's distribution — anything malformed is `null`, never patched. */
function parseDistribution(raw: unknown): ForkDistribution | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (
    !isFiniteNumber(d.pHome) ||
    !isFiniteNumber(d.pDraw) ||
    !isFiniteNumber(d.pAway) ||
    !isFiniteNumber(d.expHomeGoals) ||
    !isFiniteNumber(d.expAwayGoals) ||
    !Array.isArray(d.topScorelines)
  ) {
    return null
  }
  const topScorelines: ForkScoreline[] = []
  for (const entry of d.topScorelines) {
    if (!entry || typeof entry !== 'object') continue
    const s = entry as Record<string, unknown>
    if (isFiniteNumber(s.home) && isFiniteNumber(s.away) && isFiniteNumber(s.p)) {
      topScorelines.push({ home: s.home, away: s.away, p: s.p })
    }
  }
  return {
    pHome: d.pHome,
    pDraw: d.pDraw,
    pAway: d.pAway,
    expHomeGoals: d.expHomeGoals,
    expAwayGoals: d.expAwayGoals,
    topScorelines,
  }
}

/**
 * Ask the kernel to play out the continuation from `state`. Resolves to the
 * distribution, or `null` when the fork is unavailable for ANY reason
 * (kernel said no, route missing, network down, malformed payload) — the
 * caller must render nothing in that case.
 */
export async function fetchForkDistribution(
  matchId: string,
  state: EngineForkState,
  fetchImpl: EngineFetch = fetch
): Promise<ForkDistribution | null> {
  try {
    const res = await fetchImpl(ENGINE_FORK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, state }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { available?: unknown; distribution?: unknown } | null
    if (!json || typeof json !== 'object' || json.available !== true) return null
    return parseDistribution(json.distribution)
  } catch {
    return null
  }
}
