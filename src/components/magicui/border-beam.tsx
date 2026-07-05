'use client'

import { motion, type MotionStyle, type Transition } from 'framer-motion'

import { cn } from '@/lib/utils'

interface BorderBeamProps {
  size?: number
  duration?: number
  delay?: number
  colorFrom?: string
  colorTo?: string
  className?: string
  reverse?: boolean
  initialOffset?: number
  borderRadius?: number
  transition?: Transition
}

/**
 * Animated conic-gradient beam that traces the border of its parent.
 * Parent must be `position: relative` and have a defined size.
 */
export function BorderBeam({
  className,
  size = 1,
  duration = 6,
  delay = 0,
  colorFrom = 'var(--accent-primary)',
  colorTo = 'var(--accent-ai)',
  transition,
  reverse = false,
  initialOffset = 0,
  borderRadius = 8,
}: BorderBeamProps) {
  return (
    <div
      className={cn('pointer-events-none absolute inset-0 [container-type:size]', className)}
      style={{ borderRadius }}
      aria-hidden
    >
      <div
        className="absolute inset-0 overflow-hidden"
        // Ring mask: content-box layer XOR full-box layer leaves only the
        // `size`px padding ring visible. Inline styles (not Tailwind
        // arbitrary properties) because property ordering broke the mask
        // in Chromium and the beam rendered as an unmasked gradient slab.
        style={{
          borderRadius,
          padding: `${size}px`,
          WebkitMask:
            'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          maskComposite: 'exclude',
        }}
      >
        <motion.div
          className="absolute aspect-square"
          style={
            {
              width: 'calc(100cqh * 5)',
              offsetPath: `rect(0 auto auto 0 round ${borderRadius}px)`,
              background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
            } as MotionStyle
          }
          initial={{ offsetDistance: `${initialOffset}%` }}
          animate={{
            offsetDistance: reverse
              ? [`${100 - initialOffset}%`, `${-initialOffset}%`]
              : [`${initialOffset}%`, `${100 + initialOffset}%`],
          }}
          transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay, ...transition }}
        />
      </div>
    </div>
  )
}
