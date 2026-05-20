'use client'

import { useCallback, useMemo } from 'react'

import { useGenderPreference, type GenderPreference } from '@/hooks/useGenderPreference'

/**
 * Convenience wrapper around `useGenderPreference` that gives every
 * data-fetching call site the same gender query-param string.
 *
 * Usage:
 *
 *   const { gender, asQueryParam, withParam } = useGenderQuery()
 *
 *   fetch(`/api/todays_matches?date=${date}&gender=${asQueryParam}`)
 *   fetch(withParam('/api/v1/tracking/accuracy'))
 *
 * Centralising the conversion ensures we never forget to thread the
 * gender — and lets us swap the convention later (e.g. 'men'/'women' vs
 * 'M'/'F') in one place.
 */
export interface UseGenderQuery {
  /** Raw preference string from localStorage ('men' | 'women'). */
  gender: GenderPreference
  /** Backend's canonical single-letter value: 'M' or 'F'. */
  asQueryParam: 'M' | 'F'
  /** Append the gender query parameter to a URL, preserving any existing query. */
  withParam: (url: string) => string
  /** Setter from `useGenderPreference`, re-exported for one-stop convenience. */
  setGender: (value: GenderPreference) => void
  toggle: () => void
}

export function useGenderQuery(): UseGenderQuery {
  const { gender, setGender, toggle } = useGenderPreference()
  const asQueryParam = useMemo<'M' | 'F'>(() => (gender === 'women' ? 'F' : 'M'), [gender])

  const withParam = useCallback(
    (url: string) => {
      const sep = url.includes('?') ? '&' : '?'
      return `${url}${sep}gender=${asQueryParam}`
    },
    [asQueryParam]
  )

  return { gender, asQueryParam, setGender, toggle, withParam }
}
