'use client'

import { useCallback, useEffect, useState } from 'react'

export type GenderPreference = 'men' | 'women'

const STORAGE_KEY = 'fotpredict.gender'
const DEFAULT: GenderPreference = 'men'

// Same-tab broadcast channel. The DOM `storage` event only fires in OTHER
// tabs, so without this, sibling components on the same page that each
// instantiate this hook would keep their own stale `gender` state when
// the user toggled. The CustomEvent re-syncs them in the originating tab.
const SAME_TAB_EVENT = 'pitchwise:gender-change'

/**
 * Persist a user's preference for men's vs women's football across page
 * loads (localStorage) and broadcast changes both across tabs (`storage`
 * events) AND across hook instances in the same tab (`CustomEvent`).
 *
 * Components that fetch from the prediction APIs should attach
 * `?gender=${gender}` to their request URLs via `useGenderQuery`.
 */
export function useGenderPreference(): {
  gender: GenderPreference
  setGender: (value: GenderPreference) => void
  toggle: () => void
} {
  const [gender, setGenderState] = useState<GenderPreference>(DEFAULT)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === 'men' || stored === 'women') {
        setGenderState(stored)
      }
    } catch {
      /* localStorage unavailable in SSR or some private modes — fine */
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      if (e.newValue === 'men' || e.newValue === 'women') {
        setGenderState(e.newValue)
      }
    }
    const onSameTab = (e: Event) => {
      const detail = (e as CustomEvent<GenderPreference>).detail
      if (detail === 'men' || detail === 'women') {
        setGenderState(detail)
      }
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(SAME_TAB_EVENT, onSameTab)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(SAME_TAB_EVENT, onSameTab)
    }
  }, [])

  const setGender = useCallback((value: GenderPreference) => {
    setGenderState(value)
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
      window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT, { detail: value }))
    } catch {
      /* ignore */
    }
  }, [])

  const toggle = useCallback(() => {
    setGender(gender === 'men' ? 'women' : 'men')
  }, [gender, setGender])

  return { gender, setGender, toggle }
}
