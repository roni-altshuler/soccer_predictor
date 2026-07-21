/**
 * Ask Pitchverse — deterministic (no-LLM) question parser.
 *
 * Maps a free-text football question onto the constrained `AskIntent` schema
 * using pattern rules only. This is the floor the feature stands on: it ships
 * fully functional with NO api key, and it is the safe degrade path when the
 * LLM is rate-limited, over its daily cap, or erroring. The LLM (when present)
 * simply understands messier phrasings and lands on the *same* schema.
 *
 * Honesty by construction: a question only resolves if it names a match state
 * (a deficit / lead / level) AND a time. Missing time → `need_minute`; no state
 * at all → `out_of_domain`. It never guesses a rate, a team, or a fact — its
 * only output is which cell of the exact-count grid to read.
 *
 * Pure: no fs, no network, no React. Heavily unit-tested.
 */

import {
  type AskIntent,
  type AskOutcome,
  type Universe,
  normalizeIntent,
} from './schema'

export interface ParsedIntent {
  supported: true
  intent: AskIntent
  /** `low` when a value (usually magnitude) had to be defaulted rather than read. */
  confidence: 'high' | 'low'
}

export interface ParseRefusal {
  supported: false
  /** `need_minute`: a state was found but no time. `out_of_domain`: no state. */
  reason: 'need_minute' | 'out_of_domain'
}

export type DeterministicParse = ParsedIntent | ParseRefusal

