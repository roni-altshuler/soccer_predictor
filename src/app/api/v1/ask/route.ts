import { NextRequest, NextResponse } from 'next/server'

import { computeAnswer } from '@/lib/ask/compute'
import {
  getCachedParse,
  hasGeminiKey,
  llmParse,
  setCachedParse,
  tryConsume,
} from '@/lib/ask/llm'
import { normalizeQuestion, parseQuestion, type DeterministicParse } from '@/lib/ask/parse'
import { EXAMPLE_QUESTIONS } from '@/lib/ask/schema'
import type { AskResponse, AskSource } from '@/lib/ask/types'

/**
 * Ask Pitchverse (Almanac v1) — natural-language front door to the exact-count
 * historical lookup.
 *
 * POST { question } → AskResponse. The LLM (when a key is configured) maps the
 * question onto the constrained intent schema; the deterministic parser is the
 * no-key engine and the safe degrade path. Every NUMBER is computed here from
 * the committed rarity artifact — the LLM never supplies a figure. Node runtime
 * (reads the filesystem via `@/lib/rarity`); do not move to the edge.
 */

const MAX_QUESTION_LEN = 400

const EXAMPLES = EXAMPLE_QUESTIONS.map((e) => e.text)

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'anon'
}

function build(parse: DeterministicParse, source: AskSource, question: string): AskResponse {
  if ('intent' in parse) {
    const { answer, chartSpec, provenance } = computeAnswer(parse.intent)
    return {
      supported: true,
      source,
      question,
      intent: parse.intent,
      answer,
      chartSpec,
      provenance,
      examples: EXAMPLES,
    }
  }
  return { supported: false, source, question, reason: parse.reason, examples: EXAMPLES }
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'expected JSON body { question }' }, { status: 400 })
  }

  const raw = (body as { question?: unknown })?.question
  if (typeof raw !== 'string' || !raw.trim()) {
    return NextResponse.json({ error: 'expected a non-empty question string' }, { status: 400 })
  }
  if (raw.length > MAX_QUESTION_LEN) {
    return NextResponse.json({ error: 'question too long' }, { status: 413 })
  }

  const normalized = normalizeQuestion(raw)
  const deterministic = parseQuestion(raw)

  // 1. Cache: identical question text costs no quota (we cache LLM parses only).
  const cached = getCachedParse(normalized)
  if (cached) {
    return json(build(cached, 'llm', normalized))
  }

  // 2. No key → deterministic engine only.
  if (!hasGeminiKey()) {
    return json(build(deterministic, 'deterministic', normalized))
  }

  // 3. Gate the LLM call (per-IP rate limit + global daily cap).
  const gate = tryConsume(clientIp(request))
  if (gate === 'cap' || gate === 'rate') {
    return json(build(deterministic, 'cap', normalized))
  }
  if (gate === 'no_key') {
    return json(build(deterministic, 'deterministic', normalized))
  }

  // 4. LLM parse (primary for supported intents; deterministic is the net).
  const llm = await llmParse(normalized)
  if (llm.status === 'ok' && llm.parse) {
    if (llm.parse.supported) {
      setCachedParse(normalized, llm.parse)
      return json(build(llm.parse, 'llm', normalized))
    }
    // LLM refused — trust the deterministic parser if it can resolve it.
    if (deterministic.supported) {
      return json(build(deterministic, 'deterministic', normalized))
    }
    setCachedParse(normalized, llm.parse)
    return json(build(llm.parse, 'llm', normalized))
  }

  // 5. LLM errored → degrade.
  return json(build(deterministic, 'deterministic', normalized))
}

function json(payload: AskResponse) {
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
