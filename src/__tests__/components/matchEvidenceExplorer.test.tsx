import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MatchEvidenceExplorer } from '@/components/league/MatchEvidenceExplorer'
import { matchEvidence } from '@/lib/matchEvidence'

const props = { leagueId: 'eng.1', today: '2026-10-08', initialFrom: '2026-08-01', initialAsOf: '2026-10-08' }
const data = matchEvidence([{ source: 'predictions_2026-09.json', row: { match_id: '123', league: 'Premier League', gender: 'M', model_used: 'dixon_coles_v1',
  match_date: '2026-09-01', home_team: 'Arsenal', away_team: 'Fulham', predicted_home_win: .6, predicted_draw: .25, predicted_away_win: .15,
  prediction_timestamp: '2026-08-31T10:00:00', outcome_timestamp: '2026-09-01T23:00:00', actual_home_goals: 2, actual_away_goals: 0, actual_winner: 'home' } }], 'eng.1', 'M', props.initialAsOf, props.initialFrom)
const reply = (body: unknown = data, status = 200) => ({ ok: status < 400, json: async () => body } as Response)
beforeEach(() => {
  localStorage.clear(); window.history.replaceState({}, '', '/leagues/eng.1/evidence')
  global.fetch = jest.fn().mockResolvedValue(reply())
})
afterEach(() => jest.restoreAllMocks())

it('shows probability, honest goal missingness, timing and scoped samples', async () => {
  render(<MatchEvidenceExplorer {...props} initialTeam="Arsenal" />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  await screen.findByRole('region', { name: 'Recorded match evidence' })
  expect(screen.getByRole('combobox', { name: 'Club' })).toHaveValue('Arsenal')
  expect(screen.getByRole('status')).toHaveTextContent('1 distinct matches · 1 results known')
  expect(screen.getByText('60.0%')).toBeInTheDocument()
  expect(screen.getAllByText('Unavailable / Unavailable')).toHaveLength(2)
  expect(screen.getByText(/not observed shot-level xG/)).toBeInTheDocument()
  expect(screen.getByText(/Training cutoffs and immutable publication history are absent/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'How to read this evidence' })).toHaveAttribute('href', '/docs/tutorials/follow-a-season#explore-match-evidence')
})
it('shows real empty state for a requested club absent from the window', async () => {
  render(<MatchEvidenceExplorer {...props} initialTeam="Chelsea" />)
  await screen.findByRole('heading', { name: 'No eligible matches' })
  expect(screen.queryByRole('region', { name: 'Recorded match evidence' })).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Club' }), '')
  await screen.findByRole('region', { name: 'Recorded match evidence' })
})
it('recovers errors and refuses metrics from an incomplete archive', async () => {
  jest.mocked(global.fetch).mockResolvedValueOnce(reply({}, 503)).mockResolvedValueOnce(reply({ ...data, available: false })).mockResolvedValueOnce(reply())
  render(<MatchEvidenceExplorer {...props} />)
  await screen.findByRole('heading', { name: 'Couldn’t read the archive' })
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText(/No metrics are shown from a partial source/)
  expect(screen.queryByText('Brier (sum, 0–2)')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('region', { name: 'Recorded match evidence' })
})
it('withholds stale records immediately when dates change, then ignores late replies', async () => {
  let release: (r: Response) => void = () => {}
  jest.mocked(global.fetch).mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  jest.mocked(global.fetch).mockResolvedValueOnce(reply({ ...data, asOf: '2026-09-01', records: [{ ...data.records[0], result: null }] }))
  render(<MatchEvidenceExplorer {...props} />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
  await userEvent.clear(screen.getByLabelText('Results known through (UTC)'))
  await userEvent.type(screen.getByLabelText('Results known through (UTC)'), '2026-09-01')
  await userEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
  await screen.findByText(/1 distinct matches · 0 results known/)
  await act(async () => release(reply()))
  expect(screen.getByRole('status')).toHaveTextContent('0 results known')
  expect(screen.queryByText('2 / 0')).not.toBeInTheDocument()
})
it('uses the canonical women’s preference without requesting the men’s archive', async () => {
  localStorage.setItem('fotpredict.gender', 'women')
  render(<MatchEvidenceExplorer {...props} />)
  await screen.findByText(/Women’s match evidence is unavailable/)
  expect(global.fetch).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: 'Back to club comparison' })).toHaveAttribute('href', '/leagues/eng.1/compare?gender=F')
})
