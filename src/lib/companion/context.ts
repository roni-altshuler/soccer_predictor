/**
 * Pitchverse Companion — the context model.
 *
 * The Companion is the app-wide interpretation layer: one AI surface that
 * follows the fan instead of three siloed ones (Boardroom on the prediction
 * tab, Ask at /almanac, the Story on finished-match pages). For that to work,
 * every page must be able to say *where the fan is* in a single typed value,
 * and every capability must be able to decide — from that value alone —
 * whether it has anything honest to offer.
 *
 * That value is `CompanionContext`: a discriminated union, deliberately small,
 * and carrying only what a page already knows. It never carries model output.
 *
 * Pure and dependency-free (no fs, no React) so the client rail, the Node API
 * route, and the unit tests can all import it. Anything that needs to read an
 * artifact belongs behind a route, per VISION_2030 §6 — *products talk to
 * artifacts, never models*.
 */

import type { Universe } from '@/lib/ask/schema'

import type { MatchAnchor } from './anchor'

/** Where a match is in its lifecycle. Mirrors the app's status vocabulary. */
export type MatchPhase = 'scheduled' | 'live' | 'finished'

export interface MatchContext {
  kind: 'match'
  matchId: string
  home: string
  away: string
  /** Canonical `competition_id`, e.g. `eng.1`. */
  competitionId: string
  gender: Universe
  phase: MatchPhase
  /**
   * Live or final score. Null while scheduled — a scheduled match has no
   * state to interpret, and inventing 0-0 would make the rarity capability
   * answer a question nobody asked.
   */
  homeScore: number | null
  awayScore: number | null
  /** Clock minute for live matches; null otherwise. */
  minute: number | null
  /**
   * Whether this match has minute-level event coverage. Gates every timeline
   * capability (story, similar matches, forks) — the warehouse only covers
   * 35,463 matches and the rest have no timeline anywhere.
   */
  hasEventCoverage: boolean
  /**
   * For finished matches: the moment worth asking about (see `anchor.ts`).
   * Full time has no question in it, so without this a finished match gets no
   * contextual prompts at all. Null when the match passed through no state
   * worth quoting — a goalless draw, or no verified timeline.
   */
  anchor?: MatchAnchor | null
}

export interface TeamContext {
  kind: 'team'
  teamId: string
  name: string
  gender: Universe
  competitionId: string | null
}

export interface LeagueContext {
  kind: 'league'
  competitionId: string
  gender: Universe
}

/** The /live page: a universe of in-flight matches, no single subject. */
export interface LiveContext {
  kind: 'live'
  gender: Universe
}

/** Anywhere else. The Companion still works, just without a subject. */
export interface GlobalContext {
  kind: 'global'
  gender: Universe
}

export type CompanionContext =
  | MatchContext
  | TeamContext
  | LeagueContext
  | LiveContext
  | GlobalContext

export const GLOBAL_CONTEXT: GlobalContext = { kind: 'global', gender: 'M' }

// -- narrowing helpers (keep capability predicates readable) --

export function isMatch(ctx: CompanionContext): ctx is MatchContext {
  return ctx.kind === 'match'
}

export function isLeague(ctx: CompanionContext): ctx is LeagueContext {
  return ctx.kind === 'league'
}

export function isTeam(ctx: CompanionContext): ctx is TeamContext {
  return ctx.kind === 'team'
}

/**
 * A match has an interpretable *state* only when we know the score. Live and
 * finished matches qualify; scheduled ones do not. Several capabilities key
 * off exactly this, so it gets a name rather than being re-derived.
 */
export function hasScoreState(ctx: CompanionContext): ctx is MatchContext {
  return isMatch(ctx) && ctx.homeScore !== null && ctx.awayScore !== null
}

/**
 * Timeline capabilities additionally need the match to be *covered* — the
 * event backfill either verified this match's minute-level timeline or it
 * didn't, and there is no half-measure. See docs/ROADMAP.md Phase 0.
 */
export function hasTimeline(ctx: CompanionContext): ctx is MatchContext {
  return isMatch(ctx) && ctx.hasEventCoverage
}

/** The subject line the Companion shows above its capability list. */
export function contextLabel(ctx: CompanionContext): string {
  switch (ctx.kind) {
    case 'match':
      return `${ctx.home} v ${ctx.away}`
    case 'team':
      return ctx.name
    case 'league':
      return ctx.competitionId
    case 'live':
      return 'Live now'
    case 'global':
      return 'Pitchverse'
  }
}

/**
 * Coerce loosely-typed page data (props, query strings, JSON bodies) into a
 * context, or fall back to global. Never throws: a malformed context must
 * degrade the Companion to its universal capabilities, never break the page
 * it is mounted on.
 */
/** An anchor is all-or-nothing: a partial one would ask about a fake state. */
function normalizeAnchor(raw: unknown): MatchAnchor | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const fin = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const minute = fin(o.minute)
  const homeScore = fin(o.homeScore)
  const awayScore = fin(o.awayScore)
  if (minute === null || homeScore === null || awayScore === null) return null
  return { minute, homeScore, awayScore }
}

export function normalizeContext(raw: unknown): CompanionContext {
  if (!raw || typeof raw !== 'object') return GLOBAL_CONTEXT
  const o = raw as Record<string, unknown>
  const gender: Universe = o.gender === 'F' ? 'F' : 'M'

  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  switch (o.kind) {
    case 'match': {
      const matchId = str(o.matchId)
      const home = str(o.home)
      const away = str(o.away)
      if (!matchId || !home || !away) return { kind: 'global', gender }
      const phase: MatchPhase =
        o.phase === 'live' || o.phase === 'finished' ? o.phase : 'scheduled'
      return {
        kind: 'match',
        matchId,
        home,
        away,
        competitionId: str(o.competitionId) ?? '',
        gender,
        phase,
        homeScore: num(o.homeScore),
        awayScore: num(o.awayScore),
        minute: num(o.minute),
        hasEventCoverage: o.hasEventCoverage === true,
        anchor: normalizeAnchor(o.anchor),
      }
    }
    case 'team': {
      const teamId = str(o.teamId)
      const name = str(o.name)
      if (!teamId || !name) return { kind: 'global', gender }
      return { kind: 'team', teamId, name, gender, competitionId: str(o.competitionId) }
    }
    case 'league': {
      const competitionId = str(o.competitionId)
      if (!competitionId) return { kind: 'global', gender }
      return { kind: 'league', competitionId, gender }
    }
    case 'live':
      return { kind: 'live', gender }
    default:
      return { kind: 'global', gender }
  }
}
