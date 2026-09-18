import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ForecastLab } from '@/components/forecast/ForecastLab'
import { labFromArtifact, pointsScenario, validLabFixture, type LabFixture } from '@/lib/forecastLab'

const fixture: LabFixture = { fixture_uid: 'abc', competition_id: 'eng.1', season: 2026, date: '2026-09-20', kickoff: null, home: 'Arsenal', away: 'Fulham', p_home: .6, p_draw: .25, p_away: .15, xg_home: 1.8, xg_away: .9, scorelines: [{ score: '1-0', p: .15 }, { score: '2-0', p: .13 }] }
const artifact = { generated_at: '2026-09-18T12:00:00Z', fixtures: [fixture], method: { model_version: 'v1', trained_through: '2026-09-17' } }
const data = labFromArtifact(artifact, new Date('2026-09-18T12:00:00Z'))

beforeEach(() => localStorage.clear())

it('withholds malformed forecasts and excludes past dates', () => {
  expect(validLabFixture({ ...fixture, p_home: 2 })).toBe(false)
  expect(validLabFixture({ ...fixture, xg_away: NaN })).toBe(false)
  expect(validLabFixture({ ...fixture, scorelines: [{ score: '1-0', p: .8 }, { score: '2-0', p: .8 }] })).toBe(false)
  const result = labFromArtifact({ ...artifact, fixtures: [fixture, { ...fixture, p_draw: -1 }, { ...fixture, date: '2026-09-01' }] }, new Date('2026-09-18'))
  expect(result.fixtures).toEqual([fixture])
  expect(result.excluded).toBe(1)
})

it('includes a shared future fixture outside the default browsing window', () => {
  const future = { ...fixture, fixture_uid: 'later', date: '2027-01-01' }
  const input = { ...artifact, fixtures: [fixture, future] }
  expect(labFromArtifact(input, new Date('2026-09-18')).fixtures).toHaveLength(1)
  expect(labFromArtifact(input, new Date('2026-09-18'), 'later').fixtures).toHaveLength(2)
})

it('keeps hypothetical points separate from model probabilities', async () => {
  expect(pointsScenario(fixture, 'D').conditional).toEqual([1, 1])
  expect(pointsScenario(fixture, null).expected[0]).toBeCloseTo(2.05)
  render(<ForecastLab initialData={data} />)
  await userEvent.click(screen.getByRole('button', { name: /Away win/ }))
  expect(screen.getByRole('heading', { name: 'If the away side wins…' })).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Selected forecast' })).getByText('60.0%')).toBeInTheDocument()
  expect(screen.getByText('A hypothetical result, not a new prediction.', { exact: false })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(screen.getByRole('heading', { name: 'What could this match mean?' })).toBeInTheDocument()
})

it('offers a recoverable empty search', async () => {
  render(<ForecastLab initialData={data} />)
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search clubs' }), 'No such club')
  expect(screen.queryByRole('region', { name: 'Selected forecast' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Show all matches' }))
  expect(screen.getByRole('region', { name: 'Selected forecast' })).toBeInTheDocument()
})
