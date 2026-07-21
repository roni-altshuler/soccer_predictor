/**
 * Ask Pitchverse — deterministic narration + a numeric honesty verifier.
 *
 * Two responsibilities, both pure:
 *
 * 1. `narrate()` turns a computed exact-count result into plain-language
 *    sentences. Templated — every number in the prose is copied straight from
 *    the tally, so the output is honest by construction and costs no quota.
 *
 * 2. `verifyNarration()` is a Node mirror of the Python Boardroom verifier
 *    (`backend/services/llm/grounding.py`): it re-reads a narration string and
 *    rejects it if it states a number absent from the computed result or uses a
 *    banned term (a data-provider name, a model/algorithm name, or betting
 *    vocabulary). Templated prose always passes; the verifier exists so that if
 *    LLM-written narration is ever introduced it is gated the same way, and so
 *    the honesty guarantee is directly testable.
 */

import { type AskIntent, type AskOutcome, THIN_SAMPLE } from './schema'
import { sidePhrase } from './grammar'

export interface AnswerCounts {
  n: number
  w: number
  d: number
  l: number
}

export interface NarrationResult {
  /** The headline figure, already on the 0–100 percent scale (null when n = 0). */
  headline: { valuePct: number; label: string } | null
  /** Ordered plain-language sentences. */
  sentences: string[]
  /** The set of number-string forms the sentences are allowed to contain. */
  allowedKeys: Set<string>
}

// --------------------------------------------------------------------------- #
// Number normalization — a faithful port of grounding.py's key/extract logic.
// --------------------------------------------------------------------------- #

function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return String(parseFloat(v.toPrecision(6)))
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/** Every string form a bundle number could legitimately be written as. */
export function numberKeys(v: number): Set<string> {
  const keys = new Set<string>()
  keys.add(fmt(v))
  keys.add(String(Math.round(v)))
  if (v >= 0 && v <= 1) {
    keys.add(v.toFixed(2))
    keys.add(v.toFixed(3))
    const pct = v * 100
    keys.add(fmt(round1(pct)))
    keys.add(String(Math.round(pct)))
    keys.add(String(Math.floor(pct)))
    keys.add(String(Math.ceil(pct)))
  }
  if (v > 1 && v <= 100) {
    const frac = v / 100
    keys.add(frac.toFixed(2))
    keys.add(frac.toFixed(3))
  }
  return keys
}

const SCORE_RE = /(\d+)\s*[-–]\s*(\d+)/g
const PCT_RE = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi
const NUM_RE = /\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?/g

function toFloat(token: string): number {
  return parseFloat(token.replace(/,/g, ''))
}

/** Every numeric mention in `text`, as raw tokens (percents keep a `%` marker). */
export function extractNumbers(text: string): string[] {
  const tokens: string[] = []
  let remaining = text || ''
  for (const m of remaining.matchAll(SCORE_RE)) {
    tokens.push(m[1], m[2])
  }
  remaining = remaining.replace(SCORE_RE, '  ')
  for (const m of remaining.matchAll(PCT_RE)) {
    tokens.push(m[1] + '%')
  }
  remaining = remaining.replace(PCT_RE, '  ')
  for (const m of remaining.matchAll(NUM_RE)) {
    tokens.push(m[0])
  }
  return tokens
}

function tokenKeys(token: string): Set<string> {
  const isPct = token.endsWith('%')
  const raw = toFloat(isPct ? token.slice(0, -1) : token)
  if (isPct) {
    const keys = new Set<string>([fmt(raw), String(Math.round(raw))])
    keys.add((raw / 100).toFixed(2))
    keys.add((raw / 100).toFixed(3))
    return keys
  }
  return numberKeys(raw)
}

// --------------------------------------------------------------------------- #
// Banned vocabulary (subset of grounding.py's list — the classes that could
// ever surface in football narration: providers, model/algorithm names,
// pipeline plumbing, and betting language). Whole-word, case-insensitive.
// --------------------------------------------------------------------------- #

const BANNED_TERMS = [
  'espn', 'fotmob', 'fbref', 'understat', 'clubelo', 'openfootball', 'opta',
  'gemini', 'groq', 'llama', 'anthropic', 'claude', 'openai', 'gpt', 'mistral',
  'elo', 'poisson', 'dixon-coles', 'dixon coles', 'xgboost', 'pytorch',
  'monte carlo', 'logistic regression', 'neural network', 'neural net',
  'pipeline', 'warehouse', 'calibrator', 'scaler', 'model', 'algorithm',
  'bet', 'bets', 'betting', 'bettor', 'odds', 'bookmaker', 'bookie', 'wager',
  'wagers', 'stake', 'stakes', 'punt', 'accumulator', 'parlay', 'moneyline',
  'handicap',
]

const BANNED_RE = new RegExp(
  '(?<!\\w)(?:' + BANNED_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?!\\w)',
  'gi'
)

export interface VerifyResult {
  ok: boolean
  ungroundedNumbers: string[]
  bannedTerms: string[]
}

/**
 * Reject narration that states a number not in `allowed` or uses a banned term.
 * Mirrors `verify_text` in grounding.py (numbers must resolve to a computed
 * fact; provider/model/betting words are forbidden).
 */
