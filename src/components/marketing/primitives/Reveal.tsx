'use client'

import { type ReactNode, useRef } from 'react'
import { motion, useInView, useReducedMotion, type Variants } from 'framer-motion'

/**
 * Scroll-reveal wrapper used across the marketing landing. Fades + lifts its
 * children into view once, the first time they cross the viewport threshold.
 *
 * Honours `prefers-reduced-motion` exactly like the existing HeroSpotlight:
 * when reduced, the initial offset is dropped (`initial={false}`) so content
 * renders in its final position with no transform.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 24,
  as = 'div',
}: {
  children: ReactNode
  className?: string
  /** Stagger delay in seconds. */
  delay?: number
  /** Initial vertical offset in px. */
  y?: number
  as?: 'div' | 'li' | 'section'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, margin: '-12% 0px' })

  const MotionTag = motion[as] as typeof motion.div

  // `initial` is kept constant (never branched on `useReducedMotion`) so the
  // server and first client render agree — avoids a hydration mismatch for
  // visitors whose reduced-motion preference differs from the SSR default.
  // Reduced-motion users simply snap to the visible state instantly.
  return (
    <MotionTag
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={inView || reduce ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={reduce ? { duration: 0 } : { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </MotionTag>
  )
}

/**
 * Stagger container — pair with <RevealItem> children for a coordinated
 * cascade (used by the feature bento and stat grids).
 */
const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
}

export function RevealGroup({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })

  return (
    <motion.div
      ref={ref}
      className={className}
      variants={containerVariants}
      initial="hidden"
      animate={inView || reduce ? 'show' : 'hidden'}
      transition={reduce ? { duration: 0, staggerChildren: 0 } : undefined}
    >
      {children}
    </motion.div>
  )
}

export function RevealItem({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  // Variants object is a module constant, so it's identical on server and
  // client — no hydration mismatch. The parent RevealGroup collapses the
  // stagger to 0 under reduced-motion.
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  )
}
