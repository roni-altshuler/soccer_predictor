/**
 * Pitchverse Companion — turning page context into an answerable question.
 *
 * Ask Pitchverse answers questions of one exact shape: *a side at score
 * difference D, at minute M, in universe G — how often does outcome O follow?*
 * (`AskIntent`). Today a fan has to spell all of that out at /almanac, even
 * while standing on the very match page that already knows every field.
 *
 * This module closes that gap. When the page supplies the state, there is
 * nothing left to parse — so the Companion skips the language model entirely
 * and computes the exact count directly. The LLM's job in this codebase has
 * always been to *parse, never to supply a figure*; context that is already
 * structured needs no parser at all. Contextual answers are therefore free,
 * instant, deterministic, and immune to quota exhaustion.
 *
 * Pure and dependency-free.
 */

import { clampDiff, minuteBucket, type AskIntent, type AskOutcome } from '@/lib/ask/schema'

import { isMatch, type CompanionContext, type MatchContext } from './context'

/** Which side the question is asked from. */
export type Side = 'home' | 'away'

export interface DeriveOptions {
  /**
   * Whose perspective. Defaults to the *trailing* side, because that is the
   * question people actually ask ("can they still come back?"). Level matches
   * default to home.
   */
  side?: Side | 'trailing'
  outcome?: AskOutcome
  /**
   * Override the clock. Required for finished matches — see the gate in
   * `deriveAskIntent`.
   */
  minute?: number
}

/** The side currently behind, or `home` when the match is level. */
export function trailingSide(ctx: MatchContext): Side {
  const home = ctx.homeScore ?? 0
  const away = ctx.awayScore ?? 0
  // Whoever is BEHIND, not whoever is ahead. Level falls through to home.
  return home > away ? 'away' : 'home'
}

/** Signed goal difference from `side`'s point of view. */
export function diffFor(ctx: MatchContext, side: Side): number {
  const home = ctx.homeScore ?? 0
  const away = ctx.awayScore ?? 0
  return side === 'home' ? home - away : away - home
}

/**
 * The context's question, or `null` when the context cannot honestly pose one.
 *
 * Two gates, both deliberate:
 *
 * 1. **No score, no question.** A scheduled match has no state; asking "how
 *    often does a side at 0-0 in minute 0 win" is a league base rate wearing a
 *    match's clothes, and presenting it as being *about this match* would be a
 *    small lie told confidently.
 * 2. **A finished match needs an explicit minute.** At full time the outcome
 *    is known, so a terminal-state rarity query answers a question nobody has
 *    — the interesting question is always "at minute M, what were the odds?".
 *    Callers scrubbing a finished timeline pass `minute`; without one we
 *    decline rather than return something vacuous.
 */
export function deriveAskIntent(
  ctx: CompanionContext,
  opts: DeriveOptions = {}
): AskIntent | null {
  if (!isMatch(ctx)) return null
  if (ctx.homeScore === null || ctx.awayScore === null) return null

  const minuteRaw = opts.minute ?? (ctx.phase === 'live' ? ctx.minute : null)
  if (minuteRaw === null || !Number.isFinite(minuteRaw)) return null

  const side: Side = opts.side === 'trailing' || !opts.side ? trailingSide(ctx) : opts.side

  return {
    gender: ctx.gender,
    diff: clampDiff(diffFor(ctx, side)),
    minute: minuteBucket(minuteRaw),
    outcome: opts.outcome ?? 'win',
  }
}

/** The team name the derived intent speaks for. */
export function subjectOf(ctx: MatchContext, side: Side): string {
  return side === 'home' ? ctx.home : ctx.away
}

/**
 * A contextual prompt: the question the Companion offers as a one-tap chip,
 * already resolved to a computable intent. `label` names the real teams, so
 * the fan sees their match — not a generic textbook phrasing.
 */
export interface ContextualPrompt {
  id: string
  label: string
  intent: AskIntent
}

/**
 * The questions worth offering for this exact match state. Empty when the
 * context can't pose one — the caller renders nothing rather than falling back
 * to the generic /almanac examples, which would read as if they were about
 * this match.
 */
export function contextualPrompts(
  ctx: CompanionContext,
  opts: { minute?: number } = {}
): ContextualPrompt[] {
  if (!isMatch(ctx)) return []

  const base = deriveAskIntent(ctx, { side: 'trailing', minute: opts.minute })
  if (!base) return []

  const side = trailingSide(ctx)
  const subject = subjectOf(ctx, side)
  const other = subjectOf(ctx, side === 'home' ? 'away' : 'home')
  const behind = Math.abs(base.diff)
  const prompts: ContextualPrompt[] = []

  if (base.diff < 0) {
    prompts.push({
      id: 'comeback',
      label: `Can ${subject} come back from ${behind} down at ${base.minute}'?`,
      intent: { ...base, outcome: 'win' },
    })
    prompts.push({
      id: 'rescue-point',
      label: `Do sides in ${subject}'s position at least take a point?`,
      intent: { ...base, outcome: 'avoid_defeat' },
    })
    // The same state seen from the other bench. `base` is always derived from
    // the trailing side, so the leader's view is this mirrored intent — there
    // is no third "we are ahead" branch to write, and adding one would be
    // unreachable code in a registry whose value is that everything in it is real.
    prompts.push({
      id: 'hold-on',
      label: `How safe is ${other}'s ${behind}-goal lead?`,
      intent: { ...base, diff: clampDiff(-base.diff), outcome: 'win' },
    })
    prompts.push({
      id: 'throw-away',
      label: `How often is a ${behind}-goal lead at ${base.minute}' thrown away?`,
      intent: { ...base, diff: clampDiff(-base.diff), outcome: 'loss' },
    })
  } else {
    prompts.push({
      id: 'break-deadlock',
      label: `Level at ${base.minute}' — how often does someone still win?`,
      intent: { ...base, outcome: 'win' },
    })
    prompts.push({
      id: 'stays-level',
      label: `How often does level at ${base.minute}' finish level?`,
      intent: { ...base, outcome: 'draw' },
    })
  }

  return prompts
}
