import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Card surface for the cinematic redesign. The default keeps the old flat look
 * (so existing call-sites are unchanged) but reads the elevated gradient token,
 * and new variants opt into hover-lift + accent glow without bespoke CSS.
 */
const cardVariants = cva(
  'relative rounded-2xl border text-[var(--text-primary)] transition-[border-color,box-shadow,transform] duration-300',
  {
    variants: {
      variant: {
        default: 'border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)]',
        elevated:
          'border-[var(--border-color)] [background:var(--elev-1)] shadow-[var(--shadow-md)]',
        interactive:
          'border-[var(--border-color)] [background:var(--elev-1)] shadow-[var(--shadow-md)] hover:-translate-y-[3px] hover:shadow-[var(--shadow-lg)] hover:border-[color-mix(in_srgb,var(--accent-primary)_45%,var(--border-hover))]',
        ai:
          'border-[color-mix(in_srgb,var(--accent-ai)_28%,var(--border-color))] [background:var(--elev-1)] shadow-[var(--shadow-md)] hover:-translate-y-[3px] hover:shadow-[var(--shadow-lg),var(--glow-ai)]',
        glass:
          'border-[var(--glass-border)] [background:var(--glass-bg)] shadow-[var(--shadow-md)] backdrop-blur-xl',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  )
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col gap-1.5 p-6', className)}
    {...props}
  />
))
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-h3 font-semibold tracking-tight', className)}
    {...props}
  />
))
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-small text-[var(--text-tertiary)]', className)}
    {...props}
  />
))
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
))
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center p-6 pt-0', className)}
    {...props}
  />
))
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants }
