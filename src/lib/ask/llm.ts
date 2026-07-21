/**
 * Ask Pitchverse — runtime LLM intent parse (server-only) with quota safety.
 *
 * The LLM's ONLY job is to map a messy free-text question onto the constrained
 * `AskIntent` schema — it is never asked for a number, a rate, or a fact. It
 * self-activates when `GEMINI_API_KEY` is present in the runtime env (read
 * server-side, sent in a header, never exposed to the client or a URL) and is
 * strictly optional: with no key the feature runs entirely on the deterministic
 * parser.
 *
 * Free-tier safety (public page on the shared 1,500 req/day Gemini tier):
 *   • parses are cached by normalized question text (identical questions cost
 *     nothing),
 *   • per-IP per-minute rate limit,
 *   • a global daily cap,
 *   • any block, error, or timeout degrades cleanly to the deterministic parser.
 *
 * In-memory counters/cache are per warm serverless instance — a pragmatic
 * best-effort ceiling, not a distributed quota. That is deliberate for v1: the
 * worst case is simply more deterministic-parser fallbacks, never a quota blow.
 */

import { normalizeIntent } from './schema'
import { type DeterministicParse } from './parse'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-2.5-flash-lite'
const REQUEST_TIMEOUT_MS = 7000
const MAX_OUTPUT_TOKENS = 160

const SYSTEM_PROMPT = [
  'You convert a football question into a strict JSON intent for a historical',
  'exact-count lookup. You NEVER answer the question, never output a number of',
  'matches, a rate, a probability, or any fact — only the parsed intent.',
  '',
  'The lookup answers exactly one shape: given a match state (a team trailing/',
  'level/leading by a goal margin at a minute), how often that side reaches a',
  'given final outcome. Map the question onto these fields:',
  '  gender:  "M" (default) or "F" (women\'s / WSL / NWSL).',
  '  diff:    integer -3..3 = the queried side\'s goal margin. Negative = trailing',
  '           (down/behind), 0 = level/tied, positive = leading (up/ahead). Clamp',
  '           to [-3,3].',
  '  minute:  integer 0..90 = the match minute. half-time=45, kickoff=0,',
  '           "N minutes left"=90-N. Must be explicit; if absent, return unsupported.',
  '  outcome: "win" (go on to win / comeback / hold on to win), "avoid_defeat"',
  '           (win or draw / stay unbeaten / not lose / how safe), "draw" (finish',
  '           level), or "loss" (go on to lose / throw it away).',
  '',
  'If the question is not about outcome-from-an-in-match-state (e.g. it names a',
  'specific team/player/date, asks about a table, xG, transfers, or anything the',
  'lookup cannot answer), return {"supported": false}.',
  '',
  'Respond with ONE JSON object, nothing else:',
  '  {"supported": true, "gender":"M", "diff":-2, "minute":70, "outcome":"win"}',
  '  or {"supported": false}',
].join('\n')

// --------------------------------------------------------------------------- #
// Parse-result cache (normalized question -> resolved parse)
// --------------------------------------------------------------------------- #

const CACHE_MAX = 500
const parseCache = new Map<string, DeterministicParse>()

export function getCachedParse(key: string): DeterministicParse | undefined {
  const hit = parseCache.get(key)
  if (hit) {
    // refresh recency (Map keeps insertion order → cheap LRU)
    parseCache.delete(key)
    parseCache.set(key, hit)
  }
  return hit
}

export function setCachedParse(key: string, parse: DeterministicParse): void {
  parseCache.delete(key)
  parseCache.set(key, parse)
  while (parseCache.size > CACHE_MAX) {
    const oldest = parseCache.keys().next().value
    if (oldest === undefined) break
    parseCache.delete(oldest)
  }
}

// --------------------------------------------------------------------------- #
// Rate limit + daily cap (in-memory, per instance)
// --------------------------------------------------------------------------- #

let dayKey = ''
let dayCount = 0
const ipHits = new Map<string, number[]>()

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = Number.parseInt(env[name] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export type GateResult = 'ok' | 'no_key' | 'cap' | 'rate'

export function hasGeminiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.GEMINI_API_KEY ?? '').trim())
}

/**
 * Decide whether an LLM call is permitted for `ip` now, and — when it returns
 * `ok` — record the consumption against the per-minute and daily counters.
 */
