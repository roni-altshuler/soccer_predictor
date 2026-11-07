import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccuracyPage from '@/app/(app)/accuracy/page'
import { type PublishedPick, type PublishedRecord } from '@/lib/publishedTrackRecord'

let mockGender = 'M'
jest.mock('@/hooks/useGenderQuery', () => ({ useGenderQuery: () => ({ asQueryParam: mockGender }) }))
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null, Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
}))
function game(key: string, correct = true, over: Partial<PublishedPick> = {}): PublishedPick {
  const row: PublishedPick = { key, fixtureUid: key, competitionId: 'eng.1', season: 2026, phase: null,
    date: '2026-08-15', kickoffAt: '2026-08-15T19:00:00Z', home: `Home ${key}`, away: `Away ${key}`,
    generatedAt: '2026-08-15T08:00:00Z', trainedThrough: '2026-08-14', modelVersion: 'saved-v1',
    probabilities: [.2, .6, .2], pick: 'D', actual: correct ? { home: 1, away: 1, outcome: 'D' } : { home: 2, away: 0, outcome: 'H' },
    forecastPeriod: 'regulation', scorelinePeriod: 'regulation', scoreForecast: { home: 1, away: 1 }, scoreForecastStatus: 'recorded', resultPeriod: null, resultEvidence: null,
    settledAt: '2026-08-15T22:00:00Z', status: 'scored', reason: '', ...over }
  if (!('resultPeriod' in over)) row.resultPeriod = row.actual ? 'regulation' : null
  if (!('settledAt' in over) && !row.actual) row.settledAt = null
  if (!('resultEvidence' in over) && row.actual) row.resultEvidence = { provider: 'espn', competitionId: row.competitionId,
    eventId: [...key].map(c => c.codePointAt(0)).join('') || '1', receiptSha256: 'a'.repeat(64), observedAt: row.settledAt!, period: 'regulation' }
  return row
}
const rows = [game('eng'), game('ita', false, { competitionId: 'ita.1' }),
  game('pending', true, { competitionId: 'usa.1', status: 'pending', actual: null, settledAt: null, reason: 'Awaiting a verified final result' }),
  game('retro', true, { status: 'retrospective', generatedAt: '2026-08-15T20:00:00Z', reason: 'Forecast was recorded after kickoff' })]
function artifact(games = rows): PublishedRecord {
  return { schemaVersion: 2, outcomePeriod: 'regulation', cohort: 'immutable_snapshot_history', basis: 'verified_live_published', selection: 'last_before_authoritative_kickoff',
    generatedAt: '2026-08-17T12:00:00Z', historyThrough: '2026-08-15T20:00:00Z', resultThrough: '2026-08-15T22:00:00Z',
    coverageFrom: '2026-08-15', snapshotRows: games.length, snapshotFixtures: games.length, rows: games }
}
const success = (games = rows) => ({ ok: true, json: async () => ({ available: true, record: artifact(games) }) })
beforeEach(() => { mockGender = 'M'; global.fetch = jest.fn().mockResolvedValue(success()) })
afterEach(() => jest.restoreAllMocks())

