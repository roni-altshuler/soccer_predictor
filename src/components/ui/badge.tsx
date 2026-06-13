import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-caption font-semibold uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]',
        ai:
          'border-transparent bg-[var(--accent-ai)]/15 text-[var(--accent-ai)]',
        warn:
          'border-transparent bg-[var(--accent-warn)]/15 text-[var(--accent-warn)]',
        loss:
          'border-transparent bg-[var(--accent-loss)]/15 text-[var(--accent-loss)]',
        outline:
          'border-[var(--border-color)] text-[var(--text-secondary)] bg-transparent',
        live:
          'border-transparent bg-[var(--accent-loss)]/15 text-[var(--accent-loss)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
