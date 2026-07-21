import {
  __resetAskLimiterForTest,
  getCachedParse,
  hasGeminiKey,
  llmParse,
  setCachedParse,
  tryConsume,
} from '../llm'
import type { DeterministicParse } from '../parse'

function geminiEnvelope(obj: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }
}

function fakeFetch(bodyJson: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => bodyJson,
  })) as unknown as typeof fetch
}

const NOW = Date.parse('2026-07-21T12:00:00Z')

beforeEach(() => __resetAskLimiterForTest())

describe('quota gate — key detection, rate limit, daily cap', () => {
  test('hasGeminiKey reflects the runtime env only', () => {
    expect(hasGeminiKey({} as NodeJS.ProcessEnv)).toBe(false)
    expect(hasGeminiKey({ GEMINI_API_KEY: '  k  ' } as unknown as NodeJS.ProcessEnv)).toBe(true)
  })

  test('with no key every call is gated as no_key (deterministic-only)', () => {
    expect(tryConsume('ip', NOW, {} as NodeJS.ProcessEnv)).toBe('no_key')
  })

  test('per-IP minute limit then global daily cap both degrade the caller', () => {
    const env = {
      GEMINI_API_KEY: 'k',
      ASK_LLM_PER_MIN: '2',
      ASK_LLM_DAILY_CAP: '3',
    } as unknown as NodeJS.ProcessEnv

    expect(tryConsume('a', NOW, env)).toBe('ok')
    expect(tryConsume('a', NOW, env)).toBe('ok')
    expect(tryConsume('a', NOW, env)).toBe('rate') // a hit its per-minute limit
    expect(tryConsume('b', NOW, env)).toBe('ok') // daily count now at the cap (3)
    expect(tryConsume('c', NOW, env)).toBe('cap') // global daily cap reached
  })

  test('the per-minute window slides — a later minute frees the IP up again', () => {
    const env = { GEMINI_API_KEY: 'k', ASK_LLM_PER_MIN: '1', ASK_LLM_DAILY_CAP: '99' } as unknown as NodeJS.ProcessEnv
    expect(tryConsume('a', NOW, env)).toBe('ok')
    expect(tryConsume('a', NOW, env)).toBe('rate')
    expect(tryConsume('a', NOW + 61_000, env)).toBe('ok')
  })
})

describe('parse cache — identical questions cost no quota', () => {
  test('set then get round-trips; misses return undefined', () => {
    const parse: DeterministicParse = {
      supported: true,
      intent: { gender: 'M', diff: -2, minute: 70, outcome: 'win' },
      confidence: 'high',
    }
    setCachedParse('two down at 70?', parse)
    expect(getCachedParse('two down at 70?')).toEqual(parse)
    expect(getCachedParse('never asked')).toBeUndefined()
  })
})

describe('llmParse — maps the model JSON onto the intent schema, degrades on failure', () => {
  const env = { GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv

  test('a supported intent is parsed and validated', async () => {
    const fetcher = fakeFetch(geminiEnvelope({ supported: true, gender: 'M', diff: -2, minute: 70, outcome: 'win' }))
    const out = await llmParse('two goals down at 70, can they win?', env, fetcher)
    expect(out.status).toBe('ok')
    expect(out.parse).toEqual({
      supported: true,
      intent: { gender: 'M', diff: -2, minute: 70, outcome: 'win' },
      confidence: 'high',
    })
  })

  test('an out-of-domain refusal is respected', async () => {
    const fetcher = fakeFetch(geminiEnvelope({ supported: false }))
    const out = await llmParse('who wins the league?', env, fetcher)
    expect(out.status).toBe('ok')
    expect(out.parse).toEqual({ supported: false, reason: 'out_of_domain' })
  })

  test('a non-2xx response degrades to error (caller falls back to deterministic)', async () => {
    const out = await llmParse('anything', env, fakeFetch({}, 500))
    expect(out.status).toBe('error')
  })

  test('no key → error without a network call', async () => {
    const out = await llmParse('anything', {} as NodeJS.ProcessEnv, fakeFetch({}, 200))
    expect(out.status).toBe('error')
  })
})
