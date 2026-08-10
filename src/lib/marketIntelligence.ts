export interface DecimalThreeWayOdds {
  home: number
  draw: number
  away: number
}

export interface ModelThreeWayProbabilities {
  home_win: number
  draw: number
  away_win: number
}

export interface MarketEdge {
  outcome: 'home_win' | 'draw' | 'away_win'
  market_probability: number
  model_probability?: number
  fair_decimal_odds: number
  edge?: number
  label: 'no_model' | 'no_play' | 'lean' | 'value_watch'
}

export interface MarketIntelligenceResult {
  source: 'user_supplied_odds' | 'licensed_provider_odds'
  guarantee: false
  betting_advice: false
  /** Whether this league has cleared the evidence gate for value labels. */
  value_gate_open: boolean
  odds_format: 'decimal'
  overround: number
  raw_implied_probabilities: ModelThreeWayProbabilities
  no_vig_probabilities: ModelThreeWayProbabilities
  edges: MarketEdge[]
  note: string
}

function assertDecimalOdd(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 1) {
    throw new Error(`${label} must be a decimal odd greater than 1.00`)
  }
}

function roundProbability(value: number): number {
  return Number(value.toFixed(6))
}

/**
 * Classify a disagreement with the market price.
 *
 * `gateOpen` is not optional in spirit: a size threshold alone says a
 * six-point disagreement is "value_watch" whether or not the model has ever
 * been shown to price this league as well as the bookmaker does. It has not,
 * in any league, as of 2026-08-10. See `src/lib/valueGate.ts`.
 *
 * With the gate closed every row is `no_play` regardless of size. The edge
 * NUMBER is still returned — knowing where the model and the price differ is
 * the diagnostic this module exists for — but no row is labelled as something
 * to act on.
 */
function labelEdge(edge?: number, gateOpen = false): MarketEdge['label'] {
  if (edge == null) return 'no_model'
  if (!gateOpen) return 'no_play'
  if (edge >= 0.06) return 'value_watch'
  if (edge >= 0.025) return 'lean'
  return 'no_play'
}

export function buildMarketIntelligence(
  odds: DecimalThreeWayOdds,
  model?: ModelThreeWayProbabilities | null,
  source: MarketIntelligenceResult['source'] = 'user_supplied_odds',
  /**
   * Has this league cleared the evidence gate? Defaults to CLOSED: a caller
   * that has not checked must not get value labels by omission.
   */
  gateOpen = false,
): MarketIntelligenceResult {
  assertDecimalOdd(odds.home, 'home')
  assertDecimalOdd(odds.draw, 'draw')
  assertDecimalOdd(odds.away, 'away')

  const rawHome = 1 / odds.home
  const rawDraw = 1 / odds.draw
  const rawAway = 1 / odds.away
  const rawTotal = rawHome + rawDraw + rawAway
  const noVig = {
    home_win: rawHome / rawTotal,
    draw: rawDraw / rawTotal,
    away_win: rawAway / rawTotal,
  }

  const outcomes: Array<[MarketEdge['outcome'], number, number | undefined]> = [
    ['home_win', noVig.home_win, model?.home_win],
    ['draw', noVig.draw, model?.draw],
    ['away_win', noVig.away_win, model?.away_win],
  ]

  const edges = outcomes.map(([outcome, marketProbability, modelProbability]) => {
    const edge = modelProbability == null ? undefined : modelProbability - marketProbability
    return {
      outcome,
      market_probability: roundProbability(marketProbability),
      model_probability: modelProbability == null ? undefined : roundProbability(modelProbability),
      fair_decimal_odds: Number((1 / marketProbability).toFixed(3)),
      edge: edge == null ? undefined : roundProbability(edge),
      label: labelEdge(edge, gateOpen),
    }
  })

  return {
    source,
    guarantee: false,
    betting_advice: false,
    odds_format: 'decimal',
    overround: roundProbability(rawTotal - 1),
    raw_implied_probabilities: {
      home_win: roundProbability(rawHome),
      draw: roundProbability(rawDraw),
      away_win: roundProbability(rawAway),
    },
    no_vig_probabilities: {
      home_win: roundProbability(noVig.home_win),
      draw: roundProbability(noVig.draw),
      away_win: roundProbability(noVig.away_win),
    },
    edges,
    value_gate_open: gateOpen,
    note: gateOpen
      ? 'Compares model probabilities to no-vig market probabilities. Value labels are enabled because this league has been scored level with the closing line; it is not a betting guarantee or recommendation.'
      : 'Compares model probabilities to no-vig market probabilities for audit and calibration only. This league has NOT been shown to price matches as well as the closing line, so no row is labelled as value. It is not a betting guarantee or recommendation.',
  }
}
