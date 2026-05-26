import { Skeleton } from '@/components/ui/skeleton'

/**
 * Full match-detail page skeleton — hero (badges + score), tab strip,
 * and a two-column grid of body panels.
 */
export function MatchDetailSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <div className="mt-6 grid grid-cols-3 items-center gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="flex items-center justify-end gap-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-12 w-12 rounded-full" />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-md" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
