'use client'

import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { useInView, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/utils'

interface NumberTickerProps extends ComponentPropsWithoutRef<'span'> {
  value: number
  startValue?: number
  direction?: 'up' | 'down'
  delay?: number
  decimalPlaces?: number
  /** Suffix appended to the formatted number (e.g. "%", "k"). */
  suffix?: string
  /** Prefix prepended to the formatted number. */
  prefix?: string
}

/**
 * Spring-driven number counter. Triggers when scrolled into view.
 * Snaps to the final value under `prefers-reduced-motion`.
 */
export function NumberTicker({
  value,
  startValue = 0,
  direction = 'up',
  delay = 0,
  className,
  decimalPlaces = 0,
  suffix,
  prefix,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()
  const motionValue = useMotionValue(direction === 'down' ? value : startValue)
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 })
  const isInView = useInView(ref, { once: true, margin: '0px' })
  const [display, setDisplay] = useState<string>(() =>
    Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(direction === 'down' ? value : startValue)
  )

  useEffect(() => {
    if (!isInView) return
    if (reduced) {
      motionValue.jump(value)
      return
    }
    const timer = window.setTimeout(() => {
      motionValue.set(direction === 'down' ? startValue : value)
    }, delay * 1000)
    return () => window.clearTimeout(timer)
  }, [motionValue, isInView, delay, value, direction, startValue, reduced])

  useEffect(() => {
    const source = reduced ? motionValue : springValue
    const unsubscribe = source.on('change', (latest) => {
      setDisplay(
        Intl.NumberFormat('en-US', {
          minimumFractionDigits: decimalPlaces,
          maximumFractionDigits: decimalPlaces,
        }).format(Number(latest.toFixed(decimalPlaces)))
      )
    })
    return () => unsubscribe()
  }, [springValue, motionValue, decimalPlaces, reduced])

  return (
    <span ref={ref} className={cn('inline-block tabular-nums', className)} {...props}>
      {prefix}
      {display}
      {suffix}
    </span>
  )
}
