'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { GLOBAL_CONTEXT, type CompanionContext } from '@/lib/companion/context'

/**
 * Ask Pitchverse — the subject channel.
 *
 * The rail is mounted once in the app shell, but the thing it interprets lives
 * in whatever page happens to be rendered. This provider is the one-way channel
 * between them: a page publishes what it is about, the rail reads it.
 *
 * Pages publish via `useCompanionSubject`, which clears on unmount. That
 * teardown matters more than it looks — a stale subject would leave the rail
 * confidently answering questions about the match you just navigated away from,
 * which is the exact failure the honesty gates elsewhere are written to prevent.
 */

interface CompanionState {
  context: CompanionContext
  setSubject: (ctx: CompanionContext | null) => void
}

const CompanionCtx = createContext<CompanionState>({
  context: GLOBAL_CONTEXT,
  setSubject: () => {},
})

export function CompanionProvider({ children }: { children: ReactNode }) {
  const [subject, setSubjectState] = useState<CompanionContext | null>(null)

  const setSubject = useCallback((ctx: CompanionContext | null) => {
    setSubjectState(ctx)
  }, [])

  const value = useMemo<CompanionState>(
    () => ({ context: subject ?? GLOBAL_CONTEXT, setSubject }),
    [subject, setSubject]
  )

  return <CompanionCtx.Provider value={value}>{children}</CompanionCtx.Provider>
}

export function useCompanion(): CompanionState {
  return useContext(CompanionCtx)
}

/**
 * Publish this page's subject to the rail for as long as the page is mounted.
 *
 * Callers build the context inline (`useCompanionSubject({ kind: 'match', … })`)
 * so the object identity changes every render; the effect is therefore keyed on
 * the serialized value rather than the reference, which keeps a match page that
 * re-renders on every clock tick from thrashing the provider.
 */
export function useCompanionSubject(ctx: CompanionContext | null): void {
  const { setSubject } = useCompanion()
  const key = ctx ? JSON.stringify(ctx) : null

  useEffect(() => {
    setSubject(key ? (JSON.parse(key) as CompanionContext) : null)
    return () => setSubject(null)
  }, [key, setSubject])
}
