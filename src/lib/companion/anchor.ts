/**
 * Pitchverse Companion — choosing the moment a finished match is worth asking about.
 *
 * At full time the result is known, so a rarity count on the terminal state
 * answers a question nobody has ("teams that won, won"). `deriveAskIntent`
 * therefore refuses a finished match outright — correct, but it left the rail
 * empty on the pages fans look at most.
 *
 * The fix is to ask about a moment the match actually passed through. Which
 * moment? The one where what eventually happened looked least likely. That is
 * the whole appeal of an exact-count engine: *"Arsenal were two down at 63'.
 * Four of 252 sides in that position have won."*
 *
 * Selection rule, applied over the states the match really passed through:
 *
 * - When someone won, score each state by how badly the eventual winner was
 *   doing in it. Deepest deficit wins; ties break toward the LATER minute,
 *   because two down at 80' is a better story than two down at 20'.
 * - When it finished level, score by how far from level the match had been —
 *   a side that led at 85' and still drew is the interesting version of a draw.
 *
 * Deliberately NOT a heuristic over win probability: the states come from the
 * verified timeline, so every anchor is a real score at a real minute. A match
 * with no goals yields no anchor at all, which is honest — nothing happened,
 * and "level at 90' finished level" is a tautology, not a finding.
 *
 * Pure and dependency-free. The caller supplies the states so this module
 * stays decoupled from the match-detail timeline types; `reconstructTimeline`
 * already owns own-goal crediting and the final-score reconciliation.
 */

/** A score the match actually held, at the minute it held it. */
export interface TimelineState {
  minute: number
  homeScore: number
  awayScore: number
}

/** The moment the Companion asks about on a finished match. */
export interface MatchAnchor {
  minute: number
  homeScore: number
  awayScore: number
}

/**
 * How surprising this state is, given how the match ended. Higher is more
 * worth asking about. Exported for the tests — the ordering is the product
 * decision, so it should be pinned directly rather than only through
 * `pickAnchor`'s winner.
 */
export function surpriseOf(
  state: TimelineState,
  finalHome: number,
  finalAway: number
): number {
  const lead = state.homeScore - state.awayScore
  if (finalHome > finalAway) return -lead // home won: how far behind were they?
  if (finalAway > finalHome) return lead // away won: mirror.
  return Math.abs(lead) // drawn: how far from level did it get?
}

/**
 * The state worth asking about, or `null` when the match passed through none
 * (a goalless match has no states — see the module note).
 */
export function pickAnchor(
  states: TimelineState[],
  finalHome: number,
  finalAway: number
): MatchAnchor | null {
  let best: TimelineState | null = null
  let bestScore = -Infinity

  for (const state of states) {
    const score = surpriseOf(state, finalHome, finalAway)
    // Strictly-greater keeps the FIRST maximum; the explicit minute comparison
    // is what pushes ties later, so the order of `states` cannot change the
    // answer.
    if (score > bestScore || (score === bestScore && best !== null && state.minute > best.minute)) {
      best = state
      bestScore = score
    }
  }

  if (!best) return null
  return { minute: best.minute, homeScore: best.homeScore, awayScore: best.awayScore }
}

/**
 * Turn an ordered list of post-goal scores into the states the match passed
 * through *before* each goal — the states a question can be asked about. The
 * score after the final goal is the full-time result and is excluded, since
 * that is exactly the terminal state we refuse to quote.
 *
 * `scoresAfter` must be in timeline order; `reconstructTimeline` guarantees it.
 */
export function statesBeforeGoals(
  scoresAfter: Array<{ minute: number; home: number; away: number }>
): TimelineState[] {
  const states: TimelineState[] = []
  let home = 0
  let away = 0
  for (const goal of scoresAfter) {
    states.push({ minute: goal.minute, homeScore: home, awayScore: away })
    home = goal.home
    away = goal.away
  }
  return states
}
