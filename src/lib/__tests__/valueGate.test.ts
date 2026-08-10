import { buildMarketIntelligence } from '@/lib/marketIntelligence'
import {
  MIN_PAIRED_FIXTURES,
  NOISE_TOLERANCE,
  evaluateValueGate,
  explainGate,
} from '@/lib/valueGate'

/**
 * The gate the pivot specified and the product shipped without.
 *
 * Its default must be CLOSED. Every failure mode here — missing artifact,
 * unscored league, thin sample, model behind the price — has to end with no
 * value label, because each one describes a state where we cannot tell an edge
 * from our own error.
 */

function artifact(byLeague: Record<string, unknown>) {
  return { available: true, paired_benchmark: { by_league: byLeague } }
}

const LEVEL = {
  n: 500,
  metrics: { model: { brier: 0.578 }, market_shin: { brier: 0.578 } },
}

describe('evaluateValueGate', () => {
  it('opens for a league scored level with the close on a real sample', () => {
    const v = evaluateValueGate(artifact({ 'eng.1': LEVEL }), 'eng.1')
    expect(v.allowed).toBe(true)
    expect(v.reason).toBe('passed')
    expect(v.n).toBe(500)
  })

  it('opens when the model is AHEAD of the close', () => {
    const ahead = { n: 500, metrics: { model: { brier: 0.57 }, market_shin: { brier: 0.578 } } }
    expect(evaluateValueGate(artifact({ 'eng.1': ahead }), 'eng.1').allowed).toBe(true)
  })

  it('closes when the model is behind the close', () => {
    // The state on 2026-08-10 in every league that had ever been scored:
    // +.0599 Brier behind. A disagreement here is our error.
    const behind = { n: 821, metrics: { model: { brier: 0.6396 }, market_shin: { brier: 0.5797 } } }
    const v = evaluateValueGate(artifact({ 'eng.1': behind }), 'eng.1')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('behind_the_close')
    expect(v.gap).toBeCloseTo(0.0599, 4)
  })

  it('closes on a sample too thin to distinguish an edge from a good week', () => {
    const thin = { ...LEVEL, n: MIN_PAIRED_FIXTURES - 1 }
    const v = evaluateValueGate(artifact({ 'eng.1': thin }), 'eng.1')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('sample_too_small')
  })

  it('closes for a league that was never scored', () => {
    expect(evaluateValueGate(artifact({ 'eng.1': LEVEL }), 'ita.1').reason).toBe(
      'league_not_scored',
    )
  })

  it('closes when no benchmark exists at all', () => {
    expect(evaluateValueGate(null, 'eng.1').reason).toBe('no_benchmark')
    expect(evaluateValueGate({ available: false }, 'eng.1').reason).toBe('no_benchmark')
    expect(evaluateValueGate(artifact({}), 'eng.1').reason).toBe('league_not_scored')
  })

  it('closes when the league is unknown to the caller', () => {
    expect(evaluateValueGate(artifact({ 'eng.1': LEVEL }), null).allowed).toBe(false)
    expect(evaluateValueGate(artifact({ 'eng.1': LEVEL }), undefined).allowed).toBe(false)
  })

  it('closes when a Brier is missing rather than assuming parity', () => {
    const partial = { n: 500, metrics: { model: {}, market_shin: { brier: 0.578 } } }
    const v = evaluateValueGate(artifact({ 'eng.1': partial }), 'eng.1')
    expect(v.allowed).toBe(false)
    expect(v.gap).toBeNull()
  })

  it('treats a gap just inside tolerance as parity and just outside as behind', () => {
    const inside = {
      n: 500,
      metrics: {
        model: { brier: 0.578 + NOISE_TOLERANCE * 0.5 },
        market_shin: { brier: 0.578 },
      },
    }
    const outside = {
      n: 500,
      metrics: {
        model: { brier: 0.578 + NOISE_TOLERANCE * 2 },
        market_shin: { brier: 0.578 },
      },
    }
    expect(evaluateValueGate(artifact({ a: inside }), 'a').allowed).toBe(true)
    expect(evaluateValueGate(artifact({ b: outside }), 'b').allowed).toBe(false)
  })

  it('explains every failure mode in a sentence', () => {
    for (const reason of [
      evaluateValueGate(null, 'eng.1'),
      evaluateValueGate(artifact({}), 'eng.1'),
      evaluateValueGate(artifact({ 'eng.1': { ...LEVEL, n: 5 } }), 'eng.1'),
      evaluateValueGate(
        artifact({
          'eng.1': { n: 500, metrics: { model: { brier: 0.64 }, market_shin: { brier: 0.58 } } },
        }),
        'eng.1',
      ),
      evaluateValueGate(artifact({ 'eng.1': LEVEL }), 'eng.1'),
    ]) {
      expect(explainGate(reason, 'the Premier League').length).toBeGreaterThan(20)
    }
  })
})

describe('buildMarketIntelligence value labels', () => {
  // Model likes the home side 12 points more than the price does — the largest
  // edge this panel can produce, and the one most worth suppressing wrongly.
  const odds = { home: 2.5, draw: 3.4, away: 3.0 }
  const model = { home_win: 0.52, draw: 0.26, away_win: 0.22 }

  it('labels nothing as value when the gate is closed', () => {
    const out = buildMarketIntelligence(odds, model)
    expect(out.value_gate_open).toBe(false)
    expect(out.edges.map((e) => e.label)).not.toContain('value_watch')
    expect(out.edges.map((e) => e.label)).not.toContain('lean')
  })

  it('defaults to closed when the caller does not pass a gate', () => {
    // Omission must not grant permission.
    expect(buildMarketIntelligence(odds, model).value_gate_open).toBe(false)
  })

  it('still reports the edge numbers, which are the diagnostic', () => {
    const out = buildMarketIntelligence(odds, model)
    const home = out.edges.find((e) => e.outcome === 'home_win')
    expect(home?.edge).toBeGreaterThan(0)
  })

  it('labels value only once the gate is open', () => {
    const out = buildMarketIntelligence(odds, model, 'user_supplied_odds', true)
    expect(out.value_gate_open).toBe(true)
    expect(out.edges.some((e) => e.label === 'value_watch' || e.label === 'lean')).toBe(true)
  })

  it('never claims a guarantee or advice either way', () => {
    for (const gate of [false, true]) {
      const out = buildMarketIntelligence(odds, model, 'user_supplied_odds', gate)
      expect(out.guarantee).toBe(false)
      expect(out.betting_advice).toBe(false)
    }
  })
})
