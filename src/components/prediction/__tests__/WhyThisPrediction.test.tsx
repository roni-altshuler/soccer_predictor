import { render, screen } from '@testing-library/react'

import {
  WhyThisPrediction,
  featureLabel,
} from '@/components/prediction/WhyThisPrediction'
import type { AttributionItem } from '@/lib/types/attribution'

const HOME = 'Arsenal'
const AWAY = 'Chelsea'

const baseProps = {
  predictedOutcome: 'home' as const,
  homeTeam: HOME,
  awayTeam: AWAY,
}

const attribution: AttributionItem[] = [
  { feature: 'elo_diff_signed', value: 87.4, contribution: 0.42 },
  { feature: 'home_form_5_pts', value: 12, contribution: 0.31 },
  { feature: 'away_goals_against_avg5', value: 1.8, contribution: -0.19 },
  { feature: 'h2h_home_advantage', value: 0.33, contribution: 0.12 },
]

describe('WhyThisPrediction', () => {
  it('renders a diverging bar row for each attribution item', () => {
    render(<WhyThisPrediction {...baseProps} attribution={attribution} />)

    expect(screen.getByText('Why this prediction')).toBeInTheDocument()

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(attribution.length)

    // Accessible text carries direction + contribution for every row.
    expect(
      screen.getByLabelText(/Team rating gap.*pushed toward Arsenal win.*\+0\.42/)
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText(/Chelsea goals conceded \(last 5\).*pushed against Arsenal win/)
    ).toBeInTheDocument()
  })

  it('caps the chart at the top 8 contributions by magnitude', () => {
    const twelve: AttributionItem[] = Array.from({ length: 12 }, (_, i) => ({
      feature: `feature_${i}`,
      value: i,
      contribution: (12 - i) * (i % 2 === 0 ? 0.1 : -0.1),
    }))
    render(<WhyThisPrediction {...baseProps} attribution={twelve} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
  })

  it('renders nothing when attribution is empty, null, or undefined', () => {
    const empty = render(<WhyThisPrediction {...baseProps} attribution={[]} />)
    expect(empty.container).toBeEmptyDOMElement()

    const nul = render(<WhyThisPrediction {...baseProps} attribution={null} />)
    expect(nul.container).toBeEmptyDOMElement()

    const undef = render(<WhyThisPrediction {...baseProps} />)
    expect(undef.container).toBeEmptyDOMElement()
  })

  it('describes the pick as a draw when the model leans draw', () => {
    render(
      <WhyThisPrediction
        {...baseProps}
        predictedOutcome="draw"
        attribution={[{ feature: 'referee_draw_rate', value: 0.31, contribution: 0.2 }]}
      />
    )
    expect(
      screen.getByLabelText(/Referee draw rate.*pushed toward a draw/)
    ).toBeInTheDocument()
  })
})

describe('featureLabel', () => {
  it('maps common dense features to plain language with team names', () => {
    expect(featureLabel('elo_diff_signed', HOME, AWAY)).toBe('Team rating gap')
    expect(featureLabel('home_form_5_pts', HOME, AWAY)).toBe('Arsenal form (last 5)')
    expect(featureLabel('away_goals_against_avg5', HOME, AWAY)).toBe(
      'Chelsea goals conceded (last 5)'
    )
  })

  it('maps grouped categorical attributions', () => {
    expect(featureLabel('home_team_identity', HOME, AWAY)).toBe('Arsenal team profile')
    expect(featureLabel('league_context', HOME, AWAY)).toBe('League context')
  })

  it('falls back to a de-snake-cased label with team prefixes for unknown names', () => {
    expect(featureLabel('home_expected_pressing_index', HOME, AWAY)).toBe(
      'Arsenal expected pressing index'
    )
    expect(featureLabel('away_new_metric', HOME, AWAY)).toBe('Chelsea new metric')
    expect(featureLabel('some_future_feature', HOME, AWAY)).toBe('Some future feature')
  })
})