/** Lowercase, unify quotes/dashes, collapse whitespace. Used for parsing + cache keys. */
export function normalizeQuestion(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

// -- gender ------------------------------------------------------------------

const WOMEN_RE = /\b(women'?s?|womens|female|ladies|wsl|nwsl|w-?league|feminine|feminin)\b/

function extractGender(q: string): Universe {
  return WOMEN_RE.test(q) ? 'F' : 'M'
}

// -- match state (diff) ------------------------------------------------------

const LEVEL_RE =
  /\b(level|all square|tied|deadlocked|goalless|scoreless|nil[-\s]?nil|0[-\s]?0|even at|tied at|dead even)\b/

const TRAIL_RE =
  /\b(down|behind|trailing|trail|losing|deficit|chasing|adrift|comeback|come back|came back|fight back|fought back|claw|clawed|clawing|recover|recovering)\b/
const LEAD_RE =
  /\b(up|ahead|leading|lead|leads|winning|in front|advantage|hold on|holding|protect(?:ing)?|see it out|see out|hang on|nose in front|noses ahead)\b/

const NUM_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  single: 1,
  two: 2,
  couple: 2,
  pair: 2,
  brace: 2,
  double: 2,
  three: 3,
  four: 3,
  five: 3,
  six: 3,
}

function wordToMag(token: string): number {
  const t = token.trim()
  const asNum = Number.parseInt(t, 10)
  if (Number.isFinite(asNum)) return Math.min(3, Math.max(1, asNum))
  return Math.min(3, Math.max(1, NUM_WORDS[t] ?? 1))
}

/**
 * The magnitude of the goal gap, or `null` if none is stated. `assumed` is set
 * when a direction is present but the count wasn't (e.g. bare "behind"), so the
 * caller can flag lower confidence — the resolved state is always echoed back
 * to the user regardless.
 */
function extractMagnitude(q: string): { mag: number; assumed: boolean } | null {
  const patterns: RegExp[] = [
    /\b(one|two|three|four|five|six|\d+)[-\s]?goals?\b/, // "two goals", "3-goal"
    /\bby\s+(one|two|three|four|five|six|\d+)\b/, // "by two", "by 2"
    /\b(one|two|three|four|five|six|\d+)[-\s](?:goals?\s+)?(?:down|up|behind|ahead|clear|in front)\b/, // "two down", "2 up"
    /\b(one|two|three|four|five|six|\d+)[-\s]?nil\b/, // "two nil"
    /\b(a|single|one)\s+goal\b/, // "a goal (down|up|behind)"
    /\b(brace|couple|double|pair)\b/, // "a brace up"
  ]
  for (const re of patterns) {
    const m = q.match(re)
    if (m) return { mag: wordToMag(m[1] ?? m[0]), assumed: false }
  }
  return null
}

function directionSign(q: string): number {
  const trail = TRAIL_RE.test(q)
  const lead = LEAD_RE.test(q)
  if (trail && !lead) return -1
  if (lead && !trail) return 1
  if (trail && lead) {
    // Both cues present — the comeback framing wins ("leader ... clawed back").
    return /\b(comeback|come back|came back|fight back|fought back|claw|recover)\b/.test(q) ||
      /\bfrom\b/.test(q)
      ? -1
      : 1
  }
  return 0
}

/** Signed, clamped score difference from the queried side's view, or `null`. */
function extractDiff(q: string): { diff: number; assumed: boolean } | null {
  if (LEVEL_RE.test(q)) return { diff: 0, assumed: false }

  // Explicit scoreline: "2-0 down", "down 3-1", "from 2-0".
  const sc = q.match(/\b(\d+)\s*-\s*(\d+)\b/)
  if (sc) {
    const a = Number.parseInt(sc[1], 10)
    const b = Number.parseInt(sc[2], 10)
    if (a === b) return { diff: 0, assumed: false }
    const gap = Math.min(3, Math.abs(a - b))
    const sign = directionSign(q)
    // No explicit direction ⇒ read a bare scoreline as the deficit to overcome.
    return { diff: (sign !== 0 ? sign : -1) * gap, assumed: sign === 0 }
  }

  const mag = extractMagnitude(q)
  const sign = directionSign(q)
  if (mag && sign !== 0) return { diff: sign * mag.mag, assumed: mag.assumed }
  // A direction with no stated count — default to one goal, flagged assumed.
  if (!mag && sign !== 0) return { diff: sign * 1, assumed: true }
  return null
}

// -- minute ------------------------------------------------------------------

/** Blank the goal-count fragments so the minute scan can't read their digits. */
function stripStateTokens(q: string): string {
  return q
    .replace(/\b\d+\s*-\s*\d+\b/g, ' ')
    .replace(/\b(?:one|two|three|four|five|six|\d+)[-\s]?goals?\b/g, ' ')
    .replace(/\b(?:one|two|three|four|five|six|\d+)[-\s]?nil\b/g, ' ')
    .replace(/\bby\s+(?:one|two|three|four|five|six|\d+)\b/g, ' ')
}

function clampMinute(n: number): number | null {
  if (!Number.isFinite(n) || n < 0 || n > 120) return null
  return n
}

/** Minute of the match, floored later onto the 5-min grid, or `null` if unstated. */
function extractMinute(qRaw: string): number | null {
  const q = stripStateTokens(qRaw)

  if (/\b(half[-\s]?time|halftime|the break|at the half|the interval|stroke of half)\b/.test(q)) return 45
  if (/\b(hour mark|the hour)\b/.test(q)) return 60
  if (/\b(kick[-\s]?off|from the start|the very start|the opening|the outset)\b/.test(q)) return 0
  if (/\b(full[-\s]?time|final whistle|stoppage|injury time|added time|the death|dying (minutes|seconds))\b/.test(q))
    return 90

  // "with N minutes left / to go / remaining / to play"
  let m = q.match(/\b(\d{1,3})\s*(?:mins?|minutes?)?\s*(?:left|to go|remaining|to play|left to play|from time)\b/)
  if (m) {
    const left = clampMinute(Number.parseInt(m[1], 10))
    if (left !== null) return Math.max(0, 90 - left)
  }
  m = q.match(/\bwith\s+(\d{1,3})\b(?![^]*?\bgoals?\b)/)
  if (m && /\bleft|to go|remaining|to play\b/.test(q)) {
    const left = clampMinute(Number.parseInt(m[1], 10))
    if (left !== null) return Math.max(0, 90 - left)
  }

  // "70'"
  m = q.match(/\b(\d{1,3})\s*['’]/)
  if (m) return clampMinute(Number.parseInt(m[1], 10))
  // "70th minute", "70-minute mark"
  m = q.match(/\b(\d{1,3})(?:st|nd|rd|th)?[-\s]?(?:minute|min)\b/)
  if (m) return clampMinute(Number.parseInt(m[1], 10))
  // "minute 70"
  m = q.match(/\bminute\s+(\d{1,3})\b/)
  if (m) return clampMinute(Number.parseInt(m[1], 10))
  // "70 minutes" (not "... left/to go" — handled above)
  m = q.match(/\b(\d{1,3})\s*(?:mins?|minutes?)\b/)
  if (m) return clampMinute(Number.parseInt(m[1], 10))
  // "at 70", "by the 80th", "after 75", "on the 60th" — anchored, guarded.
  m = q.match(/\b(?:at|by|after|around|on|in)\s+(?:the\s+)?(\d{1,3})(?:st|nd|rd|th)?\b(?!\s*(?:half|goals?|nil))/)
  if (m) return clampMinute(Number.parseInt(m[1], 10))

  return null
}

// -- outcome (which figure leads) --------------------------------------------

function extractOutcome(q: string): AskOutcome {
  // Order matters: "avoid losing" must beat the raw loss test.
  if (
    /\b(avoid(?:ing)? defeat|avoid(?:ing)? losing|avoid a loss|not lose|not to lose|don'?t lose|does ?n'?t lose|stay unbeaten|stays unbeaten|remain unbeaten|unbeaten|at least a (?:draw|point)|escape with|hold on for a (?:draw|point)|not get beaten|not be beaten|how safe|is that lead safe|secure the point|hang on for a (?:draw|point))\b/.test(
      q
    )
  ) {
    return 'avoid_defeat'
  }
  if (
    /\b(end (?:in a draw|level|all square)|finish (?:level|all square|in a draw)|draw the (?:match|game)|end up (?:drawing|level)|share the (?:points|spoils)|settle for a draw|come back to draw|rescue a (?:draw|point)|salvage a (?:draw|point)|to draw|still draw|\bdraws?\b)\b/.test(
      q
    )
  ) {
    return 'draw'
  }
  if (
    /\b(lose|lost|losing|throw (?:it |the lead )?away|thrown away|throw away|blow (?:the|a) lead|blew (?:the|a) lead|beaten|get beat|gets beat|collapse|collapsed|surrender the lead|concede the lead|end up losing|go on to lose|bottle)\b/.test(
      q
    )
  ) {
    return 'loss'
  }
  return 'win'
}

// -- top-level ----------------------------------------------------------------

/**
 * Parse a natural-language question into a supported `AskIntent` or a typed
 * refusal. Never throws.
 */
export function parseQuestion(raw: string): DeterministicParse {
  const q = normalizeQuestion(raw)
  if (!q) return { supported: false, reason: 'out_of_domain' }

  const state = extractDiff(q)
  if (!state) return { supported: false, reason: 'out_of_domain' }

  const minute = extractMinute(q)
  if (minute === null) return { supported: false, reason: 'need_minute' }

  const gender = extractGender(q)
  const outcome = extractOutcome(q)

  const intent = normalizeIntent({ gender, diff: state.diff, minute, outcome })
  if (!intent) return { supported: false, reason: 'out_of_domain' }

  return { supported: true, intent, confidence: state.assumed ? 'low' : 'high' }
}
