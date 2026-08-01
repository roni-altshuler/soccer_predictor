/**
 * Ask Pitchverse — wire types shared between the Node API route and the client.
 *
 * Pure and dependency-free (no fs, no React) so a client component can
 * `import type` these without pulling the filesystem-bound compute into the
 * browser bundle.
 */

import { type AskIntent, type AskOutcome, type Universe } from './schema'

export interface AskPrecedent {
  match_id: string
  home: string
  away: string
  final_score: string
  date: string
  competition_id: string
  side: 'home' | 'away'
  outcome: 'w' | 'd'
}

export interface AskNumbers {
  n: number
  w: number
  d: number
  l: number
  winRate: number
  drawRate: number
  lossRate: number
  avoidDefeatRate: number
  focusCount: number
  focusRate: number
}

/** One point on the focus-rate-vs-minute trajectory (real states only). */
export interface CurvePoint {
  minute: number
  rate: number
  n: number
}

export interface ChartSpec {
  wdl: { n: number; w: number; d: number; l: number }
  focus: AskOutcome
  focusLabel: string
  curve: { points: CurvePoint[]; markMinute: number }
}

export interface AskAnswer {
  numbers: AskNumbers
  /** Templated, verifier-passed plain-language sentences. */
  narration: string[]
  headline: { valuePct: number; label: string } | null
  precedents: AskPrecedent[]
  thin: boolean
}

export interface AskProvenance {
  sampleSize: number
  basis: Universe
  matchesCovered: number
  stateKey: string
}

/**
 * How the intent was obtained.
 * - `llm`           — the model mapped free text onto the schema.
 * - `deterministic` — the built-in pattern parser resolved it, no key needed.
 * - `cap`           — a key exists but the call was rate/quota-gated; parsed locally.
 * - `context`       — the page supplied the state directly (Companion), so there
 *                     was nothing to parse and no model was consulted at all.
 */
export type AskSource = 'llm' | 'deterministic' | 'cap' | 'context'

export interface AskResponse {
  supported: boolean
  source: AskSource
  /** The normalized question echoed back. */
  question: string
  intent?: AskIntent
  answer?: AskAnswer
  chartSpec?: ChartSpec
  provenance?: AskProvenance
  reason?: 'need_minute' | 'out_of_domain'
  /** Example in-domain questions, always present for the UI to offer. */
  examples: string[]
}
