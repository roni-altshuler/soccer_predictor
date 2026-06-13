'use client'

import { usePathname } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { type ReactNode } from 'react'

import { EASE_OUT } from '@/lib/motion'

/**
 * Animates each route's content in on navigation. Keyed by pathname so a fresh
 * entrance plays every time the path changes — a subtle blur-up + rise that
 * makes navigation feel fluid without an exit animation (App Router unmounts
 * the old tree immediately, so we lean on a polished enter instead).
 *
 * Respects prefers-reduced-motion by rendering statically.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const reduce = useReducedMotion()

  if (reduce) return <>{children}</>

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
      style={{ willChange: 'opacity, transform' }}
    >
      {children}
    </motion.div>
  )
}
