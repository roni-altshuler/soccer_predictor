import { type ComponentProps, type ReactNode } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'md' | 'lg'

const base =
  'group inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2'

const sizes: Record<Size, string> = {
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-6 py-3.5 text-[15px]',
}

const variants: Record<Variant, string> = {
  // Filled gradient CTA — the primary conversion action.
  primary: cn(
    'bg-gradient-to-br from-[var(--accent-ai)] to-[var(--accent-primary)] text-[var(--accent-on-primary)]',
    'shadow-lg shadow-[var(--accent-ai)]/20 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[var(--accent-ai)]/30',
  ),
  // Bordered card-surface CTA.
  secondary: cn(
    'border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)]',
    'hover:-translate-y-0.5 hover:border-[var(--accent-primary)]/50 hover:bg-[var(--card-hover)]',
  ),
  // Minimal text link with subtle hover surface.
  ghost: cn(
    'text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]',
  ),
}

/**
 * Accessible link-as-button used for every marketing CTA. Renders a real
 * <a> (via next/link for internal hrefs) so the conversion path is
 * crawlable, keyboard-focusable, and middle-click friendly — unlike a
 * <button onClick={router.push}> shortcut.
 */
export function CtaButton({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className,
  external = false,
  ...rest
}: {
  href: string
  children: ReactNode
  variant?: Variant
  size?: Size
  className?: string
  external?: boolean
} & Omit<ComponentProps<typeof Link>, 'href' | 'className'>) {
  const classes = cn(base, sizes[size], variants[variant], className)

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={classes}>
        {children}
      </a>
    )
  }

  return (
    <Link href={href} className={classes} {...rest}>
      {children}
    </Link>
  )
}
