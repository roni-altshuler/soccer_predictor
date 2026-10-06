import { act, cleanup, render, renderHook } from '@testing-library/react'

import { MatchdayUrlSync } from '@/components/match/MatchdayUrlSync'
import { useMatchdayNavigation } from '@/hooks/useMatchdayNavigation'
import { localDateKey, type MatchdayView } from '@/lib/matchdayNavigation'

let query = ''
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query) }))

beforeEach(() => {
  query = ''
  window.history.replaceState({ __NA: true, tree: ['test'] }, '', '/')
})
afterEach(() => { cleanup(); jest.restoreAllMocks() })

it.each(['cold', 'controls'])('syncs a same-path home navigation after %s selection and restores history', (selection) => {
  const selected: MatchdayView = { date: '2026-09-19', filter: 'upcoming', competition: 'Premier League', following: true }
  if (selection === 'cold') {
    query = 'date=2026-09-19&filter=upcoming&competition=Premier+League&following=1'
    window.history.replaceState(window.history.state, '', `/?${query}`)
  }
  const { result } = renderHook(() => useMatchdayNavigation(false))
  const observer = render(<MatchdayUrlSync onChange={result.current.syncLocation} />)
  const rerender = () => observer.rerender(<MatchdayUrlSync onChange={result.current.syncLocation} />)
  const originalPush = window.history.pushState.bind(window.history)
  // Next skips its search subscription for internal pushes carrying __NA.
  // Native pushes publish the URL and receive Next's metadata automatically.
  jest.spyOn(window.history, 'pushState').mockImplementation((state, title, url) => {
    originalPush({ ...state, __NA: true }, title, url)
    if (!state?.__NA && !state?._N) query = window.location.search.slice(1)
  })
  if (selection === 'controls') {
    act(() => { result.current.update(selected) })
    rerender()
    expect(window.history.state.__NA).toBe(true)
    expect(window.history.state.tree).toEqual(['test'])
  }
  expect(result.current.view).toEqual(selected)
  const filteredUrl = `${window.location.pathname}${window.location.search}`
  const filteredState = window.history.state
  // Next push changes the search subscription, but does not emit popstate.
  window.history.pushState({ __NA: true, tree: ['home'] }, '', '/')
  query = ''
  rerender()
  expect(result.current.view).toEqual({ date: localDateKey(new Date()), filter: 'all', competition: 'all', following: false })
  expect(window.history.state.tree).toEqual(['home'])

  act(() => {
    window.history.replaceState(filteredState, '', filteredUrl)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  query = window.location.search.slice(1)
  rerender()
  expect(result.current.view).toEqual(selected)
  act(() => {
    window.history.replaceState({ __NA: true, tree: ['home'] }, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  query = ''
  rerender()
  expect(result.current.view.filter).toBe('all')
  expect(result.current.view.competition).toBe('all')
  expect(result.current.view.following).toBe(false)
})