export function verifyNarration(text: string, allowed: Set<string>): VerifyResult {
  const banned = Array.from(text.matchAll(BANNED_RE)).map((m) => m[0])
  const ungrounded: string[] = []
  for (const token of extractNumbers(text)) {
    const keys = tokenKeys(token)
    let grounded = false
    for (const k of keys) {
      if (allowed.has(k)) {
        grounded = true
        break
      }
    }
    if (!grounded) ungrounded.push(token)
  }
  return { ok: banned.length === 0 && ungrounded.length === 0, ungroundedNumbers: ungrounded, bannedTerms: banned }
}

// --------------------------------------------------------------------------- #
// Focus resolution
// --------------------------------------------------------------------------- #

/** The count and rate the question's `outcome` puts in the spotlight. */
export function focusFigure(counts: AnswerCounts, outcome: AskOutcome): { count: number; rate: number } {
  const { n, w, d, l } = counts
  const count =
    outcome === 'win' ? w : outcome === 'avoid_defeat' ? w + d : outcome === 'draw' ? d : l
  return { count, rate: n > 0 ? count / n : 0 }
}

/** The verb-phrase the headline uses for a given outcome and state. */
export function focusLabel(outcome: AskOutcome, diff: number): string {
  switch (outcome) {
    case 'win':
      return diff > 0 ? 'held on to win' : 'went on to win'
    case 'avoid_defeat':
      return 'avoided defeat'
    case 'draw':
      return 'finished level'
    case 'loss':
      return diff > 0 ? 'went on to lose the lead' : 'went on to lose'
  }
}

function focusVerbPhrase(outcome: AskOutcome, diff: number): string {
  switch (outcome) {
    case 'win':
      return diff > 0 ? 'held on to win in' : 'went on to win'
    case 'avoid_defeat':
      return 'avoided defeat in'
    case 'draw':
      return 'finished level in'
    case 'loss':
      return diff > 0 ? 'lost the lead in' : 'went on to lose'
  }
}

function pctStr(rate: number): string {
  return (rate * 100).toFixed(1)
}

function count(n: number): string {
  return n.toLocaleString('en-US')
}

/** Qualitative read (no digits — safe by construction) keyed to the focus rate. */
function readSentence(outcome: AskOutcome, diff: number, rate: number): string {
  if (outcome === 'win' && diff < 0) {
    if (rate < 0.05) return 'A comeback from here is one of football’s genuine rarities.'
    if (rate < 0.2) return 'It does happen — but the balance of history sits firmly against it.'
    return 'From here the deficit is far from decisive; recoveries are common.'
  }
  if (outcome === 'win' && diff > 0) {
    if (rate > 0.9) return 'A lead this size, this late, almost always sees the job through.'
    if (rate > 0.6) return 'The lead usually holds, though it is not a certainty.'
    return 'The lead is live, but plenty of these slip.'
  }
  if (outcome === 'avoid_defeat') {
    if (rate > 0.9) return 'Losing from this position is close to unheard of.'
    if (rate > 0.6) return 'Defeat is the exception rather than the rule from here.'
    return 'Defeat remains a real prospect from this position.'
  }
  if (outcome === 'draw') {
    if (rate > 0.4) return 'The stalemate is a genuinely likely finish from here.'
    return 'More often the game breaks one way or the other.'
  }
  // loss
  if (rate > 0.8) return 'From here the result is, more often than not, already decided.'
  if (rate > 0.4) return 'It is a real risk, though far from a foregone conclusion.'
  return 'It is the exception, not the expectation.'
}

// --------------------------------------------------------------------------- #
// Narration
// --------------------------------------------------------------------------- #

/**
 * Build the plain-language answer for a resolved intent + its exact-count
 * result. Every number is copied from `counts`; the `allowedKeys` it returns
 * are exactly the forms `verifyNarration` will accept.
 */
export function narrate(intent: AskIntent, counts: AnswerCounts): NarrationResult {
  const { n, w, d, l } = counts
  const { outcome, diff } = intent

  const allowedKeys = new Set<string>()
  for (const v of [n, w, d, l, w + d]) {
    for (const k of numberKeys(v)) allowedKeys.add(k)
  }
  if (n > 0) {
    for (const r of [w / n, d / n, l / n, (w + d) / n]) {
      for (const k of numberKeys(r)) allowedKeys.add(k)
    }
  }

  if (n === 0) {
    return {
      headline: null,
      sentences: [
        'This exact situation hasn’t come up in the matches on record — so there’s no rate to report yet.',
      ],
      allowedKeys,
    }
  }

  const { count: focusCount, rate } = focusFigure(counts, outcome)

  const sentences: string[] = []
  sentences.push(
    `Across ${count(n)} such matches, ${sidePhrase(diff)} ${focusVerbPhrase(outcome, diff)} ${count(
      focusCount
    )} (${pctStr(rate)}%).`
  )
  sentences.push(`The full split from that point: ${count(w)} won, ${count(d)} drawn, ${count(l)} lost.`)
  sentences.push(readSentence(outcome, diff, rate))

  if (n < THIN_SAMPLE) {
    sentences.push(
      `Only ${count(n)} such matches are on record, so treat this as indicative rather than settled.`
    )
  }

  return {
    headline: { valuePct: rate * 100, label: focusLabel(outcome, diff) },
    sentences,
    allowedKeys,
  }
}
