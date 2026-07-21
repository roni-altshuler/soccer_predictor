/**
 * Momentum-landscape showcase registry + artifact loader.
 *
 * The `/reconstructions` route renders a small, curated set of famous matches
 * as 3D momentum waves. Our own warehouse only carries goal/card minutes, so a
 * real momentum-from-events surface exists only for matches with a full open
 * event stream — this registry is the source of truth for which those are and
 * doubles as the route-param allowlist.
 *
 * The heavy per-match data lives in committed artifacts at
 * `public/momentum/<slug>.json` (built by
 * `backend/scripts/build_momentum_landscape.py`). Every value there traces to a
 * real event; see that script's docstring for the exact weighting. Anything
 * published from this data must show a visible "Data: StatsBomb" credit.
 */

export type Gender = 'M' | 'F'

export interface MomentumBin {
  /** Bin start, in match minutes (30-second steps: 0, 0.5, 1.0, …). */
  t: number
  /** Signed net threat for the bin in [-1, 1]; + is home, − is away. */
  momentum: number
  /** Signed threat per home-frame zone: [defensive, middle, attacking]. */
  zoneIntensities: number[]
}

export interface MomentumKeyEvent {
  t: number
  minute: number
  type: 'goal' | 'card' | 'sub'
  team: 'home' | 'away'
  player: string
  detail?: string
  scoreAfter?: { home: number; away: number }
}

export interface MomentumLandscape {
  slug: string
  matchId: number
  competition: string
  stage: string
  date: string
  gender: Gender
  dataCredit: string
  binSeconds: number
  zones: string[]
  scaleReference: number
  home: { team: string; isNational: boolean }
  away: { team: string; isNational: boolean }
  finalScore: { home: number; away: number; note?: string }
  bins: MomentumBin[]
  keyEvents: MomentumKeyEvent[]
}

export interface FeaturedReconstruction {
  slug: string
  gender: Gender
  competition: string
  stage: string
  date: string
  home: string
  away: string
  /** Human scoreline for the card (may name a shootout result). */
  scoreline: string
  blurb: string
}

/**
 * The showcased matches — one men's, one women's (parity is deliberate). Slugs
 * match both the artifact filename and the `/reconstructions/[matchId]` param.
 */
export const FEATURED_RECONSTRUCTIONS: readonly FeaturedReconstruction[] = [
  {
    slug: 'wc2022-final-arg-fra',
    gender: 'M',
    competition: 'FIFA World Cup 2022',
    stage: 'Final',
    date: '2022-12-18',
    home: 'Argentina',
    away: 'France',
    scoreline: '3–3 · Argentina won 4–2 on penalties',
    blurb:
      'Messi and Mbappé trade the lead across 120 minutes and a shootout — the widest momentum swings a final has produced.',
  },
  {
    slug: 'wwc2023-final-esp-eng',
    gender: 'F',
    competition: "Women's World Cup 2023",
    stage: 'Final',
    date: '2023-08-20',
    home: 'Spain',
    away: 'England',
    scoreline: '1–0',
    blurb:
      "Carmona's first-half strike and a tide of Spanish control England could never quite turn back.",
  },
] as const

export function featuredBySlug(slug: string): FeaturedReconstruction | undefined {
  return FEATURED_RECONSTRUCTIONS.find((m) => m.slug === slug)
}

/** Minimal fetch shape so the loader is testable without a real Response. */
export type LandscapeFetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>

function isBin(raw: unknown): raw is MomentumBin {
  if (!raw || typeof raw !== 'object') return false
  const b = raw as Record<string, unknown>
  return (
    typeof b.t === 'number' &&
    typeof b.momentum === 'number' &&
    Array.isArray(b.zoneIntensities) &&
    b.zoneIntensities.length === 3 &&
    b.zoneIntensities.every((v) => typeof v === 'number')
  )
}

/**
 * Structural guard: a landscape must have real bins and a final score. A
 * stripped, half-written or wrong-shaped artifact fails here so the surface
 * renders an honest empty rather than a broken mesh.
 */
export function isValidLandscape(raw: unknown): raw is MomentumLandscape {
  if (!raw || typeof raw !== 'object') return false
  const d = raw as Record<string, unknown>
  if (typeof d.slug !== 'string') return false
  if (!Array.isArray(d.bins) || d.bins.length === 0 || !d.bins.every(isBin)) return false
  if (!d.finalScore || typeof d.finalScore !== 'object') return false
  const fs = d.finalScore as Record<string, unknown>
  if (typeof fs.home !== 'number' || typeof fs.away !== 'number') return false
  if (!d.home || !d.away || !Array.isArray(d.keyEvents)) return false
  return true
}

/**
 * Load one committed landscape. Any failure (missing file, offline, malformed
 * payload) resolves to null — never a partial surface.
 */
export async function loadLandscape(
  slug: string,
  fetchImpl: LandscapeFetch = fetch
): Promise<MomentumLandscape | null> {
  try {
    const res = await fetchImpl(`/momentum/${slug}.json`)
    if (!res.ok) return null
    const json = (await res.json()) as unknown
    return isValidLandscape(json) ? json : null
  } catch {
    return null
  }
}
