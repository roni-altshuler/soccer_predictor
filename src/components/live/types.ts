import type { EngineForkState } from '@/components/match/detail/engineClient'

/**
 * The light match shape the Live Intelligence surface works from — a subset of
 * the `/api/todays_matches` row (see `src/app/api/todays_matches/route.ts`).
 * The deep match-detail page carries the full `MatchDetails`; here we only need
 * enough to drive the engine roll-forward and the cinematic read.
 */
export interface LiveMatch {
  id: string
  match_id: string | number
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  /** ISO kickoff timestamp. */
  time: string
  /** 'live' | 'upcoming' | 'completed'. */
  status: string
  league: string
  leagueId: string
  minute?: number | string
  home_crest_url?: string | null
  away_crest_url?: string | null
  /** Committed model prediction (joined server-side); the honest pre-match fallback. */
  ai_home_prob?: number
  ai_draw_prob?: number
  ai_away_prob?: number
  ai_confidence?: number
  predicted_scoreline?: string
}

/** A normalised three-way outcome split, each 0..1. */
export interface OutcomeProbs {
  home: number
  draw: number
  away: number
}

/**
 * Coerce the mixed `minute` field (a number, `"HT"`, `"45+2"`, or a raw clock
 * string) into a plain minute the kernel can continue from. Returns `null` when
 * the clock is unreadable — the engine then does not run for that fixture.
 */
export function coerceMinute(raw: number | string | undefined | null): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(120, Math.floor(raw)))
  }
  if (typeof raw === 'string') {
    const up = raw.trim().toUpperCase()
    if (up.startsWith('HT')) return 45
    if (up === 'FT') return 90
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) return Math.max(0, Math.min(120, n))
  }
  return null
}

/**
 * Build the kernel continuation state for a LIVE fixture. The public feed has no
 * card events, so red cards default to 0 (the deep match page carries the exact
 * count); the engine still gives an honest score-and-clock read. Returns `null`
 * when the clock or score is incomplete.
 */
export function toLiveEngineState(match: LiveMatch): EngineForkState | null {
  const minute = coerceMinute(match.minute)
  if (minute == null) return null
  if (typeof match.home_score !== 'number' || typeof match.away_score !== 'number') return null
  return {
    minute,
    homeGoals: Math.max(0, Math.floor(match.home_score)),
    awayGoals: Math.max(0, Math.floor(match.away_score)),
    homeReds: 0,
    awayReds: 0,
  }
}

/** The committed pre-match prediction as an OutcomeProbs, or `null` when absent. */
export function committedProbs(match: LiveMatch): OutcomeProbs | null {
  const h = match.ai_home_prob
  const d = match.ai_draw_prob
  const a = match.ai_away_prob
  if (
    typeof h !== 'number' ||
    typeof d !== 'number' ||
    typeof a !== 'number' ||
    !Number.isFinite(h + d + a) ||
    h + d + a <= 0
  ) {
    return null
  }
  const total = h + d + a
  return { home: h / total, draw: d / total, away: a / total }
}
