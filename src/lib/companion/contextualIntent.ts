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
 * The state a question is asked about: the live state, an explicitly scrubbed
 * minute, or a finished match's anchor. Returns the match context rewritten to
 * carry that state's score, so `trailingSide`/`diffFor` speak about the moment
 * being asked about rather than about full time.
 *
 * Shared by `deriveAskIntent` and `contextualPrompts` on purpose — when they
 * resolved the state separately, the prompt labels named the wrong team on any
 * finished match whose lead had changed hands.
 */
export function resolveState(
  ctx: CompanionContext,
  opts: Pick<DeriveOptions, 'minute'> = {}
): { at: MatchContext; minute: number } | null {
  if (!isMatch(ctx)) return null

  let minuteRaw: number | null
  let state: { homeScore: number | null; awayScore: number | null }

  if (opts.minute !== undefined) {
    minuteRaw = opts.minute
    state = ctx
  } else if (ctx.phase === 'live') {
    minuteRaw = ctx.minute
    state = ctx
  } else if (ctx.phase === 'finished' && ctx.anchor) {
    minuteRaw = ctx.anchor.minute
    state = ctx.anchor
  } else {
    return null
  }

  if (state.homeScore === null || state.awayScore === null) return null
  if (minuteRaw === null || !Number.isFinite(minuteRaw)) return null

  return {
    at: { ...ctx, homeScore: state.homeScore, awayScore: state.awayScore },
    minute: minuteRaw,
  }
}

/**
 * The context's question, or `null` when it cannot honestly pose one.
 *
 * Two gates, both deliberate:
 *
 * 1. **No score, no question.** A scheduled match has no state; asking "how
 *    often does a side at 0-0 in minute 0 win" is a league base rate wearing a
 *    match's clothes, and presenting it as being *about this match* would be a
 *    small lie told confidently.
 * 2. **A finished match is asked about at an earlier moment.** At full time
 *    the outcome is known, so a terminal-state query answers nothing. The
 *    question worth asking is "at minute M, what were the odds?" — the
 *    caller's `minute` when scrubbing, otherwise the context's `anchor` (see
 *    `anchor.ts`). With neither, decline rather than say something vacuous.
 */
export function deriveAskIntent(
  ctx: CompanionContext,
  opts: DeriveOptions = {}
): AskIntent | null {
  const resolved = resolveState(ctx, opts)
  if (!resolved) return null

  const { at, minute } = resolved
  const side: Side = opts.side === 'trailing' || !opts.side ? trailingSide(at) : opts.side

  return {
    gender: at.gender,
    diff: clampDiff(diffFor(at, side)),
    minute: minuteBucket(minute),
    outcome: opts.outcome ?? 'win',
  }
}

/** The team name the derived intent speaks for. */
export function subjectOf(ctx: MatchContext, side: Side): string {
  return side === 'home' ? ctx.home : ctx.away
}

/**
 * Possessive form. Club names ending in s take a bare apostrophe — "Vancouver
 * Whitecaps' lead", never "Whitecaps's" — and a great many of them do
 * (Whitecaps, Rangers, Wolves, Spurs, Timbers, Sounders, Rovers).
 */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

/** How football says a deficit: "a goal down", not "1 down". */
function deficitPhrase(goals: number): string {
  return goals === 1 ? 'a goal down' : `${goals} goals down`
}

/** Likewise for a lead: "a one-goal lead" reads worse than "a goal ahead". */
function leadPhrase(goals: number): string {
  return goals === 1 ? 'one-goal' : `${goals}-goal`
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
  const resolved = resolveState(ctx, { minute: opts.minute })
  if (!resolved) return []

  const base = deriveAskIntent(ctx, { side: 'trailing', minute: opts.minute })
  if (!base) return []

  // Name the teams from the RESOLVED state, not from full time — on a finished
  // match the anchor's leader is often not the eventual winner, which is
  // precisely what makes it worth asking about.
  const { at } = resolved
  const side = trailingSide(at)
  const subject = subjectOf(at, side)
  const other = subjectOf(at, side === 'home' ? 'away' : 'home')
  const behind = Math.abs(base.diff)
  const prompts: ContextualPrompt[] = []

  // A finished match is being asked about in the past; a live one is a
  // question about right now. Same counts either way — only the tense moves.
  const over = at.phase === 'finished'

  if (base.diff < 0) {
    prompts.push({
      id: 'comeback',
      label: over
        ? `${subject} were ${deficitPhrase(behind)} at ${base.minute}' — how often does that end in a win?`
        : `Can ${subject} come back from ${deficitPhrase(behind)} at ${base.minute}'?`,
      intent: { ...base, outcome: 'win' },
    })
    prompts.push({
      id: 'rescue-point',
      label: over
        ? 'Do sides in that position at least take a point?'
        : `Do sides in ${possessive(subject)} position at least take a point?`,
      intent: { ...base, outcome: 'avoid_defeat' },
    })
    // The same state seen from the other bench. `base` is always derived from
    // the trailing side, so the leader's view is this mirrored intent — there
    // is no third "we are ahead" branch to write, and adding one would be
    // unreachable code in a registry whose value is that everything in it is real.
    prompts.push({
      id: 'hold-on',
      label: over
        ? `How often did ${possessive(other)} ${leadPhrase(behind)} lead hold?`
        : `How safe is ${possessive(other)} ${leadPhrase(behind)} lead?`,
      intent: { ...base, diff: clampDiff(-base.diff), outcome: 'win' },
    })
    prompts.push({
      id: 'throw-away',
      label: `How often is a ${leadPhrase(behind)} lead at ${base.minute}' thrown away?`,
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
