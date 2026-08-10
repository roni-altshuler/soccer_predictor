import {
  isInScopeLeague,
  isServingModel,
  scopePredictions,
} from '@/lib/predictionScope'

/**
 * The published record must describe the model that serves, in the leagues the
 * product covers. Before this module, `/accuracy` pooled eleven competitions
 * and three model generations into one 44.29% headline.
 */

describe('isServingModel', () => {
  it('accepts the serving family and a future version of it', () => {
    expect(isServingModel('dixon_coles_v1')).toBe(true)
    expect(isServingModel('dixon_coles_v2')).toBe(true)
    expect(isServingModel('DIXON_COLES_V1')).toBe(true)
  })

  it('rejects the retired legacy fallback', () => {
    expect(isServingModel('elo_poisson')).toBe(false)
  })

  it('rejects the net retired for train/serve skew', () => {
    // Trained with market features the serving path fed it as zeros; live
    // Brier .6762 against a .6245 constant on the same 64 fixtures.
    expect(isServingModel('unified-multitask-1.0-men')).toBe(false)
    expect(isServingModel('unified-multitask-1.0-women')).toBe(false)
  })

  it('rejects untagged records rather than assuming they are current', () => {
    // 1,162 of 1,244 settled picks carried no model tag. Treating "unknown" as
    // "current" is what made the old headline meaningless.
    expect(isServingModel(null)).toBe(false)
    expect(isServingModel(undefined)).toBe(false)
    expect(isServingModel('')).toBe(false)
  })
})

describe('isInScopeLeague', () => {
  it('accepts the five covered leagues by display name', () => {
    for (const name of ['Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1']) {
      expect(isInScopeLeague(name)).toBe(true)
    }
  })

  it('rejects competitions the product does not ship', () => {
    for (const name of [
      'Primeira Liga',
      'Eredivisie',
      'MLS',
      'Champions League',
      'Europa League',
      'FIFA World Cup',
      'NWSL',
    ]) {
      expect(isInScopeLeague(name)).toBe(false)
    }
  })

  it('rejects a missing league instead of defaulting it in', () => {
    expect(isInScopeLeague(null)).toBe(false)
    expect(isInScopeLeague(undefined)).toBe(false)
  })
})

describe('scopePredictions', () => {
  const rows = [
    { league: 'Premier League', model_used: 'dixon_coles_v1' },
    { league: 'Serie A', model_used: 'dixon_coles_v1' },
    { league: 'Premier League', model_used: 'unified-multitask-1.0-men' },
    { league: 'Premier League', model_used: null },
    { league: 'MLS', model_used: 'dixon_coles_v1' },
    { league: 'NWSL', model_used: 'unified-multitask-1.0-women' },
  ]

  it('keeps only covered leagues served by the current model', () => {
    const { rows: kept } = scopePredictions(rows)
    expect(kept).toHaveLength(2)
    expect(kept.every((r) => r.model_used === 'dixon_coles_v1')).toBe(true)
  })

  it('reports what each filter removed so the surface can say so', () => {
    const { counts } = scopePredictions(rows)
    expect(counts.total).toBe(6)
    expect(counts.inScope).toBe(2)
    // League is checked first, so the two out-of-scope rows are attributed
    // there even though one also has a retired model.
    expect(counts.outOfScopeLeague).toBe(2)
    expect(counts.retiredModel).toBe(2)
    expect(counts.outOfScopeLeague + counts.retiredModel + counts.inScope).toBe(counts.total)
  })

  it('handles an empty record without inventing one', () => {
    const { rows: kept, counts } = scopePredictions([])
    expect(kept).toEqual([])
    expect(counts).toEqual({ total: 0, outOfScopeLeague: 0, retiredModel: 0, inScope: 0 })
  })
})
