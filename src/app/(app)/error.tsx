'use client'

import { useEffect } from 'react'
import { RefreshCw, Home } from 'lucide-react'
import Link from 'next/link'

import { EmptyState } from '@/components/EmptyState'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[app route error]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <EmptyState
        illustration="data-error"
        title="Something went wrong"
        description="This page hit an unexpected error. Your data is safe — try reloading, or head back to the Match Centre."
        action={
          <>
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-[var(--accent-on-primary)] transition-opacity hover:opacity-90"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)]"
            >
              <Home className="h-4 w-4" aria-hidden="true" />
              Today
            </Link>
          </>
        }
      />
    </div>
  )
}
