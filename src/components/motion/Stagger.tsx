'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { type ReactNode } from 'react'

import { staggerContainer, staggerItem } from '@/lib/motion'

/**
 * Container that staggers its <StaggerItem> children in. Animates on scroll
 * into view (once). Reduced-motion renders children immediately.
 */
export function Stagger({
  children,
  className,
  stagger = 0.06,
  delay = 0,
  inView = true,
}: {
  children: ReactNode
  className?: string
  stagger?: number
  delay?: number
  /** When false, animates on mount instead of on scroll-into-view. */
  inView?: boolean
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>

  return (
    <motion.div
      className={className}
      variants={staggerContainer(stagger, delay)}
      initial="hidden"
      {...(inView
        ? { whileInView: 'visible', viewport: { once: true, margin: '-10% 0px' } }
        : { animate: 'visible' })}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} variants={staggerItem}>
      {children}
    </motion.div>
  )
}
