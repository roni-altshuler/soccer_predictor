'use client'

import { useEffect, useRef } from 'react'
import { animate, useInView, useMotionValue, useReducedMotion } from 'framer-motion'

import { EASE_OUT } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface AnimatedNumberProps {
  /** Target value to count up to. */
  value: number
  /** Animation length in seconds (default 1.1). */
  duration?: number
  /**
   * Fraction digits. Defaults to the target value's own precision
   * (integers snap to 0, "61.2" to 1, capped at 3).
   */
  decimals?: number
  prefix?: string
  suffix?: string
  /** Full custom formatter — overrides `decimals` (e.g. Intl grouping). */
  format?: (n: number) => string
  /** Only start counting once scrolled into view (default true). */
  whenInView?: boolean
  className?: string
}

/**
 * Count-up numeral driven by a framer-motion motion value.
 *
 * Soccer usage: headline stats — accuracy percentages, points totals, xG,
 * matches analysed — anywhere a big number should land with a count-up.
 * Starts when the element scrolls into view (once), writes frames straight to
 * `textContent` (no re-renders), and always renders in tabular numerals so
 * digits never jitter horizontally.
 *
 * Failsafes: under `prefers-reduced-motion` the final value renders
 * immediately with no animation; the server/no-JS markup also contains the
 * final formatted value, so headless renders and crawlers see real numbers,
 * never a zero.
 */
export function AnimatedNumber({
  value,
  duration = 1.1,
  decimals,
  prefix = '',
  suffix = '',
  format,
  whenInView = true,
  className,
}: AnimatedNumberProps) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLSpanElement | null>(null)
  const motionValue = useMotionValue(value)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })

  const resolvedDecimals =
    decimals ?? (Number.isInteger(value) ? 0 : Math.min(3, (`${value}`.split('.')[1] || '').length))
  const fmt = (n: number): string => {
    const safe = Number.isFinite(n) ? n : 0
    return `${prefix}${format ? format(safe) : safe.toFixed(resolvedDecimals)}${suffix}`
  }
  const fmtRef = useRef(fmt)
  fmtRef.current = fmt

  useEffect(() => {
    return motionValue.on('change', (latest) => {
      if (ref.current) ref.current.textContent = fmtRef.current(latest)
    })
  }, [motionValue])

  useEffect(() => {
    if (reduced) {
      motionValue.jump(value)
      if (ref.current) ref.current.textContent = fmtRef.current(value)
      return
    }
    if (whenInView && !inView) return
    motionValue.jump(0)
    const controls = animate(motionValue, value, { duration, ease: EASE_OUT })
    return () => controls.stop()
  }, [value, duration, reduced, inView, whenInView, motionValue])

  return (
    <span ref={ref} className={cn('font-numeric tabular-nums', className)}>
      {fmt(value)}
    </span>
  )
}

export default AnimatedNumber
