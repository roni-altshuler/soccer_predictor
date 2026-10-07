import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TeamComparison } from '@/components/league/TeamComparison'

const artifact = { available: true, generated_at: '2026-10-06T14:27:31Z', leagues: [
  { competition_id: 'eng.1', season: 2026, table: [
    { team: 'Arsenal', played: 5, points: 12, exp_points: 76.9 },
    { team: 'Manchester City', played: 5, points: 15, exp_points: 83.7 },
    { team: 'Fulham', played: 0, points: 0, exp_points: null },
  ] },
] }
const reply = (body: unknown = artifact, status = 200) => ({ ok: status < 400, json: async () => body } as Response)
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/leagues/eng.1/compare')
  global.fetch = jest.fn().mockResolvedValue(reply())
})
afterEach(() => { jest.restoreAllMocks() })

it('renders samples, source gaps and published forecasts with no invented shot/player metrics', async () => {
  render(<TeamComparison leagueId="eng.1" />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  await screen.findByRole('region', { name: 'Club comparison' })
  expect(global.fetch).toHaveBeenCalledWith('/api/v1/season/projections?gender=M', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(screen.getByText('Not supplied by this artifact')).toBeInTheDocument()
  expect(screen.getByText(/Goals, shot-level xG, injuries and player values are unavailable/)).toBeInTheDocument()
  const card = within(screen.getByRole('article', { name: 'Arsenal' }))
  expect(card.getByText('2.40')).toBeInTheDocument()
  expect(card.getByText('5 games recorded')).toBeInTheDocument()
  expect(card.getByText('76.9')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /How to read/ })).toHaveAttribute('href', '/docs/tutorials/follow-a-season#compare-two-clubs')
})

it('supports repeated changes, self-selection swaps and zero-game missing rates', async () => {
  render(<TeamComparison leagueId="eng.1" />)
  const first = await screen.findByRole('combobox', { name: 'First club' })
  const second = screen.getByRole('combobox', { name: 'Second club' })
  for (let i = 0; i < 3; i++) {
    await userEvent.selectOptions(first, 'Manchester City')
    await userEvent.selectOptions(second, 'Arsenal')
    await userEvent.click(screen.getByRole('button', { name: 'Swap' }))
    expect(first).toHaveValue('Arsenal')
    await userEvent.selectOptions(first, 'Manchester City')
    expect(second).toHaveValue('Arsenal')
  }
  await userEvent.selectOptions(second, 'Fulham')
  const card = within(screen.getByRole('article', { name: 'Fulham' }))
  expect(card.getByText('No games recorded yet')).toBeInTheDocument()
  expect(card.getAllByText('Unavailable')).toHaveLength(2)
  expect(card.getAllByText('0')).toHaveLength(2)
})

it('recovers from a failed response and from an empty snapshot', async () => {
  jest.mocked(global.fetch).mockResolvedValueOnce(reply({}, 503)).mockResolvedValueOnce(reply({ available: false })).mockResolvedValueOnce(reply())
  render(<TeamComparison leagueId="eng.1" />)
  await screen.findByText(/The season snapshot could not be loaded/)
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText(/Two identifiable clubs/)
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('region', { name: 'Club comparison' })
})

it('does not request or expose men’s comparisons for a saved women’s preference', async () => {
  localStorage.setItem('fotpredict.gender', 'women')
  render(<TeamComparison leagueId="eng.1" />)
  await screen.findByText(/A women’s season comparison is unavailable/)
  expect(global.fetch).not.toHaveBeenCalled()
  expect(screen.queryByRole('region', { name: 'Club comparison' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to league' })).toHaveAttribute('href', '/leagues/eng.1?gender=F')
})

it('withholds prior season/league state and ignores a response that arrives after navigation', async () => {
  let late: (response: Response) => void = () => {}
  jest.mocked(global.fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { late = resolve }))
  const { rerender } = render(<TeamComparison leagueId="eng.1" />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
  rerender(<TeamComparison leagueId="usa.1" />)
  await screen.findByText(/Two identifiable clubs/)
  await act(async () => late(reply()))
  expect(screen.queryByRole('region', { name: 'Club comparison' })).not.toBeInTheDocument()
  rerender(<TeamComparison leagueId="eng.1" />)
  await screen.findByRole('region', { name: 'Club comparison' })
})
