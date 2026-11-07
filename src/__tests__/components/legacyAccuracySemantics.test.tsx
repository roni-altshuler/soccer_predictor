import { render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { LeagueAccuracy } from '@/components/accuracy/CompetitionAccuracy'

it('retains a zero stored scoreline rate, places outcome log loss separately, and uses summed Brier', () => {
  const row = { total: 10, accuracy: .5, brier_score: .2, scoreline_accuracy: 0, log_loss: 1.2, expected_calibration_error: .1 } as NonNullable<ComponentProps<typeof LeagueAccuracy>['row']>
  render(<LeagueAccuracy id="eng.1" row={row} />)
  expect(screen.getByText('0.6000')).toBeVisible()
  const exact = screen.getByRole('heading', { name: 'Exact scorelines' }).closest('section')!
  expect(within(exact).getByText('0.0%')).toBeVisible()
  expect(within(exact).queryByText('Outcome log loss')).not.toBeInTheDocument()
  expect(screen.getByText('Outcome log loss')).toBeVisible()
  expect(screen.getByText(/forecast coverage and period eligibility are not established/)).toBeVisible()
})
