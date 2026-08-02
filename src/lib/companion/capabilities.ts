/**
 * Pitchverse Companion — the capability registry.
 *
 * VISION_2030 §1 sets an identity test for every feature: *which verb is it?*
 * Predict (what will happen), Explain (why), Retrieve (has this happened
 * before), Counterfact (what could have happened instead). This module makes
 * that test executable — the Companion groups what it offers by verb, so a fan
 * meets the four verbs directly rather than meeting a menu of page names.
 *
 * Every entry points at something that ALREADY EXISTS on `main`. The registry
 * is a router over shipped surfaces, not a wishlist; adding an entry for
 * something unbuilt would put a dead link in the one surface meant to make the
 * app feel coherent.
 *
 * HONESTY RULE (inherited from VISION_2030 §9 and the rarity/boardroom
 * modules): `availableIn` returns false unless the context *proves* the
 * backing data exists. A capability that can't be honestly offered is absent —
 * never greyed out with a teaser, never a placeholder. The two gates that do
 * most of the work: `hasScoreState` (a scheduled match has no state to
 * interpret) and `hasTimeline` (only the 35,463 covered matches have a
 * minute-level timeline anywhere).
 *
 * Pure and dependency-free — importable by the client rail and the API route.
 */

import { WHATIF_TAB } from '@/components/match/detail/counterfactual'

import {
  hasScoreState,
  hasTimeline,
  isLeague,
  isMatch,
  isTeam,
  type CompanionContext,
} from './context'

/** The four verbs. Order is the order the Companion renders them in. */
export const VERBS = ['predict', 'explain', 'retrieve', 'counterfact'] as const
export type Verb = (typeof VERBS)[number]

export const VERB_LABELS: Record<Verb, string> = {
  predict: 'Predict',
  explain: 'Explain',
  retrieve: 'Retrieve',
  counterfact: 'Counterfact',
}

/** What each verb promises, in a fan's language. Shown as the group subtitle. */
export const VERB_BLURBS: Record<Verb, string> = {
  predict: 'What happens next',
  explain: 'Why the model thinks so',
  retrieve: 'When this happened before',
  counterfact: 'What could have happened instead',
}

export interface Capability {
  id: string
  verb: Verb
  label: string
  /** One line of plain language. No provider or algorithm names (CLAUDE.md). */
  hint: string
  /** True only when the context proves this capability has real data behind it. */
  availableIn: (ctx: CompanionContext) => boolean
  /** Deep link that lands the fan exactly on the surface, context preserved. */
  href: (ctx: CompanionContext) => string
}

const matchTab = (matchId: string, tab: string) =>
  `/matches/${encodeURIComponent(matchId)}?tab=${tab}`

