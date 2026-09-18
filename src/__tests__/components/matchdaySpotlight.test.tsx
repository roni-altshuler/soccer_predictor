import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MatchdaySpotlight } from '@/components/match/MatchdaySpotlight'
import { MatchRow } from '@/components/match/MatchRow'
import type { DayMatch } from '@/hooks/useMatchday'

const match: DayMatch = { id: '1', home_team: 'Arsenal', away_team: 'Fulham', league: 'Premier League', status: 'upcoming', ai_home_prob: 0.6, ai_draw_prob: 0.25, ai_away_prob: 0.15 }

it('switches the match centre link with the selected fixture', async () => {
  render(<MatchdaySpotlight matches={[match, { ...match, id: '2', home_team: 'Liverpool', away_team: 'Everton' }]} />)
  await userEvent.click(screen.getByRole('button', { name: /Liverpool v Everton/ }))
  expect(screen.getByRole('link', { name: /Match centre/ })).toHaveAttribute('href', '/matches/2')
  expect(screen.getByText('Pre-match forecast')).toBeInTheDocument()
})

it('omits invalid probabilities from spotlight and list rather than inventing a forecast', () => {
  const invalid = { ...match, ai_home_prob: 3, predicted_scoreline: '2-0' }
  render(<><MatchdaySpotlight matches={[invalid]} /><MatchRow match={invalid} /></>)
  expect(screen.queryByText('Pre-match forecast')).not.toBeInTheDocument()
  expect(screen.queryByText(/2-0/)).not.toBeInTheDocument()
  expect(screen.queryByText(/300/)).not.toBeInTheDocument()
})

it('does not turn missing live scores into a goalless match', () => {
  render(<MatchdaySpotlight matches={[{ ...match, status: 'live' }]} />)
  expect(screen.getByText('– : –')).toBeInTheDocument()
  expect(screen.queryByText('0 : 0')).not.toBeInTheDocument()
})
