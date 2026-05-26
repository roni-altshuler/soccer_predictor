'use client'

import Link from 'next/link'
import { Fragment } from 'react'

export interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
  className?: string
}

function Separator() {
  return (
    <span
      aria-hidden="true"
      className="select-none text-[var(--text-tertiary)] text-[13px] leading-none px-1.5"
    >
      ›
    </span>
  )
}

function Crumb({ item, isLast }: { item: BreadcrumbItem; isLast: boolean }) {
  const baseClass =
    'truncate max-w-[140px] sm:max-w-[200px] md:max-w-none text-[13px] leading-tight'

  if (isLast || !item.href) {
    return (
      <span
        className={`${baseClass} ${
          isLast
            ? 'text-[var(--text-primary)] font-semibold'
            : 'text-[var(--text-secondary)]'
        }`}
        aria-current={isLast ? 'page' : undefined}
      >
        {item.label}
      </span>
    )
  }

  return (
    <Link
      href={item.href}
      className={`${baseClass} text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors`}
    >
      {item.label}
    </Link>
  )
}

/**
 * Breadcrumbs renders a small horizontal trail of links to parent pages.
 * - Last item has no href (current page).
 * - On mobile, when items.length > 3, middle items collapse to an ellipsis: Home / ... / Current.
 * - Renders nothing if items.length <= 1 (no point in a single-item trail).
 */
export function Breadcrumbs({ items, className = '' }: BreadcrumbsProps) {
  if (!items || items.length <= 1) return null

  const last = items.length - 1
  const showMobileCollapse = items.length > 3

  // Mobile collapsed: first + ellipsis + last
  const mobileItems: Array<BreadcrumbItem | { ellipsis: true }> = showMobileCollapse
    ? [items[0], { ellipsis: true }, items[last]]
    : items

  return (
    <nav
      aria-label="Breadcrumb"
      className={`w-full text-[13px] text-[var(--text-secondary)] ${className}`}
    >
      {/* Mobile (collapsed) */}
      <ol className="flex md:hidden items-center min-w-0 gap-0.5">
        {mobileItems.map((item, idx) => {
          const isLastMobile = idx === mobileItems.length - 1
          if ('ellipsis' in item) {
            return (
              <Fragment key={`ellipsis-${idx}`}>
                <Separator />
                <span
                  aria-hidden="true"
                  className="select-none text-[var(--text-tertiary)] text-[13px] leading-none"
                >
                  …
                </span>
              </Fragment>
            )
          }
          return (
            <Fragment key={`m-${idx}-${item.label}`}>
              {idx > 0 && <Separator />}
              <Crumb item={item} isLast={isLastMobile} />
            </Fragment>
          )
        })}
      </ol>

      {/* Desktop (full) */}
      <ol className="hidden md:flex items-center min-w-0 gap-0.5">
        {items.map((item, idx) => (
          <Fragment key={`d-${idx}-${item.label}`}>
            {idx > 0 && <Separator />}
            <Crumb item={item} isLast={idx === last} />
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}

export default Breadcrumbs
