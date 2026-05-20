'use client'

import { useEffect, useRef, useState } from 'react'
import { animate, useInView, useMotionValue, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/utils'

export interface AnimatedCounterProps {
  /** Final numeric value to count up to. */
  value: number
  /** Decimal digits to render (default 0). */
  digits?: number
  /** Optional prefix (e.g. "$"). */
  prefix?: string
  /** Optional suffix (e.g. "%"). */
  suffix?: string
  /** Animation duration in seconds (default 1.4). Honours prefers-reduced-motion. */
  duration?: number
  /** Restart the animation each time the element scrolls into view. */
  restartOnInView?: boolean
  className?: string
  /** Use a fixed-width tabular font so the number does not "wobble" as digits change. */
  tabular?: boolean
}

/**
 * KPI counter that smoothly counts up to `value`. Uses Framer Motion's
 * `animate` driver, so the easing is GPU-friendly and respects
 * `prefers-reduced-motion` (the value snaps to the final number when
 * reduced motion is preferred).
 */
export function AnimatedCounter({
  value,
  digits = 0,
  prefix = '',
  suffix = '',
  duration = 1.4,
  restartOnInView = true,
  className,
  tabular = true,
}: AnimatedCounterProps) {
  const motionValue = useMotionValue(0)
  const [display, setDisplay] = useState('0')
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement | null>(null)
  const inView = useInView(ref, { once: !restartOnInView, amount: 0.3 })

  useEffect(() => {
    const unsubscribe = motionValue.on('change', (latest) => {
      setDisplay(latest.toFixed(digits))
    })
    return () => unsubscribe()
  }, [motionValue, digits])

  useEffect(() => {
    if (!inView) return
    if (reduce) {
      motionValue.set(value)
      setDisplay(value.toFixed(digits))
      return
    }
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
    })
    return () => controls.stop()
  }, [inView, value, reduce, duration, motionValue, digits])

  return (
    <span
      ref={ref}
      className={cn(tabular && 'tabular-nums', className)}
      aria-label={`${prefix}${value.toFixed(digits)}${suffix}`}
    >
      {prefix}
      {display}
      {suffix}
    </span>
  )
}
