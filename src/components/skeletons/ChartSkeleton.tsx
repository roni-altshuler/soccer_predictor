import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface ChartSkeletonProps {
  className?: string
  height?: string
  withLegend?: boolean
}

export function ChartSkeleton({ className, height = 'h-64', withLegend = true }: ChartSkeletonProps) {
  return (
    <div
      className={cn(
        'space-y-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4',
        className
      )}
    >
      <div className={cn('relative overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--muted-bg)_40%,transparent)]', height)}>
        <Skeleton className="absolute inset-0 opacity-60" />
        <div className="absolute inset-x-0 top-1/4 h-px bg-[var(--border-color)] opacity-60" />
        <div className="absolute inset-x-0 top-2/4 h-px bg-[var(--border-color)] opacity-60" />
        <div className="absolute inset-x-0 top-3/4 h-px bg-[var(--border-color)] opacity-60" />
      </div>
      {withLegend ? (
        <div className="flex items-center gap-3 pt-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-20" />
        </div>
      ) : null}
    </div>
  )
}
