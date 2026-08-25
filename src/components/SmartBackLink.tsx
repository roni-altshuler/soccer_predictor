'use client'

import { ArrowLeft } from 'lucide-react'

import { useSmartBack } from '@/lib/useSmartBack'
import { cn } from '@/lib/utils'

/**
 * The one back control detail pages use. Same grammar as the sibling
 * predictors (RaceIQ / Hardwood / Gridiron): a quiet `←` text affordance,
 * top-left, above the h1 — never a breadcrumb trail, never two competing
 * back controls on one page.
 *
 * It behaves like the browser's back when the reader navigated here inside
 * the app, and goes to `fallbackHref` (the contextual parent named by
 * `label`) on a deep link. See useSmartBack for why.
 */
export function SmartBackLink({
  fallbackHref,
  label,
  className,
}: {
  fallbackHref: string
  /** Contextual, not generic: "All leagues", "The bracket", "Today". */
  label: string
  className?: string
}) {
  const back = useSmartBack(fallbackHref)
  return (
    <button
      type="button"
      onClick={back}
      className={cn(
        '-ml-1 inline-flex min-h-[36px] items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-[0.12em]',
        'text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]',
        className,
      )}
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  )
}