export const CAPABILITIES: Capability[] = [
  // ---------------------------------------------------------------- predict
  {
    id: 'match-prediction',
    verb: 'predict',
    label: 'The model read on this match',
    hint: 'Outcome split, scoreline and the factors behind it',
    availableIn: isMatch,
    href: (ctx) => (isMatch(ctx) ? matchTab(ctx.matchId, 'prediction') : '/predict'),
  },
  {
    id: 'live-winprob',
    verb: 'predict',
    label: 'Live win probability',
    hint: 'Recomputed from the score and the clock as the match moves',
    // Only meaningful while the match is actually running.
    availableIn: (ctx) => isMatch(ctx) && ctx.phase === 'live',
    href: (ctx) => (isMatch(ctx) ? matchTab(ctx.matchId, 'overview') : '/live'),
  },
  {
    id: 'live-hub',
    verb: 'predict',
    label: 'Everything live right now',
    hint: 'Every in-flight match with the model read alongside',
    availableIn: () => true,
    href: () => '/live',
  },
  {
    id: 'custom-predict',
    verb: 'predict',
    label: 'Predict any two teams',
    hint: 'Build a fixture that is not on the calendar',
    availableIn: () => true,
    href: (ctx) => (isTeam(ctx) ? `/predict?team=${encodeURIComponent(ctx.name)}` : '/predict'),
  },
  {
    id: 'simulate-season',
    verb: 'predict',
    label: 'Simulate the rest of the season',
    hint: 'Final tables over thousands of runs',
    availableIn: (ctx) => isLeague(ctx) || isTeam(ctx),
    href: (ctx) =>
      isLeague(ctx) ? `/leagues/${encodeURIComponent(ctx.competitionId)}` : '/simulator',
  },

  // ---------------------------------------------------------------- explain
  {
    id: 'boardroom',
    verb: 'explain',
    label: 'The panel debate',
    hint: 'Three analysts argue the call, and you see how far apart they are',
    // The debate artifact is generated per-match at pipeline time; a match
    // without an entry resolves to null upstream, so gate on the same thing
    // that makes a prediction meaningful at all.
    availableIn: isMatch,
    href: (ctx) => (isMatch(ctx) ? matchTab(ctx.matchId, 'prediction') : '/'),
  },
  {
    id: 'match-story',
    verb: 'explain',
    label: 'The story of this match',
    hint: 'The match retold as acts and turning points, each one counted',
    availableIn: (ctx) => hasTimeline(ctx) && ctx.phase === 'finished',
    href: (ctx) => (isMatch(ctx) ? matchTab(ctx.matchId, 'overview') : '/'),
  },
  {
    id: 'justice-ledger',
    verb: 'explain',
    label: 'Who deserved what',
    hint: 'The table reordered by the points performances merited',
    availableIn: isLeague,
    href: (ctx) => (isLeague(ctx) ? `/leagues/${encodeURIComponent(ctx.competitionId)}` : '/'),
  },
  {
    id: 'track-record',
    verb: 'explain',
    label: 'How well these calls hold up',
    hint: 'The full scored record, wins and misses alike',
    availableIn: () => true,
    href: () => '/accuracy',
  },

  // --------------------------------------------------------------- retrieve
  {
    id: 'rarity',
    verb: 'retrieve',
    label: 'How rare is this scoreline',
    hint: 'The exact count of matches that reached this same state',
    availableIn: hasScoreState,
    href: (ctx) => (isMatch(ctx) ? matchTab(ctx.matchId, 'overview') : '/almanac'),
  },
  {
    id: 'similar-matches',
    verb: 'retrieve',
    label: 'Matches that unfolded like this',
    hint: 'Past matches with the same shape, not just the same score',
    availableIn: (ctx) => hasTimeline(ctx) && ctx.phase === 'finished',
    href: (ctx) => (isMatch(ctx) ? matchTab(ctx.matchId, 'overview') : '/almanac'),
  },
  {
    id: 'head-to-head',
    verb: 'retrieve',
    label: 'The head-to-head',
    hint: 'Every previous meeting between these two',
    availableIn: isMatch,
    href: (ctx) => (isMatch(ctx) ? matchTab(ctx.matchId, 'h2h') : '/'),
  },
  {
    id: 'almanac',
    verb: 'retrieve',
    label: 'Ask the history anything',
    hint: 'Plain-English question, exact count and the matches behind it',
    availableIn: () => true,
    href: () => '/almanac',
  },
  {
    id: 'prediction-record',
    verb: 'retrieve',
    label: 'Every call ever made',
    hint: 'The full ledger, filterable and settled',
    availableIn: () => true,
    href: () => '/history',
  },

  // ------------------------------------------------------------ counterfact
  {
    id: 'fork-match',
    verb: 'counterfact',
    label: 'Fork this match',
    hint: 'Undo a goal or branch at any minute and watch it play out again',
    // The What if tab only exists for finished matches the fork engine
    // accepted; mirroring that gate keeps the Companion from linking to a tab
    // that silently falls back to Overview.
    availableIn: (ctx) => hasTimeline(ctx) && ctx.phase === 'finished',
    href: (ctx) => (isMatch(ctx) ? matchTab(ctx.matchId, WHATIF_TAB) : '/'),
  },
  {
    id: 'universe-browser',
    verb: 'counterfact',
    label: 'Browse the other seasons',
    hint: 'Walk the simulated seasons where it went differently',
    // The live hub, like global, has no single subject — a fine place to offer
    // the seasons that went differently, so publishing a live context never
    // loses this next to the global default.
    availableIn: (ctx) => isLeague(ctx) || ctx.kind === 'global' || ctx.kind === 'live',
    href: (ctx) =>
      isLeague(ctx) ? `/leagues/${encodeURIComponent(ctx.competitionId)}` : '/simulator',
  },
]

/** Every capability that is honestly available in this context. */
export function capabilitiesFor(ctx: CompanionContext): Capability[] {
  return CAPABILITIES.filter((c) => c.availableIn(ctx))
}

export interface VerbGroup {
  verb: Verb
  label: string
  blurb: string
  capabilities: Capability[]
}

/**
 * Available capabilities grouped by verb, in `VERBS` order. Verbs with nothing
 * to offer in this context are omitted entirely — an empty "Counterfact" header
 * on a scheduled match is exactly the placeholder the honesty rule forbids.
 */
export function groupedCapabilitiesFor(ctx: CompanionContext): VerbGroup[] {
  const available = capabilitiesFor(ctx)
  return VERBS.map((verb) => ({
    verb,
    label: VERB_LABELS[verb],
    blurb: VERB_BLURBS[verb],
    capabilities: available.filter((c) => c.verb === verb),
  })).filter((g) => g.capabilities.length > 0)
}
