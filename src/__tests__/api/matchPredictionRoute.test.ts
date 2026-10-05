/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/match/[id]/route'
import { adaptMatchPrediction, getPredictionVerdict } from '@/components/match/detail/adaptPrediction'
import type { MatchDetails } from '@/components/match/detail/types'

// Exercise the actual HTTP route and its backend normalization. ESPN and
// model wire responses are test fixtures; /api/match is never mocked here.
jest.mock('@/lib/server/tieFixtures', () => ({ matchCard: jest.fn().mockResolvedValue(null) }))
jest.mock('@/lib/server/recordedForecast', () => ({ recordedForecast: jest.fn().mockResolvedValue(null) }))
const originalFetch = global.fetch
const unified = { home_team: 'Home club', away_team: 'Away club', outcome: { home_win: 0.6, draw: 0.25, away_win: 0.15 } }
const legacy = { probabilities: { home_win: 60, draw: 25, away_win: 15 } }
const fixture = { header: { league: { slug: 'eng.1', name: 'Premier League' }, competitions: [{
  date: '2026-10-04T14:00:00Z', status: { type: { name: 'STATUS_SCHEDULED' } },
  competitors: [
    { homeAway: 'home', team: { id: '1', displayName: 'Home club' } },
    { homeAway: 'away', team: { id: '2', displayName: 'Away club' } },
  ],
}] } }
const respond = (value: unknown, ok = true) => Promise.resolve({ ok, json: async () => value })
function backend(v1: unknown, fallback: unknown = null) {
  global.fetch = jest.fn((input: unknown) => {
    const url = String(input)
    if (url.includes('/api/v1/predictions/match/')) return respond(v1, v1 !== null)
    if (url.endsWith('/api/predict/unified')) return respond(fallback, fallback !== null)
    if (url.includes('/summary?event=123')) return respond(fixture)
    if (url.includes('/scoreboard?')) return respond({ events: [] })
    throw new Error(`Unexpected fetch: ${url}`)
  }) as typeof fetch
}
async function request() {
  const response = await GET(new NextRequest('http://localhost/api/match/123?league=eng.1&gender=M'), { params: Promise.resolve({ id: '123' }) })
  expect(response.status).toBe(200)
  return await response.json() as MatchDetails
}
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks() })

