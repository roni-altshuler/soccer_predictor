'use client'

import { type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { SectionErrorBoundary } from '@/components/primitives/SectionErrorBoundary'

export interface AsyncSectionProps {
  /** True while the data for this section is still loading. */
  loading: boolean
  /** Populated when the fetch failed — string message or Error. */
  error?: string | Error | null
  /** Refetch handler wired to both the inline error retry and the boundary reset. */
  onRetry?: () => void
  /** Custom loading placeholder. Falls back to a neutral pulse block. */
  skeleton?: ReactNode
  /** True when the fetch succeeded but returned nothing to show. */
  empty?: boolean
  /** What to render for the empty case (e.g. an <EmptyState />). */
  emptyState?: ReactNode
  /** Short label for what this section is, e.g. "news" — used in error copy. */
  section?: string
  children: ReactNode
}

function DefaultSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3"
        >
          <Skeleton className="h-14 w-20 flex-shrink-0 rounded" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Standardised async UI wrapper. Collapses the ubiquitous
 * `useState(loading/error/data)` + spinner boilerplate into one component
 * with token-styled loading, error (with a ≥44px retry target), empty, and
 * success states. The success branch is wrapped in a SectionErrorBoundary so
 * a render-time throw inside `children` degrades gracefully too.
 */
export function AsyncSection({
  loading,
  error,
  onRetry,
  skeleton,
  empty,
  emptyState,
  section,
  children,
}: AsyncSectionProps) {
  if (loading) {
    return <>{skeleton ?? <DefaultSkeleton />}</>
  }

  if (error) {
    const message = typeof error === 'string' ? error : error.message
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-6 py-8 text-center"
      >
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {section ? `Couldn’t load ${section}` : 'Something went wrong here'}
        </p>
        {message && (
          <p className="max-w-xs text-xs text-[var(--text-tertiary)]">{message}</p>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    )
  }

  if (empty) {
    return <>{emptyState ?? null}</>
  }

  return (
    <SectionErrorBoundary section={section} onRetry={onRetry}>
      {children}
    </SectionErrorBoundary>
  )
}

export default AsyncSection
