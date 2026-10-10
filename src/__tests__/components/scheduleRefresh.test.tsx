import { render, screen, within } from '@testing-library/react'
import { ScheduleRefreshNotice } from '@/components/forecast/ScheduleRefreshNotice'
import { SCHEDULE_SCOPE } from '@/lib/scheduleRefresh'

const stamp = '2026-10-09T14:33:00Z'
const checked = { schema_version: 1, state: 'checked', attempted_at: stamp, requests: 6, request_limit: 6,
  leagues: SCHEDULE_SCOPE.map((id) => ({ competition_id: id, season: id === 'usa.1' ? '2026' : '2026-2027', last_verified_at: stamp })) }
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/leagues/eng.1'); global.fetch = jest.fn() })
afterEach(() => jest.restoreAllMocks())

it('reports an initially unreadable check as unknown, not fresh', async () => {
  jest.mocked(fetch).mockResolvedValue({ ok: false } as Response)
  render(<ScheduleRefreshNotice competitionId="eng.1" />)
  const notice = await screen.findByRole('status', { name: 'Schedule freshness' })
  expect(notice).toHaveTextContent('Schedule refresh status unavailable')
  expect(notice).toHaveTextContent('A forecast build date does not verify')
  expect(notice.querySelector('time')).toBeNull()
})
it('distinguishes attempted checks from last successful fixture verification', async () => {
  const old = '2026-09-01T10:00:00Z'
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ...checked, state: 'degraded', requests: 1,
    leagues: checked.leagues.map((r) => ({ ...r, last_verified_at: old })) }) } as Response)
  render(<ScheduleRefreshNotice competitionId="eng.1" />)
  const notice = await screen.findByText('Schedule refresh unavailable')
  const region = within(notice.closest('aside')!)
  expect(region.getByText(/kickoff times and postponements may be outdated/)).toBeInTheDocument()
  expect(region.getByText(/Last successful schedule check/)).toBeInTheDocument()
  expect(notice.closest('aside')!.querySelectorAll('time')[0]).toHaveAttribute('datetime', stamp)
  expect(notice.closest('aside')!.querySelectorAll('time')[1]).toHaveAttribute('datetime', old)
})
it('labels a successful check as fixtures, without claiming current results', async () => {
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => checked } as Response)
  render(<ScheduleRefreshNotice />)
  await screen.findByText('Schedule last checked')
  expect(screen.getByText('This verifies fixtures, not the latest results.')).toBeInTheDocument()
  expect(screen.getByRole('status').querySelector('time')).toHaveAttribute('datetime', stamp)
  expect(fetch).toHaveBeenCalledWith('/api/v1/season/refresh-status?gender=M', expect.objectContaining({ cache: 'no-store' }))
})
it.each(['women', 'unsupported'])('withholds the men’s six-league status for %s', async (scope) => {
  if (scope === 'women') localStorage.setItem('fotpredict.gender', 'women')
  render(<ScheduleRefreshNotice competitionId={scope === 'unsupported' ? 'uefa.champions' : 'eng.1'} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})
