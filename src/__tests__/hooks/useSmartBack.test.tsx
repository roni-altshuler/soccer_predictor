import { renderHook } from '@testing-library/react'
import { useNavDepthTracker, useSmartBack } from '@/lib/useSmartBack'

let pathname = '/'
const back = jest.fn()
const push = jest.fn()
jest.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ back, push }) }))
beforeEach(() => { pathname = '/'; window.history.replaceState(null, '', '/'); jest.clearAllMocks() })

it('keeps Next metadata, assigns depth to new entries, and returns to the previous app route', () => {
  window.history.replaceState({ __NA: true, tree: ['test'] }, '', '/')
  const tracker = renderHook(() => useNavDepthTracker())
  expect(window.history.state.tree).toEqual(['test'])
  const homeState = window.history.state
  // Next navigations may create fresh state without custom fields.
  window.history.pushState({ __NA: true }, '', '/matches/1')
  pathname = '/matches/1'
  tracker.rerender()
  const detailState = window.history.state
  expect(detailState.pitchverseNavigation.depth).toBe(1)
  const handler = renderHook(() => useSmartBack('/?date=2026-10-04'))
  handler.result.current()
  expect(back).toHaveBeenCalledTimes(1)
  // Model a back and then forward into the exact same history entries.
  window.history.replaceState(homeState, '', '/')
  pathname = '/'
  tracker.rerender()
  window.history.replaceState(detailState, '', '/matches/1')
  pathname = '/matches/1'
  tracker.rerender()
  handler.result.current()
  expect(back).toHaveBeenCalledTimes(2)
  expect(push).not.toHaveBeenCalled()
})
it('does not inflate navigation depth on remount or query-only filter entries', () => {
  const tracker = renderHook(() => useNavDepthTracker())
  tracker.rerender()
  window.history.pushState(window.history.state, '', '/?date=2026-10-04')
  tracker.rerender()
  expect(window.history.state.pitchverseNavigation.depth).toBe(0)
})
it('uses the explicit contextual fallback on a fresh detail deep link', () => {
  pathname = '/matches/1'
  window.history.replaceState({ __NA: true }, '', '/matches/1')
  renderHook(() => useNavDepthTracker())
  const handler = renderHook(() => useSmartBack('/?date=2026-10-04&filter=finished'))
  handler.result.current()
  expect(push).toHaveBeenCalledWith('/?date=2026-10-04&filter=finished')
  expect(back).not.toHaveBeenCalled()
})
