import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface MatchCardSkeletonProps {
  count?: number
  className?: string
}

export function MatchCardSkeleton({ count = 4, className }: MatchCardSkeletonProps) {
  return (
    <div className={cn('flex flex-col divide-y divide-[var(--border-color)]', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-10 w-12 rounded-md" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="ml-auto h-3.5 w-8" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="ml-auto h-3.5 w-8" />
            </div>
          </div>
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      ))}
    </div>
  )
}
