import { promises as fs } from 'fs'
import { render, screen, within } from '@testing-library/react'
import LeaguesPage from '@/app/(app)/leagues/page'
import { completedArtifact } from '@/testFixtures/completedRegularSeason'

jest.mock('@/components/forecast/ScheduleRefreshNotice', () => ({
  ScheduleRefreshNotice: () => <p>Schedule refresh retained</p>,
}))

afterEach(() => jest.restoreAllMocks())

it('shows the completed observed season while retaining ordinary published title races', async () => {
  const completed = completedArtifact()
  const raw = { ...completed, leagues: [...completed.leagues, {
    competition_id: 'eng.1', season: 2026, fixtures_remaining: 280, teams: 20,
    table: [{ team: 'Arsenal', p_title: 0.75 }],
  }] }
  jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(raw))
  render(await LeaguesPage())
  const mls = within(screen.getByRole('link', { name: /MLS USA/ }))
  expect(mls.getByText('Regular season completed')).toBeInTheDocument()
  expect(mls.getByText(/30 clubs · 510 matches/)).toBeInTheDocument()
  expect(mls.getByText('2026-11-07')).toBeInTheDocument()
  expect(mls.queryByText(/No projection/)).not.toBeInTheDocument()
  expect(mls.queryByText(/Shield race/)).not.toBeInTheDocument()
  expect(screen.getByText('Schedule refresh retained')).toBeInTheDocument()
  const english = screen.getByRole('link', { name: /Premier League/ })
  expect(english).toHaveTextContent('Arsenal')
  expect(english).toHaveTextContent('75%')
})

it('does not draw probabilities from a malformed completed node', async () => {
  const raw = completedArtifact()
  Object.assign(raw.leagues[0], { table: [{ team: 'Fabricated favourite', p_title: 1 }], observed_table: [] })
  jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(raw))
  render(await LeaguesPage())
  const mls = screen.getByRole('link', { name: /MLS USA/ })
  expect(mls).toHaveTextContent('Verified season record unavailable')
  expect(mls).not.toHaveTextContent(/100%|Fabricated favourite|Regular season completed/)
})
