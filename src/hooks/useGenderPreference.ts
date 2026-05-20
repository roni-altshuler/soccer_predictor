'use client'

import { useCallback, useEffect, useState } from 'react'

export type GenderPreference = 'men' | 'women'

const STORAGE_KEY = 'fotpredict.gender'
const DEFAULT: GenderPreference = 'men'

/**
 * Persist a user's preference for men's vs women's football across page
 * loads (localStorage) and re-emit changes across tabs (`storage` events).
 *
 * Components that fetch from the prediction APIs should attach
 * `?gender=${gender}` to their request URLs. The backend stream is
 * expected to accept this query param — see UI_AGENT_BACKEND_REQUESTS.md.
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
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setGender = useCallback((value: GenderPreference) => {
    setGenderState(value)
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      /* ignore */
    }
  }, [])

  const toggle = useCallback(() => {
    setGender(gender === 'men' ? 'women' : 'men')
  }, [gender, setGender])

  return { gender, setGender, toggle }
}
