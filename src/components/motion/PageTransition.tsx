'use client'

import { usePathname } from 'next/navigation'
import { type ReactNode } from 'react'

/**
 * A fast fade on route change — just enough to smooth the swap, never enough
 * to be waited on. The previous version ran 400ms with a 12px rise and a
 * 6px blur, which put a visible animation between every tap and its page;
 * blur in particular forces the compositor to repaint the whole tree. The
 * sibling apps ship no entrance animation at all, so this errs their way.
 *
 * Respects prefers-reduced-motion by rendering statically.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <div
      key={pathname}
      className="animate-in fade-in duration-150 motion-reduce:animate-none"
    >
      {children}
    </div>
  )
}
