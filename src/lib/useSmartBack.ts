'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

const NAV_KEY = 'pitchverseNavigation'
interface NavigationEntry { pathname: string; depth: number }

function readEntry(): NavigationEntry | null {
  const entry = window.history.state?.[NAV_KEY] as NavigationEntry | undefined
  return entry && typeof entry.pathname === 'string' && Number.isSafeInteger(entry.depth) && entry.depth >= 0 ? entry : null
}

/** History entries retain their own depth across back, forward, and reload. */
export function useNavDepthTracker() {
  const pathname = usePathname()
  const previous = useRef<NavigationEntry | null>(null)
  useEffect(() => {
    const entry = readEntry()
    if (entry?.pathname === pathname) {
      previous.current = entry
      return
    }
    const next = { pathname, depth: previous.current ? previous.current.depth + 1 : 0 }
    previous.current = next
    window.history.replaceState({
      ...window.history.state,
      [NAV_KEY]: next,
    }, '')
  }, [pathname])
}

/** Returns a click handler: history back when it stays in-app, else contextual fallback. */
export function useSmartBack(fallbackHref: string) {
  const router = useRouter()
  return useCallback(() => {
    if ((readEntry()?.depth ?? 0) > 0) router.back()
    else router.push(fallbackHref)
  }, [router, fallbackHref])
}
