import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface BentoSkeletonProps {
  className?: string
  count?: number
}

export function BentoSkeleton({ className, count = 4 }: BentoSkeletonProps) {
  return (
    <div className={cn('grid w-full auto-rows-[14rem] grid-cols-3 gap-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'col-span-3 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-5',
            i % 4 === 0 && 'lg:col-span-2',
            i % 4 === 1 && 'lg:col-span-1',
            i % 4 === 2 && 'lg:col-span-1',
            i % 4 === 3 && 'lg:col-span-2'
          )}
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-10 w-32" />
          <Skeleton className="mt-3 h-3 w-full max-w-[18rem]" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}
