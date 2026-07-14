import { Skeleton } from '@/components/ui/skeleton'

/**
 * Match-detail page skeleton mirroring the real layout: full-width scoreboard
 * hero (league line, crests + score), the sticky tab row, then a single
 * column of stacked cards.
 */
export function MatchDetailSkeleton() {
  return (
    <div>
      {/* Scoreboard hero */}
      <div className="border-b border-[var(--border-color)] bg-[var(--card-bg)]">
        <div className="mx-auto w-full max-w-5xl px-4 pb-6 pt-4 md:px-8">
          <Skeleton className="mb-4 h-4 w-28" />
          <div className="mb-4 flex justify-center">
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="flex items-center justify-end gap-3">
              <Skeleton className="hidden h-5 w-28 sm:block" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
            <div className="flex flex-col items-center gap-2 px-2">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="flex items-center justify-start gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="hidden h-5 w-28 sm:block" />
            </div>
          </div>
          <div className="mt-4 flex justify-center">
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
      </div>

      {/* Tab row */}
      <div className="border-b border-[var(--border-color)]">
        <div className="mx-auto flex w-full max-w-4xl gap-2 overflow-hidden px-4 py-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20 shrink-0 rounded-md" />
          ))}
        </div>
      </div>

      {/* Stacked cards */}
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </div>
  )
}
