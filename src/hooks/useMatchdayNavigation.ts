'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { localDateKey, matchdayHref, readMatchdayView, type MatchdayView } from '@/lib/matchdayNavigation'

const SCROLL_KEY = 'pitchverseMatchdayScroll'

/** URL owns the view; scroll belongs to the current history entry. */
export function useMatchdayNavigation(ready: boolean) {
  const [view, setView] = useState<MatchdayView>({ date: '', filter: 'all', competition: 'all', following: false })
  const restoring = useRef(true)
  const restoreY = useRef(0)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const read = () => {
      restoring.current = true
      restoreY.current = Number(window.history.state?.[SCROLL_KEY]) || 0
      setView(readMatchdayView(new URLSearchParams(window.location.search), localDateKey(new Date())))
      setRevision((n) => n + 1)
    }
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])

  const saveScroll = useCallback(() => {
    if (restoring.current) return
    window.history.replaceState({ ...window.history.state, [SCROLL_KEY]: window.scrollY }, '')
  }, [])
  useEffect(() => {
    window.addEventListener('scroll', saveScroll, { passive: true })
    window.addEventListener('pagehide', saveScroll)
    return () => {
      window.removeEventListener('scroll', saveScroll)
      window.removeEventListener('pagehide', saveScroll)
    }
  }, [saveScroll])

  useEffect(() => {
    if (!ready || !view.date || !restoring.current) return
    // Wait for the fetched fixture rows to enter layout before restoring.
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: restoreY.current, behavior: 'instant' })
      restoring.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [ready, view.date, revision])

  const update = useCallback((change: Partial<MatchdayView>) => {
    saveScroll()
    const next = { ...view, ...change }
    const href = matchdayHref(next, new URLSearchParams(window.location.search))
    if (href !== `${window.location.pathname}${window.location.search}`) {
      // Preserve Next's history metadata and give this selection its own entry.
      window.history.pushState({ ...window.history.state, [SCROLL_KEY]: window.scrollY }, '', href)
    }
    setView(next)
  }, [view, saveScroll])

  return { view, update, saveScroll, returnHref: view.date ? matchdayHref(view, new URLSearchParams(window.location.search)) : '/' }
}
