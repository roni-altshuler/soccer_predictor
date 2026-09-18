import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

import { useMatchday } from '@/hooks/useMatchday'

const day = (name: string) => ({ live: [], upcoming: [{ id: name, home_team: name, away_team: 'Visitors', league: 'Premier League', status: 'upcoming' }], completed: [] })
const response = (name: string) => ({ ok: true, json: async () => day(name) })

afterEach(() => { cleanup(); jest.useRealTimers(); jest.restoreAllMocks() })

it('clears the old date immediately and ignores a late response from it', async () => {
  let resolveOld!: (value: unknown) => void
  global.fetch = jest.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    .mockResolvedValueOnce(response('New day'))
  const { result, rerender } = renderHook(({ date }) => useMatchday(date, 'M'), { initialProps: { date: '2026-09-18' } })
  rerender({ date: '2026-09-19' })
  expect(result.current.data).toBeUndefined()
  await waitFor(() => expect(result.current.data?.upcoming[0].home_team).toBe('New day'))
  await act(async () => { resolveOld(response('Old day')) })
  expect(result.current.data?.upcoming[0].home_team).toBe('New day')
})

it('retains scores during polling and a failed refresh, then recovers', async () => {
  jest.useFakeTimers()
  global.fetch = jest.fn().mockResolvedValueOnce(response('Arsenal')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response('Updated'))
  const { result } = renderHook(() => useMatchday('2026-09-18', 'M'))
  await act(async () => {})
  expect(result.current.data?.upcoming[0].home_team).toBe('Arsenal')
  await act(async () => { jest.advanceTimersByTime(60_000) })
  expect(result.current.loading).toBe(false)
  expect(result.current.data?.upcoming[0].home_team).toBe('Arsenal')
  expect(result.current.error).toBeTruthy()
  await act(async () => { result.current.retry() })
  expect(result.current.data?.upcoming[0].home_team).toBe('Updated')
  expect(result.current.error).toBeUndefined()
})

it('does not present a server error or malformed payload as an empty matchday', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...day(''), source: 'error' }) })
  const { result } = renderHook(() => useMatchday('2026-09-18', 'M'))
  await waitFor(() => expect(result.current.error).toBeTruthy())
  expect(result.current.data).toBeUndefined()
})

it('does not poll a hidden tab and refreshes when the reader returns', async () => {
  jest.useFakeTimers()
  const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  global.fetch = jest.fn().mockResolvedValue(response('Arsenal'))
  renderHook(() => useMatchday('2026-09-18', 'M'))
  await act(async () => {})
  await act(async () => { jest.advanceTimersByTime(60_000) })
  expect(fetch).toHaveBeenCalledTimes(1)
  visibility.mockReturnValue('visible')
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(fetch).toHaveBeenCalledTimes(2)
})