describe('GET /api/match/[id] prediction evidence boundary', () => {
  it.each([
    { ...unified },
    { ...unified, confidence: { overall: null }, most_likely_score: null, goals: { total_expected_goals: null, home_expected_goals: null, away_expected_goals: null, over_2_5: null, btts_yes: null } },
    { ...unified, confidence: { overall: '' }, most_likely_score: { home_goals: '', away_goals: null }, goals: { total_expected_goals: '', over_2_5: '', btts_yes: NaN } },
  ])('keeps missing/null/non-numeric v1 evidence unknown through the adapter (%#)', async (wire) => {
    backend(wire)
    const match = await request()
    expect(match.prediction).toMatchObject({ confidence: null, predicted_score: null, total_goals: null, over_2_5: null, btts_yes: null,
      expected_goals: { home: null, away: null, total: null } })
    expect(match.prediction!.confidence_band).toBeUndefined()
    const payload = adaptMatchPrediction(match)!
    expect(payload.confidence?.overall).toBeNull()
    expect(payload.most_likely_score).toBeNull()
    expect(payload.goals).toMatchObject({ total_expected_goals: null, over_2_5: null, btts_yes: null })
    expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).endsWith('/api/predict/unified'))).toBe(false)
  })

  it('keeps v1 mode and xG separate and preserves probabilities and real attribution', async () => {
    const attribution = [{ feature: 'elo_diff_signed', value: 100, contribution: 0.12 }]
    const derived_markets = { over_under: { '1.5': { over: 0.7, under: 0.3 } }, btts: { yes: 0.4, no: 0.6 }, correct_score_top5: [{ home: 2, away: 1, probability: 0.16 }] }
    backend({ ...unified, confidence: { overall: 0.7 }, most_likely_score: { score: '2-1', home_goals: 2, away_goals: 1, probability: 0.16 },
      goals: { home_expected_goals: 1.8, away_expected_goals: 0.9, total_expected_goals: 2.7, over_1_5: 0.7, over_2_5: 0.5, over_3_5: 0.2, btts_yes: 0.4 },
      derived_markets, attribution, model_version: 'test-wire' })
    const match = await request()
    expect(match.prediction).toMatchObject({ confidence: 70, confidence_band: 'High', predicted_score: { home: 2, away: 1 }, total_goals: 2.7,
      expected_goals: { home: 1.8, away: 0.9, total: 2.7 }, derived_markets, attribution, model_version: 'test-wire' })
    const payload = adaptMatchPrediction(match)!
    expect(payload.goals).toEqual({ home_expected_goals: 1.8, away_expected_goals: 0.9, total_expected_goals: 2.7, over_1_5: 0.7, over_2_5: 0.5, over_3_5: 0.2, btts_yes: 0.4 })
    expect(payload.most_likely_score?.probability).toBe(0.16)
    expect(payload.attribution).toEqual(attribution)
  })

  it('does not turn v1 expected goals into an unreported mode scoreline', async () => {
    backend({ ...unified, goals: { home_expected_goals: 1.8, away_expected_goals: 0.9, total_expected_goals: 2.7 } })
    const match = await request()
    expect(match.prediction!.predicted_score).toBeNull()
    expect(adaptMatchPrediction(match)!.most_likely_score).toBeNull()
    expect(adaptMatchPrediction(match)!.goals.total_expected_goals).toBe(2.7)
    expect(getPredictionVerdict({ ...match, home_score: 0, away_score: 0 }).message).toBe('')
  })

  it('retains actual zero confidence, scores, xG and market probabilities', async () => {
    backend({ ...unified, confidence: { overall: 0 }, most_likely_score: { home_goals: 0, away_goals: 0 },
      goals: { home_expected_goals: 0, away_expected_goals: 0, total_expected_goals: 0, over_2_5: 0, btts_yes: 0 } })
    const match = await request()
    expect(match.prediction).toMatchObject({ confidence: 0, confidence_band: 'Low', predicted_score: { home: 0, away: 0 }, total_goals: 0, over_2_5: 0, btts_yes: 0 })
    const payload = adaptMatchPrediction(match)!
    expect(payload.confidence?.overall).toBe(0)
    expect(payload.most_likely_score?.score).toBe('0-0')
    expect(payload.most_likely_score?.probability).toBeNull()
    expect(payload.goals.total_expected_goals).toBe(0)
  })

  it.each([
    { ...legacy },
    { ...legacy, confidence: null, predicted_home_goals: null, predicted_away_goals: null },
    { ...legacy, confidence: '', predicted_home_goals: '', predicted_away_goals: NaN },
  ])('keeps sparse fallback evidence unknown rather than producing zero-zero (%#)', async (wire) => {
    backend(null, wire)
    const match = await request()
    expect(match.prediction).toMatchObject({ confidence: null, predicted_score: null, total_goals: null, expected_goals: { home: null, away: null, total: null } })
    expect(adaptMatchPrediction(match)!.most_likely_score).toBeNull()
  })

  it('preserves contract-defined fallback xG and its sum', async () => {
    backend(null, { ...legacy, predicted_home_goals: 2.1, predicted_away_goals: 0.9, confidence: 62 })
    const match = await request()
    expect(match.prediction).toMatchObject({ home_win: 0.6, draw: 0.25, away_win: 0.15, confidence: 62, predicted_score: { home: 2.1, away: 0.9 },
      expected_goals: { home: 2.1, away: 0.9, total: 3 }, total_goals: 3 })
    expect(adaptMatchPrediction(match)!.goals).toMatchObject({ home_expected_goals: 2.1, away_expected_goals: 0.9, total_expected_goals: 3 })
  })

  it('preserves a single published xG without filling its missing partner or summing a partial pair', async () => {
    backend(null, { ...legacy, predicted_home_goals: 2.1 })
    const match = await request()
    expect(match.prediction).toMatchObject({ predicted_score: null, total_goals: null, expected_goals: { home: 2.1, away: null, total: null } })
  })

  it('drops invalid derived rows instead of presenting absent probabilities as zero', async () => {
    backend({ ...unified, derived_markets: { over_under: { '1.5': { over: null, under: 1 }, '2.5': { over: 0, under: 1 } },
      btts: { yes: null, no: 1 }, correct_score_top5: [{ home: 0, away: 0, probability: null }] } })
    const match = await request()
    expect(match.prediction!.derived_markets).toEqual({ over_under: { '2.5': { over: 0, under: 1 } } })
    expect(match.prediction!.over_1_5).toBeNull()
    expect(match.prediction!.over_2_5).toBe(0)
    expect(match.prediction!.btts_yes).toBeNull()
  })

  it('keeps the wrong-fixture guard before taking the legacy fallback', async () => {
    backend({ ...unified, home_team: 'Unrelated club' }, { ...legacy, predicted_home_goals: 1.4, predicted_away_goals: 0.7 })
    const xg = (await request()).prediction!.expected_goals!
    expect(xg).toMatchObject({ home: 1.4, away: 0.7 })
    expect(xg.total).toBeCloseTo(2.1)
  })

  it.each([null, {}, { ...legacy, probabilities: { home_win: null, draw: null, away_win: null } }, { ...legacy, probabilities: { home_win: 120, draw: 0, away_win: -20 } }])('rejects invalid outcomes instead of normalizing invented predictions (%#)', async (wire) => {
    backend(null, wire)
    expect((await request()).prediction).toBeUndefined()
  })
})
