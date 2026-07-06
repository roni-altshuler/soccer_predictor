'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface ChartContainerProps {
  /** Fixed height in px — reserved up front so heavy charts never shift layout. */
  height?: number
  /** Defer mounting children until the container scrolls near the viewport. */
  lazy?: boolean
  /** Accessible description of the chart being loaded (used on the skeleton). */
  label?: string
  className?: string
  children: ReactNode
}

/**
 * Lazy-hydration wrapper for heavy chart surfaces (recharts / visx).
 *
 * Reserves a fixed-height box, shows a flat `animate-pulse` skeleton on the
 * card surface, and only mounts its children once an IntersectionObserver
 * reports the container near the viewport — then crossfades skeleton → chart.
 * Kills CLS on data-dense soccer pages (match detail, /accuracy, /predict).
 *
 * Environments without IntersectionObserver (legacy browsers, some headless
 * runners) hydrate on the next animation frame instead, so content is never
 * permanently hidden.
 *
 * Usage: wrap any below-the-fold `<ScorelineHeatmap />`, `<ProgressionChart />`
 * etc. with a height matching the chart's natural height.
 */
export function ChartContainer({
  height = 320,
  lazy = true,
  label = 'Loading chart',
  className,
  children,
}: ChartContainerProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [hydrated, setHydrated] = useState(!lazy)
  const [showSkeleton, setShowSkeleton] = useState(true)

  useEffect(() => {
    if (!lazy || hydrated) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      const id = window.requestAnimationFrame(() => setHydrated(true))
      return () => window.cancelAnimationFrame(id)
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setHydrated(true)
            io.disconnect()
            break
          }
        }
      },
      { rootMargin: '160px 0px 160px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [lazy, hydrated])

  useEffect(() => {
    if (!hydrated) return
    // Let the chart paint one frame, then fade the skeleton out.
    const t = window.setTimeout(() => setShowSkeleton(false), 220)
    return () => window.clearTimeout(t)
  }, [hydrated])

  return (
    <div ref={ref} className={cn('relative', className)} style={{ height }}>
      {showSkeleton && (
        <div
          role="status"
          aria-label={label}
          className={cn(
            'absolute inset-0 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] transition-opacity duration-300 motion-reduce:animate-none',
            hydrated ? 'opacity-0' : 'opacity-100',
          )}
        />
      )}
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-300',
          hydrated ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        {hydrated && children}
      </div>
    </div>
  )
}

export default ChartContainer
