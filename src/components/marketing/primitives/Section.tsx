import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Consistent marketing section wrapper. Provides the shared vertical rhythm
 * (`--mkt-section-y`), the max content width (reuses `--shell-content-max`),
 * horizontal gutters, and `scroll-margin-top` so in-page anchor jumps clear
 * the sticky marketing nav.
 *
 * Server Component — purely structural. Wrap interactive children in <Reveal>.
 */
export function Section({
  children,
  id,
  className,
  innerClassName,
  labelledBy,
  bleed = false,
}: {
  children: ReactNode
  id?: string
  className?: string
  innerClassName?: string
  /** id of the heading that labels this section (a11y). */
  labelledBy?: string
  /** When true, removes the max-width container so children span full bleed. */
  bleed?: boolean
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        'relative scroll-mt-24',
        'py-[var(--mkt-section-y)]',
        className,
      )}
    >
      <div
        className={cn(
          !bleed && 'mx-auto w-full max-w-[var(--shell-content-max)] px-5 sm:px-8',
          innerClassName,
        )}
      >
        {children}
      </div>
    </section>
  )
}

/**
 * Standard section header: eyebrow kicker + title + optional lede.
 * Centered by default; pass `align="left"` for left-aligned headers.
 *
 * Anatomy (kicker → title → description) mirrors the product-wide
 * `@/components/primitives` SectionHeader; the landing keeps display-scale
 * titles (gradient spans, clamp sizing) that the shared string-only title
 * can't host, but the kicker uses the identical treatment so both read as
 * one system.
 */
export function SectionHeader({
  eyebrow,
  title,
  titleId,
  lede,
  align = 'center',
  className,
}: {
  eyebrow?: string
  title: ReactNode
  titleId?: string
  lede?: ReactNode
  align?: 'center' | 'left'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      {eyebrow ? (
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          {eyebrow}
        </span>
      ) : null}
      <h2
        id={titleId}
        className={cn(
          'font-display font-extrabold tracking-tight text-[var(--text-primary)]',
          'text-[clamp(1.75rem,4vw,2.75rem)] leading-[1.05]',
          align === 'center' && 'max-w-3xl',
        )}
      >
        {title}
      </h2>
      {lede ? (
        <p
          className={cn(
            'text-balance text-[var(--text-secondary)]',
            'text-base leading-relaxed md:text-lg',
            align === 'center' ? 'max-w-2xl' : 'max-w-2xl',
          )}
        >
          {lede}
        </p>
      ) : null}
    </div>
  )
}
