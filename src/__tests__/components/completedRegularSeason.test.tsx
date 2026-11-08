import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeagueSeasonBoundary } from '@/components/league/LeagueSeasonBoundary'
import { CompletedRegularSeason } from '@/components/league/CompletedRegularSeason'
import LeagueHomePage from '@/components/league/LeagueHomePage'
import { readCompletedRegularSeason, type CompletedRegularSeason as CompletedSeason } from '@/lib/completedRegularSeason'
import { completedArtifact } from '@/testFixtures/completedRegularSeason'

const reply = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response
const props = { leagueId: 'usa.1', leagueName: 'Major League Soccer', country: 'United States' }
const active = (season: string, _change?: (season: string) => void, _key?: string, completed?: CompletedSeason) => completed ? <CompletedRegularSeason season={completed} /> : <p>Active season {season}</p>
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/leagues/usa.1')
  global.fetch = jest.fn().mockResolvedValue(reply(completedArtifact()))
})
afterEach(() => { jest.restoreAllMocks() })

it('renders observed conference ranks, provenance and archived links without new probabilities', () => {
  const result = readCompletedRegularSeason(completedArtifact(), { competitionId: 'usa.1', season: 2026, gender: 'M', now: new Date('2026-11-08T12:00:00Z') })
  if (result.kind !== 'completed') throw new Error('Expected completed season')
  const { container } = render(<CompletedRegularSeason season={result.season} />)
  const tables = screen.getAllByRole('table')
  expect(tables).toHaveLength(2)
  for (const [index, table] of tables.entries()) {
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(16)
    expect(rows[1]).toHaveTextContent(`${index === 0 ? 'East' : 'West'} Club 01`)
    expect(within(rows[1]).getAllByRole('cell')[0]).toHaveTextContent('1')
    expect(within(rows[15]).getAllByRole('cell')[0]).toHaveTextContent('15')
  }
  expect(screen.getAllByLabelText('Qualified for playoffs')).toHaveLength(18)
  expect(screen.getByText('Results through').nextSibling).toHaveTextContent('2026-11-07')
  expect(screen.getByText('Standings observed (UTC)').nextSibling).toHaveTextContent('2026-11-08 09:00:00 UTC')
  expect(screen.getByText('Artifact built (UTC)').nextSibling).toHaveTextContent('2026-11-08 10:00:00 UTC')
  expect(screen.getByText('Retained schedule verified (UTC)').nextSibling).toHaveTextContent('2026-10-24 08:00:00 UTC')
  expect(screen.getByRole('link', { name: 'Archived forecast evaluation' })).toHaveAttribute('href', '/evaluation')
  expect(screen.getByRole('link', { name: 'Recorded prediction history' })).toHaveAttribute('href', '/accuracy')
  expect(container.textContent).not.toMatch(/\d+%|Projected final|Title race|Supporters.? Shield|Most likely|Season simulation/i)
})

it('preserves observed and independent league tabs without making a simulator request', async () => {
  render(<LeagueHomePage {...props} />)
  expect(screen.getByRole('status')).toHaveTextContent('Reading the season record')
  await screen.findByRole('heading', { name: 'Regular season completed' })
  expect(jest.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/simulation/'))).toBe(false)
  for (const name of ['Overview', 'Standings', 'Top Scorers', 'Fixtures']) expect(screen.getByRole('tab', { name: new RegExp(`^${name}$`, 'i') })).toBeInTheDocument()
  expect(global.fetch).toHaveBeenCalledWith('/api/v1/season/projections?gender=M', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(screen.queryByRole('tab', { name: 'Simulator' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Simulating/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: /^standings$/i }))
  expect(screen.getAllByRole('table')).toHaveLength(2)
  await userEvent.click(screen.getByRole('tab', { name: /^top scorers$/i }))
  await screen.findByText('No scorer data yet')
  await userEvent.click(screen.getByRole('tab', { name: /^fixtures$/i }))
  expect(screen.getByRole('button', { name: /Today/i })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: /^overview$/i }))
  expect(screen.getByRole('heading', { name: 'Regular season completed' })).toBeInTheDocument()
  expect(jest.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/simulation/'))).toBe(false)
  await act(async () => {})
})

it('withholds malformed completion and recovers through the explicit retry control', async () => {
  const malformed = completedArtifact()
  malformed.leagues[0].observed_table.pop()
  jest.mocked(fetch).mockResolvedValueOnce(reply(malformed)).mockResolvedValueOnce(reply(completedArtifact()))
  const renderActive = jest.fn(active)
  render(<LeagueSeasonBoundary {...props} renderActive={renderActive} />)
  await screen.findByRole('heading', { name: 'Season record unavailable' })
  expect(renderActive).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'Regular season completed' })
  expect(renderActive).toHaveBeenCalledWith('2026', expect.any(Function), expect.any(String), expect.objectContaining({ season: 2026 }))
})

it('preserves the active MLS reader after a legacy artifact is checked', async () => {
  jest.mocked(fetch).mockResolvedValue(reply({ leagues: [{ competition_id: 'usa.1', season: 2026, table: [] }] }))
  render(<LeagueSeasonBoundary {...props} renderActive={active} />)
  await screen.findByText('Active season 2026')
})

it('preserves non-MLS and women’s behavior without requesting the men’s artifact', async () => {
  const { unmount } = render(<LeagueSeasonBoundary {...props} leagueId="eng.1" renderActive={active} />)
  expect(screen.getByText('Active season 2026')).toBeInTheDocument()
  expect(global.fetch).not.toHaveBeenCalled()
  unmount()
  localStorage.setItem('fotpredict.gender', 'women')
  render(<LeagueSeasonBoundary {...props} renderActive={active} />)
  await screen.findByText('Active season 2026')
  expect(global.fetch).not.toHaveBeenCalled()
})

it('owns the selected season, aborts its prior read, and ignores a late completed response', async () => {
  let resolve: (value: Response) => void = () => {}
  jest.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done }))
  render(<LeagueSeasonBoundary {...props} renderActive={(season, change, _key, completed) => completed ? <CompletedRegularSeason season={completed} /> : <><p>Active season {season}</p><button onClick={() => change('2026')}>Current season</button></>} />)
  const signal = jest.mocked(fetch).mock.calls[0][1]!.signal!
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Season' }), '2025')
  expect(screen.getByText('Active season 2025')).toBeInTheDocument()
  expect(signal.aborted).toBe(true)
  await act(async () => resolve(reply(completedArtifact())))
  expect(screen.queryByRole('heading', { name: 'Regular season completed' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Current season' }))
  await screen.findByRole('heading', { name: 'Regular season completed' })
})

it('does not reuse a completed record after the gender changes', async () => {
  render(<LeagueSeasonBoundary {...props} renderActive={active} />)
  await screen.findByRole('heading', { name: 'Regular season completed' })
  act(() => window.dispatchEvent(new CustomEvent('pitchwise:gender-change', { detail: 'women' })))
  expect(screen.getByText('Active season 2026')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('opens a saved simulator URL on observed results after completion', async () => {
  window.history.replaceState({}, '', '/leagues/usa.1?tab=simulator')
  render(<LeagueHomePage {...props} />)
  await screen.findByRole('heading', { name: 'Regular season completed' })
  expect(screen.getByRole('tab', { name: /^overview$/i })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('tab', { name: /simulator/i })).not.toBeInTheDocument()
  expect(jest.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/simulation/'))).toBe(false)
  await act(async () => {})
})
