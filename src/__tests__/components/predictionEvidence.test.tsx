import { render, screen } from '@testing-library/react'
import { PredictionResult } from '@/components/prediction/PredictionResult'
import { adaptLegacyPrediction } from '@/components/prediction/adaptLegacyPrediction'
import { adaptMatchPrediction } from '@/components/match/detail/adaptPrediction'
import type { MatchDetails } from '@/components/match/detail/types'
import { buildModelInsights } from '@/components/match/detail/insights'

// Deliberately sparse wire fixtures. No production model or provider is invoked.
const match = (prediction: unknown = { home_win: 0.6, draw: 0.25, away_win: 0.15, predicted_score: { home: 2, away: 1 } }) => ({
  id: '1', home_team: 'Home club', away_team: 'Away club', league: 'League', prediction,
  homeStanding: { points: 77 }, awayStanding: { points: 3 },
  h2h: { homeWins: 8, draws: 2, awayWins: 1 },
}) as MatchDetails
const context = { home_team: 'Home club', away_team: 'Away club' }
const legacy = { predictions: { home_win: 0.6, draw: 0.25, away_win: 0.15 }, predicted_home_goals: 2, predicted_away_goals: 1 }

describe('Sparse prediction evidence', () => {
  it('never converts standings or meetings into model inputs', () => {
    const payload = adaptMatchPrediction(match())!
    expect(payload.factors).toBeNull()
    expect(payload.confidence).toEqual({ overall: null })
    expect(Object.values(payload.goals)).toEqual([null, null, null, null, null, null, null])
    expect(payload.most_likely_score?.probability).toBeNull()
    expect(payload.attribution).toBeNull()
  })

  it('renders restrained unavailable states without neutral or zero evidence', () => {
    render(<PredictionResult prediction={adaptMatchPrediction(match())!} />)
    expect(screen.getByText('Prediction inputs')).toBeInTheDocument()
    expect(screen.getByText('Individual inputs are unavailable for this prediction.')).toBeInTheDocument()
    expect(screen.getByText('Exact-score chance unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('Unavailable')).toHaveLength(4)
    expect(screen.queryByText(/Key drivers|near full strength|equally rested|Even|Last 5|confidence|Why this prediction/)).not.toBeInTheDocument()
    expect(screen.getByText('2-1')).toBeInTheDocument()
  })

  it('does not call an integer mode expected goals or a goal-market probability', () => {
    const p = adaptMatchPrediction(match())!
    expect(p.goals.total_expected_goals).toBeNull()
    expect(p.goals.home_expected_goals).toBeNull()
    expect(p.goals.over_2_5).toBeNull()
  })

  it('keeps genuine zero probabilities and confidence', () => {
    const payload = adaptMatchPrediction(match({ ...match().prediction, confidence: 0, over_2_5: 0, btts_yes: 0 }))!
    expect(payload.goals.over_2_5).toBe(0)
    expect(payload.goals.btts_yes).toBe(0)
    expect(payload.confidence?.overall).toBe(0)
  })

  it('renders canonical null evidence without a zero score, confidence or low-scoring claim', () => {
    const details = match({ ...match().prediction, predicted_score: null, confidence: null, total_goals: null,
      expected_goals: { home: null, away: null, total: null }, over_2_5: null, btts_yes: null })
    render(<PredictionResult prediction={adaptMatchPrediction(details)!} />)
    expect(screen.getByText('Scoreline unavailable.')).toBeInTheDocument()
    expect(screen.queryByText(/0-0|confidence|total xG/)).not.toBeInTheDocument()
    expect(buildModelInsights(details).some((i) => /scoring|Goals expected/.test(i.title))).toBe(false)
  })

  it('renders published xG separately from the score pick and preserves its goal insight', () => {
    const details = match({ ...match().prediction, total_goals: 3.53, expected_goals: { home: 1.76, away: 1.77, total: 3.53 } })
    render(<PredictionResult prediction={adaptMatchPrediction(details)!} />)
    expect(screen.getByText('3.53 total xG')).toBeInTheDocument()
    expect(screen.queryByText('Expected goals by team unavailable.')).not.toBeInTheDocument()
    expect(screen.getByText('2-1')).toBeInTheDocument()
    expect(buildModelInsights(details)).toContainEqual(expect.objectContaining({ title: 'Goals expected', detail: 'Expected total of 3.5 goals.' }))
  })

  it('reads only published derived markets and sorts the real mode without renormalising', () => {
    const payload = adaptMatchPrediction(match({ ...match().prediction, derived_markets: {
      over_under: { '1.5': { over: 0.7, under: 0.3 }, '3.5': { over: 0.2, under: 0.8 } },
      btts: { yes: 0.4, no: 0.6 },
      correct_score_top5: [{ home: 2, away: 1, probability: 0.08 }, { home: 1, away: 1, probability: 0.12 }],
    } }))!
    expect(payload.most_likely_score).toEqual({ score: '1-1', home_goals: 1, away_goals: 1, probability: 0.12 })
    expect(payload.alternative_scores[0].probability).toBe(0.08)
    expect(payload.goals).toMatchObject({ over_1_5: 0.7, over_3_5: 0.2, btts_yes: 0.4 })
    render(<PredictionResult prediction={payload} />)
    expect(screen.getByText('12.0%')).toBeInTheDocument()
  })

  it.each([null, {}, { home_win: 0, draw: 0, away_win: 0 }, { home_win: NaN, draw: 0.5, away_win: 0.5 }, { home_win: 1.2, draw: 0, away_win: -0.2 }])('refuses missing or invalid 1X2: %p', (prediction) => {
    expect(adaptMatchPrediction(match(prediction))).toBeNull()
  })

  it('rejects malformed scorelines, invalid probabilities, and a distribution above one', () => {
    const payload = adaptLegacyPrediction({ ...legacy, scoreline_probabilities: [
      { score: 'unknown', probability: 0.2 }, { score: '1-1', probability: NaN },
      { score: '2-2', probability: 2 }, { score: '0-0', probability: -0.1 },
    ] }, context)!
    expect(payload.most_likely_score?.probability).toBeNull()
    expect(adaptLegacyPrediction({ ...legacy, scoreline_probabilities: [
      { score: '1-1', probability: 0.8 }, { score: '2-1', probability: 0.8 },
    ] }, context)!.most_likely_score?.probability).toBeNull()
  })

  it('keeps legacy ratings and signed net form as context, without inferring health or rest', () => {
    const payload = adaptLegacyPrediction({ ...legacy, ratings: { home_elo: 1600, away_elo: 1500, elo_difference: 100 }, form: { home_form: -9, away_form: 0 } }, context)!
    expect(payload.factors).toBeNull()
    expect(payload.context).toContainEqual({ label: 'Home recent form (net points)', value: '-9' })
    render(<PredictionResult prediction={payload} />)
    expect(screen.getByText('Match context')).toBeInTheDocument()
    expect(screen.getByText('-9')).toBeInTheDocument()
    expect(screen.queryByText(/Last 5|near full strength|Why this prediction/)).not.toBeInTheDocument()
  })

  it('does not manufacture a scoreline, confidence, or markets from a 1X2-only response', () => {
    const payload = adaptLegacyPrediction({ predictions: legacy.predictions }, context)!
    expect(payload.most_likely_score).toBeNull()
    expect(payload.context).toEqual([])
    expect(payload.confidence?.overall).toBeNull()
    expect(payload.goals.btts_yes).toBeNull()
    render(<PredictionResult prediction={payload} />)
    expect(screen.getByText('Scoreline unavailable.')).toBeInTheDocument()
  })

  it('preserves the full unified backend payload and gates explanations on actual attribution', () => {
    const sparse = adaptMatchPrediction(match())!
    const attribution = [{ feature: 'elo_diff_signed', value: 100, contribution: 0.12 }]
    const payload = { ...sparse, factors: { home_elo: 1600, away_elo: 1500, injury_impact: 0, rest_days_diff: 0 }, attribution,
      goals: { ...sparse.goals, home_expected_goals: 1.8, away_expected_goals: 0.9 } }
    render(<PredictionResult prediction={payload} />)
    expect(screen.getByText('Why this prediction')).toBeInTheDocument()
    expect(screen.getByText('Home rating')).toBeInTheDocument()
    expect(screen.getByText('1,600')).toBeInTheDocument()
    expect(screen.queryByText(/near full strength|equally rested/)).not.toBeInTheDocument()
    expect(adaptMatchPrediction(match({ ...match().prediction, attribution }))!.attribution).toBe(attribution)
    expect(adaptLegacyPrediction({ ...legacy, attribution }, context)!.attribution).toBe(attribution)
  })
})
