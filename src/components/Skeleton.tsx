'use client'

import type { CSSProperties, JSX } from 'react'

type SkeletonVariant = 'rect' | 'circle' | 'text'

interface SkeletonProps {
  /** Pass-through tailwind / class names appended to the skeleton element */
  className?: string
  /** Visual variant; default 'rect' */
  variant?: SkeletonVariant
  /** For variant='text', render N stacked lines */
  count?: number
  /** Explicit width override */
  width?: string | number
  /** Explicit height override */
  height?: string | number
}

function toDim(value: string | number | undefined): string | undefined {
  if (value == null) return undefined
  return typeof value === 'number' ? `${value}px` : value
}

/**
 * Skeleton is a small loading placeholder primitive with a shimmer animation.
 * Animation keyframes (`skeleton-shimmer`) live in globals.css.
 */
export function Skeleton({
  className = '',
  variant = 'rect',
  count = 1,
  width,
  height,
}: SkeletonProps) {
  const shapeClass =
    variant === 'circle'
      ? 'rounded-full aspect-square'
      : variant === 'text'
        ? 'rounded'
        : 'rounded-md'

  if (variant === 'text' && count > 1) {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        {Array.from({ length: count }).map((_, i) => {
          const isLast = i === count - 1
          const style: CSSProperties = {
            width: isLast ? '75%' : '100%',
            height: toDim(height) ?? '0.85em',
          }
          return (
            <span
              key={i}
              aria-hidden="true"
              className="skeleton-shimmer block rounded"
              style={style}
            />
          )
        })}
      </div>
    )
  }

  const style: CSSProperties = {
    width: toDim(width) ?? (variant === 'circle' ? '32px' : '100%'),
    height: toDim(height) ?? (variant === 'text' ? '0.85em' : variant === 'circle' ? undefined : '16px'),
  }

  return (
    <span
      aria-hidden="true"
      role="presentation"
      className={`skeleton-shimmer block ${shapeClass} ${className}`}
      style={style}
    />
  )
}

/* ----------------------- Opinionated wrappers ----------------------- */

/** Skeleton sized to mirror a typical MatchCard row in the matches list. */
export function MatchCardSkeleton(): JSX.Element {
  return (
    <div
      className="match-card"
      style={{ cursor: 'default' }}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex-1 flex items-center justify-end gap-2 pr-3 min-w-0">
        <Skeleton width="60%" height={14} />
        <Skeleton variant="circle" width={20} height={20} />
      </div>
      <div className="flex flex-col items-center min-w-[60px]">
        <Skeleton width={42} height={18} />
        <Skeleton width={28} height={10} className="mt-1" />
      </div>
      <div className="flex-1 flex items-center justify-start gap-2 pl-3 min-w-0">
        <Skeleton variant="circle" width={20} height={20} />
        <Skeleton width="60%" height={14} />
      </div>
    </div>
  )
}

/** Skeleton row for a standings table row. */
export function StandingsRowSkeleton(): JSX.Element {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 border-b"
      style={{ borderColor: 'var(--border-color)' }}
      aria-busy="true"
    >
      <Skeleton width={18} height={14} />
      <Skeleton variant="circle" width={22} height={22} />
      <Skeleton className="flex-1" height={14} />
      <Skeleton width={28} height={12} />
      <Skeleton width={28} height={12} />
      <Skeleton width={36} height={14} />
    </div>
  )
}

/** Skeleton sized for a news/article card. */
export function NewsCardSkeleton(): JSX.Element {
  return (
    <div
      className="fm-card p-3 flex gap-3"
      aria-busy="true"
    >
      <Skeleton width={88} height={64} className="flex-shrink-0" />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <Skeleton variant="text" count={2} height={14} />
        <div className="flex items-center gap-2 mt-1">
          <Skeleton width={50} height={10} />
          <Skeleton width={70} height={10} />
        </div>
      </div>
    </div>
  )
}

export default Skeleton