export function tryConsume(ip: string, now: number = Date.now(), env: NodeJS.ProcessEnv = process.env): GateResult {
  if (!hasGeminiKey(env)) return 'no_key'

  const dailyCap = intEnv(env, 'ASK_LLM_DAILY_CAP', 800)
  const perMin = intEnv(env, 'ASK_LLM_PER_MIN', 10)

  const today = new Date(now).toISOString().slice(0, 10)
  if (today !== dayKey) {
    dayKey = today
    dayCount = 0
  }
  if (dayCount >= dailyCap) return 'cap'

  const windowStart = now - 60_000
  const hits = (ipHits.get(ip) ?? []).filter((t) => t > windowStart)
  if (hits.length >= perMin) {
    ipHits.set(ip, hits)
    return 'rate'
  }

  hits.push(now)
  ipHits.set(ip, hits)
  dayCount += 1
  return 'ok'
}

/** Test seam: reset all counters and the cache. */
export function __resetAskLimiterForTest(): void {
  dayKey = ''
  dayCount = 0
  ipHits.clear()
  parseCache.clear()
}

// --------------------------------------------------------------------------- #
// LLM call
// --------------------------------------------------------------------------- #

type Fetcher = typeof fetch

function extractGeminiText(json: unknown): string {
  try {
    const parts = (json as { candidates: { content: { parts: { text?: string }[] } }[] })
      .candidates[0].content.parts
    return parts.map((p) => p.text ?? '').join('').trim()
  } catch {
    return ''
  }
}

/** Tolerant JSON recovery: strip a ```json fence, else take the outermost {...}. */
function recoverJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  const candidates: string[] = [raw]
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fence) candidates.unshift(fence[1])
  const brace = raw.match(/\{[\s\S]*\}/)
  if (brace) candidates.push(brace[0])
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c)
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    } catch {
      /* try next */
    }
  }
  return null
}

/** Map the LLM's JSON onto a `DeterministicParse`, validating strictly. */
function jsonToParse(obj: Record<string, unknown> | null): DeterministicParse {
  if (!obj || obj.supported === false) {
    return { supported: false, reason: 'out_of_domain' }
  }
  const intent = normalizeIntent({
    gender: obj.gender,
    diff: obj.diff,
    minute: obj.minute,
    outcome: obj.outcome,
  })
  if (!intent) return { supported: false, reason: 'out_of_domain' }
  return { supported: true, intent, confidence: 'high' }
}

async function callGemini(
  question: string,
  model: string,
  apiKey: string,
  fetcher: Fetcher
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetcher(`${GEMINI_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: question }] }],
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    })
    if (res.status === 404) {
      const resolved = await resolveFlashModel(apiKey, fetcher)
      if (resolved && resolved !== model) {
        clearTimeout(timer)
        return callGemini(question, resolved, apiKey, fetcher)
      }
    }
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}`)
    const json = await res.json()
    return extractGeminiText(json)
  } finally {
    clearTimeout(timer)
  }
}

/** One ListModels lookup → newest stable flash-lite/flash id (self-heal on 404). */
async function resolveFlashModel(apiKey: string, fetcher: Fetcher): Promise<string | null> {
  try {
    const res = await fetcher(`${GEMINI_BASE}?pageSize=200`, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[]
    }
    const rank = (name: string): number => {
      if (/^gemini-\d+(?:\.\d+)?-flash-lite$/.test(name)) return 3
      if (/^gemini-\d+(?:\.\d+)?-flash$/.test(name)) return 2
      if (name.includes('flash') && !/(preview|exp)/.test(name)) return 1
      return 0
    }
    let best: string | null = null
    let bestRank = 0
    for (const m of json.models ?? []) {
      if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue
      const name = String(m.name ?? '').split('/').pop() ?? ''
      const r = rank(name)
      if (r > bestRank) {
        best = name
        bestRank = r
      }
    }
    return bestRank > 0 ? best : null
  } catch {
    return null
  }
}

export interface LlmParseOutcome {
  status: 'ok' | 'error'
  parse?: DeterministicParse
}

/**
 * Parse a question via Gemini. Returns `{status:'ok', parse}` on success (parse
 * may itself be a refusal), or `{status:'error'}` on any network/shape failure
 * so the caller can degrade to the deterministic parser. Assumes the gate has
 * already been consumed.
 */
export async function llmParse(
  question: string,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: Fetcher = fetch
): Promise<LlmParseOutcome> {
  const apiKey = (env.GEMINI_API_KEY ?? '').trim()
  if (!apiKey) return { status: 'error' }
  const model = (env.GEMINI_MODEL ?? '').trim() || DEFAULT_MODEL
  try {
    const text = await callGemini(question, model, apiKey, fetcher)
    const obj = recoverJson(text)
    if (!obj) return { status: 'error' }
    return { status: 'ok', parse: jsonToParse(obj) }
  } catch {
    return { status: 'error' }
  }
}
