import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface TableSkeletonProps {
  rows?: number
  columns?: number
  className?: string
}

export function TableSkeleton({ rows = 8, columns = 5, className }: TableSkeletonProps) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-[var(--border-color)]', className)}>
      <div className="flex border-b border-[var(--border-color)] bg-[var(--muted-bg)] px-4 py-2.5">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="mr-3 h-3.5 w-16 last:mr-0" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex items-center border-b border-[var(--border-color)] px-4 py-3 last:border-0"
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn(
                'mr-3 h-4 last:mr-0',
                c === 0 ? 'w-6' : c === 1 ? 'w-36' : 'w-10'
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
