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
  source: 'user_supplied_odds'
  guarantee: false
  betting_advice: false
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

function labelEdge(edge?: number): MarketEdge['label'] {
  if (edge == null) return 'no_model'
  if (edge >= 0.06) return 'value_watch'
  if (edge >= 0.025) return 'lean'
  return 'no_play'
}

export function buildMarketIntelligence(
  odds: DecimalThreeWayOdds,
  model?: ModelThreeWayProbabilities | null,
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
      label: labelEdge(edge),
    }
  })

  return {
    source: 'user_supplied_odds',
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
    note: 'Compares model probabilities to no-vig market probabilities for audit and calibration only. It is not a betting guarantee or recommendation.',
  }
}
