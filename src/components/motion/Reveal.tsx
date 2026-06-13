'use client'

import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion'
import { type ReactNode } from 'react'

import { EASE_OUT } from '@/lib/motion'

interface RevealProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode
  /** Stagger offset in seconds when several Reveals are siblings. */
  delay?: number
  /** Travel distance in px (default 22). */
  y?: number
  className?: string
}

/**
 * Scroll-reveal wrapper. Fades + rises its children into view the first time
 * they enter the viewport, then stays put. Pure framer-motion `whileInView`,
 * so no IntersectionObserver bookkeeping at the call site. Reduced-motion
 * renders the content immediately.
 */
export function Reveal({ children, delay = 0, y = 22, className, ...rest }: RevealProps) {
  const reduce = useReducedMotion()

  if (reduce) return <div className={className}>{children}</div>

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-12% 0px -8% 0px' }}
      transition={{ duration: 0.6, ease: EASE_OUT, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
