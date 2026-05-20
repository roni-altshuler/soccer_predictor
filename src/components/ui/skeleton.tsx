import * as React from 'react'

import { cn } from '@/lib/utils'

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-[color-mix(in_srgb,var(--border-color)_60%,transparent)]',
        className
      )}
      aria-hidden="true"
      {...props}
    />
  )
}

export { Skeleton }