it('opens on overall accuracy and applies league exploration to the same pick/result rows', async () => {
  render(<AccuracyPage />)
  expect(await screen.findByRole('heading', { name: 'Overall model outcome accuracy' })).toBeVisible()
  const leagues = screen.getByRole('group', { name: 'Choose accuracy league' })
  expect(within(leagues).getByRole('button', { name: /^All leagues/ })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(within(leagues).getByRole('button', { name: /^Serie A/ }))
  expect(screen.getByRole('heading', { name: 'Serie A outcome accuracy' })).toBeVisible()
  const history = screen.getByRole('region', { name: 'Game by game record' })
  expect(within(history).getByText('Home ita vs Away ita')).toBeVisible()
  expect(within(history).queryByText('Home eng vs Away eng')).not.toBeInTheDocument()
  await userEvent.click(within(leagues).getByRole('button', { name: /^All leagues/ }))
  expect(screen.getByRole('heading', { name: 'Overall model outcome accuracy' })).toBeVisible()
  expect(within(history).getByText('Home eng vs Away eng')).toBeVisible()
})

it('shows an away outcome pick separately from an incorrect stored draw scoreline', async () => {
  global.fetch = jest.fn().mockResolvedValue(success([game('away-pick', true, { probabilities: [.2, .3, .5], pick: 'A',
    actual: { home: 2, away: 4, outcome: 'A' }, scoreForecast: { home: 1, away: 1 } })]))
  render(<AccuracyPage />)
  const article = (await screen.findByText('Home away-pick vs Away away-pick')).closest('article')!
  expect(within(article).getByText('Stored outcome pick').nextElementSibling).toHaveTextContent('Away away-pick win')
  expect(within(article).getByText('Correct')).toBeVisible()
  await userEvent.click(within(article).getByText('Advanced: stored exact-score forecast'))
  expect(within(article).getByText('Stored score forecast').nextElementSibling).toHaveTextContent('1–1')
  expect(within(article).getByText('Exact score incorrect')).toBeVisible()
})

it('keeps outcome correctness primary and exact-score accuracy in a separate advanced denominator', async () => {
  global.fetch = jest.fn().mockResolvedValue(success([game('exact'), game('outcome-only', true, { scoreForecast: { home: 0, away: 0 } }),
    game('no-score', true, { scoreForecast: null, scoreForecastStatus: 'missing' })]))
  render(<AccuracyPage />)
  expect(await screen.findByText('100.0% correct')).toBeVisible()
  expect(screen.getByText('3 of 3 games correct')).toBeVisible()
  expect(screen.getByText(/Extra time, penalty shootouts and knockout advancement are not graded here/)).toBeVisible()
  await userEvent.click(screen.getByText('Advanced: exact-score assessment', { exact: true }))
  const advanced = screen.getByLabelText('Advanced exact-score record')
  expect(within(advanced).getByText('50.0% exact scores correct')).toBeVisible()
  expect(within(advanced).getByText('1 of 2 eligible score forecasts correct')).toBeVisible()
  expect(within(advanced).getByText('Eligible outcomes without a stored score forecast').nextElementSibling).toHaveTextContent('1')
  const article = screen.getByText('Home outcome-only vs Away outcome-only').closest('article')!
  expect(within(article).getByText('Correct')).toBeVisible()
  await userEvent.click(within(article).getByText('Advanced: stored exact-score forecast'))
  expect(within(article).getByText('Exact score incorrect')).toBeVisible()
  expect(within(article).getByText('Stored score forecast').nextElementSibling).toHaveTextContent('0–0')
})

it('retains stored scores but shows no percentage when period proof is missing', async () => {
  global.fetch = jest.fn().mockResolvedValue(success([game('held', true, { status: 'unverified', forecastPeriod: null,
    scorelinePeriod: null, actual: null, reason: 'Regulation-time result receipt is missing or invalid' })]))
  render(<AccuracyPage />)
  expect(await screen.findByText('0 of 0 games correct')).toBeVisible()
  expect(screen.queryByText(/0.0% correct/)).not.toBeInTheDocument()
  expect(screen.getByLabelText('History view')).toHaveValue('excluded')
  const article = screen.getByText('Home held vs Away held').closest('article')!
  expect(within(article).getByText('Unverified · not scored')).toBeVisible()
  expect(within(article).getByText('No verified regulation-time result')).toBeVisible()
  await userEvent.click(within(article).getByText('Advanced: stored exact-score forecast'))
  expect(within(article).getByText('Stored score forecast').nextElementSibling).toHaveTextContent('1–1')
  expect(within(article).getByText('Outcome eligibility unverified · not assessed')).toBeVisible()
})

it('reconciles card, timeline and history using exact counts and counts draws', async () => {
  render(<AccuracyPage />)
  expect(await screen.findByText('50.0% correct')).toBeVisible()
  expect(screen.getByText('1 of 2 games correct')).toBeVisible()
  expect(screen.getByText(/Cumulative: 50.0% correct · 1 of 2 games/)).toBeVisible()
  const history = screen.getByRole('region', { name: 'Game by game record' })
  expect(within(history).getByText('Home eng vs Away eng')).toBeVisible()
  expect(within(history).getByText('Correct')).toBeVisible()
  expect(within(history).getByText('Incorrect')).toBeVisible()
  expect(within(history).getAllByText('Actual outcome · 90 minutes')[0].nextElementSibling).toHaveTextContent('Draw')
  expect(global.fetch).toHaveBeenCalledTimes(1)
  expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('/tracking/record?gender=M')
})

it('changes all scoped numbers by competition and preserves thin-sample context', async () => {
  render(<AccuracyPage />)
  await screen.findByText('50.0% correct')
  await userEvent.selectOptions(screen.getByLabelText('Competition'), 'ita.1')
  expect(screen.getByText('0.0% correct')).toBeVisible()
  expect(screen.getByText('0 of 1 games correct')).toBeVisible()
  expect(screen.getByText(/Cumulative: 0.0% correct · 0 of 1 games/)).toBeVisible()
  expect(screen.queryByText('Home eng vs Away eng')).not.toBeInTheDocument()
  expect(screen.getByText(/observed sample, not a promise/)).toBeVisible()
  await userEvent.selectOptions(screen.getByLabelText('Competition'), 'usa.1')
  expect(within(screen.getByRole('region', { name: 'Prediction track record' })).getByText('Not yet scored')).toBeVisible()
  expect(screen.getByText('0 of 0 games correct')).toBeVisible()
  expect(screen.queryByText('0.0% correct')).not.toBeInTheDocument()
  // Pending-only competitions remain inspectable; no market-coverage gate is implied.
  expect(screen.getByRole('option', { name: 'MLS' })).toBeInTheDocument()
  expect(screen.getByLabelText('History view')).toHaveValue('excluded')
  expect(screen.getByText('Home pending vs Away pending')).toBeVisible()
  await userEvent.selectOptions(screen.getByLabelText('Competition'), 'eng.1')
  expect(screen.getByLabelText('History view')).toHaveValue('scored')
  expect(screen.getByText('Home eng vs Away eng')).toBeVisible()
  expect(screen.queryByText('Home retro vs Away retro')).not.toBeInTheDocument()
})

it('preserves an explicit history choice while league filters change', async () => {
  render(<AccuracyPage />)
  await screen.findByText('50.0% correct')
  await userEvent.selectOptions(screen.getByLabelText('History view'), 'excluded')
  await userEvent.selectOptions(screen.getByLabelText('Competition'), 'usa.1')
  expect(screen.getByText('Home pending vs Away pending')).toBeVisible()
  await userEvent.selectOptions(screen.getByLabelText('Competition'), 'eng.1')
  expect(screen.getByLabelText('History view')).toHaveValue('excluded')
  expect(screen.getByText('Home retro vs Away retro')).toBeVisible()
  expect(screen.queryByText('Home eng vs Away eng')).not.toBeInTheDocument()
  expect(screen.getByText('1 of 1 games correct')).toBeVisible()
})

it('filters seasons and dates without changing only a label, and resets the whole scope', async () => {
  global.fetch = jest.fn().mockResolvedValue(success([...rows, game('old', true, { season: 2025 })]))
  render(<AccuracyPage />)
  await screen.findByText('66.7% correct')
  await userEvent.selectOptions(screen.getByLabelText('Season'), '2025')
  expect(screen.getByText('1 of 1 games correct')).toBeVisible()
  await userEvent.clear(screen.getByLabelText('Games from (UTC)'))
  // HTML date inputs are changed directly because user-event typing varies in jsdom.
  fireEvent.change(screen.getByLabelText('Games from (UTC)'), { target: { value: '2026-08-16' } })
  expect(within(screen.getByRole('region', { name: 'Prediction track record' })).getByText('Not yet scored')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Games through (UTC)'), { target: { value: '2026-08-14' } })
  expect(screen.getByRole('alert')).toHaveTextContent('Choose an end date')
  await userEvent.click(screen.getByRole('button', { name: 'Show the whole record' }))
  expect(screen.getByText('2 of 3 games correct')).toBeVisible()
})

it('keeps retrospectively recorded picks out of the score and explains every exclusion', async () => {
  render(<AccuracyPage />)
  await screen.findByText('50.0% correct')
  await userEvent.selectOptions(screen.getByLabelText('History view'), 'excluded')
  expect(screen.getByText('Home retro vs Away retro')).toBeVisible()
  expect(screen.getByText('Recorded after kickoff · not scored')).toBeVisible()
  const article = screen.getByText('Home retro vs Away retro').closest('article')!
  expect(within(article).getByText('Actual outcome · 90 minutes').nextElementSibling).toHaveTextContent('Draw')
  await userEvent.click(within(article).getByText('Forecast and verification details'))
  expect(within(article).getByText(/Forecast was recorded after kickoff. Excluded/)).toBeVisible()
  expect(screen.getByText('1 of 2 games correct')).toBeVisible()
  expect(screen.getByRole('link', { name: /Separate historical backtests/ })).toHaveAttribute('href', '/evaluation')
  expect(screen.getByText(/legacy aggregates use different timing checks/)).toBeInTheDocument()
})

it('offers keyboard/touch point controls and an equivalent exact-denominator data table', async () => {
  global.fetch = jest.fn().mockResolvedValue(success([game('first', true, { date: '2026-08-08', kickoffAt: '2026-08-08T19:00:00Z', generatedAt: '2026-08-08T08:00:00Z', trainedThrough: '2026-08-07', settledAt: '2026-08-08T22:00:00Z' }), ...rows]))
  render(<AccuracyPage />)
  await screen.findByText('66.7% correct')
  expect(screen.getByRole('slider', { name: 'Inspect timeline point' })).toHaveAttribute('aria-valuetext', expect.stringContaining('2 correct of 3 settled'))
  await userEvent.click(screen.getByRole('button', { name: 'Previous date' }))
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', expect.stringContaining('1 correct of 1 settled'))
  await userEvent.selectOptions(screen.getByLabelText('Calendar grouping'), 'day')
  await userEvent.click(screen.getByText('Timeline data table'))
  expect(screen.getByRole('table', { name: 'Every chart point and its exact count denominators' })).toBeVisible()
  expect(screen.getByText(/last 20 settled games, or all available when fewer/)).toBeVisible()
})

it('paginates every pick without changing the overall denominator', async () => {
  global.fetch = jest.fn().mockResolvedValue(success(Array.from({ length: 26 }, (_, i) => game(String(i).padStart(2, '0')))))
  render(<AccuracyPage />)
  await screen.findByText('26 of 26 games correct')
  expect(screen.getByText('Page 1 of 2')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Next games' }))
  expect(screen.getByText('Home 25 vs Away 25')).toBeVisible()
  expect(screen.queryByText('Home 00 vs Away 00')).not.toBeInTheDocument()
  expect(screen.getByText('26 of 26 games correct')).toBeVisible()
})

it('keeps missing data as unavailable with a working retry, not a fake zero', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ available: false, reason: 'Unreadable artifact.' }) }).mockResolvedValueOnce(success())
  render(<AccuracyPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Record unavailable')
  expect(screen.queryByText('0.0% correct')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('50.0% correct')).toBeVisible()
})

it('reports valid zero evidence and source freshness without any fabricated percentage', async () => {
  global.fetch = jest.fn().mockResolvedValue(success([]))
  render(<AccuracyPage />)
  await screen.findByText('0 of 0 games correct')
  expect(within(screen.getByRole('region', { name: 'Prediction track record' })).getByText('Not yet scored')).toBeVisible()
  expect(screen.getByText('0 of 0 games correct')).toBeVisible()
  expect(screen.getByText(/A newly rebuilt audit can still contain older source observations/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'Open verified record data' })).toHaveAttribute('href', '/api/v1/tracking/record?gender=M')
})

it('does not flash another gender’s record or accept a late aborted response', async () => {
  let release!: (value: unknown) => void
  global.fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ available: false, reason: 'No verified women’s match ledger has been published.' }) })
  const view = render(<AccuracyPage />)
  mockGender = 'F'; view.rerender(<AccuracyPage />)
  await screen.findByRole('alert')
  await act(async () => release(success()))
  expect(screen.queryByText('50.0% correct')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('women’s match ledger')
})
