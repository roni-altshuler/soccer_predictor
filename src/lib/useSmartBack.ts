'use client'

import { useCallback, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * Back affordances on detail pages must return the reader to the page they
 * actually came from — Today, a league page, a bracket — not to a hard-coded
 * parent. `router.back()` alone is wrong the other way: on a deep link or a
 * new tab it leaves the site. So the shell counts in-app route changes for
 * this tab, and a back control calls `router.back()` only when at least one
 * has happened; otherwise it goes to its contextual parent.
 *
 * The counter deliberately fails safe: any uncertainty (popstate, forward
 * button, fresh tab) biases it toward the fallback link, which stays inside
 * the product. The one behaviour this must never produce is back() exiting
 * the site.
 */
const DEPTH_KEY = 'pitchverse.navDepth'

function readDepth(): number {
  try {
    const parsed = Number.parseInt(sessionStorage.getItem(DEPTH_KEY) ?? '', 10)
    return Number.isFinite(parsed) ? parsed : -1
  } catch {
    return -1
  }
}

function writeDepth(value: number) {
  try {
    sessionStorage.setItem(DEPTH_KEY, String(value))
  } catch {
    /* private mode — smart back degrades to the fallback link */
  }
}

/** Mounted once in the app shell. Counts in-app navigations for this tab. */
export function useNavDepthTracker() {
  const pathname = usePathname()

  useEffect(() => {
    // First mount in a fresh tab initialises to 0 (landing is not a
    // navigation); every subsequent pathname change increments.
    writeDepth(readDepth() + 1)
  }, [pathname])

  useEffect(() => {
    // A history pop consumed an entry, and the pathname effect above will
    // re-increment — net -1 keeps the count honest after browser back.
    const onPop = () => writeDepth(Math.max(-1, readDepth() - 2))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
}

/** Returns a click handler: history back when it stays in-app, else fallback. */
export function useSmartBack(fallbackHref: string) {
  const router = useRouter()
  return useCallback(() => {
    if (readDepth() > 0) router.back()
    else router.push(fallbackHref)
  }, [router, fallbackHref])
}
