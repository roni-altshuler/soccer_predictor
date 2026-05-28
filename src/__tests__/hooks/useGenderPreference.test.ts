import { act, renderHook } from '@testing-library/react'

import { useGenderPreference } from '@/hooks/useGenderPreference'

/**
 * State-safety guard for the gender preference hook.
 *
 * The hook was originally rebroadcasting only via the DOM `storage` event,
 * which fires in OTHER tabs but NOT the originating tab. That bug caused
 * sibling components on the same page to keep stale gender state when one
 * of them toggled. Phase 1 added a same-tab CustomEvent broadcast.
 *
 * These tests pin that contract:
 *   - calling setGender on one hook instance updates every other instance
 *     in the same tab via the CustomEvent path
 *   - the storage event still works for cross-tab updates
 *   - the localStorage value reflects the latest selection
 */

beforeEach(() => {
  window.localStorage.clear()
})

describe('useGenderPreference', () => {
  it('starts at the default ("men") when localStorage is empty', () => {
    const { result } = renderHook(() => useGenderPreference())
    expect(result.current.gender).toBe('men')
  })

  it('hydrates from localStorage on mount', () => {
    window.localStorage.setItem('fotpredict.gender', 'women')
    const { result } = renderHook(() => useGenderPreference())
    expect(result.current.gender).toBe('women')
  })

  it('persists the choice to localStorage when setGender is called', () => {
    const { result } = renderHook(() => useGenderPreference())
    act(() => {
      result.current.setGender('women')
    })
    expect(window.localStorage.getItem('fotpredict.gender')).toBe('women')
    expect(result.current.gender).toBe('women')
  })

  it('broadcasts same-tab CustomEvent so sibling hook instances re-sync', () => {
    // Two independent hook instances on the same "page". They must reflect
    // the same gender after either of them toggles.
    const a = renderHook(() => useGenderPreference())
    const b = renderHook(() => useGenderPreference())
    expect(a.result.current.gender).toBe('men')
    expect(b.result.current.gender).toBe('men')

    act(() => {
      a.result.current.setGender('women')
    })

    expect(a.result.current.gender).toBe('women')
    expect(b.result.current.gender).toBe('women') // ← was the Phase 1 bug
  })

  it('toggle() flips between men and women', () => {
    const { result } = renderHook(() => useGenderPreference())
    act(() => {
      result.current.toggle()
    })
    expect(result.current.gender).toBe('women')
    act(() => {
      result.current.toggle()
    })
    expect(result.current.gender).toBe('men')
  })

  it('responds to storage events (cross-tab updates)', () => {
    const { result } = renderHook(() => useGenderPreference())
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'fotpredict.gender',
          newValue: 'women',
        }),
      )
    })
    expect(result.current.gender).toBe('women')
  })

  it('ignores storage events for unrelated keys', () => {
    const { result } = renderHook(() => useGenderPreference())
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'some-other-key',
          newValue: 'women',
        }),
      )
    })
    expect(result.current.gender).toBe('men') // unchanged
  })
})
