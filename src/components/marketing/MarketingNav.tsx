'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Menu, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { CtaButton } from './primitives/CtaButton'

const NAV_LINKS = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Live demo', href: '#prediction-demo' },
  { label: 'Accuracy', href: '#calibration' },
]

/**
 * Marketing top nav. Transparent over the hero, then glass-solid once the
 * user scrolls past the fold. Collapses to a sheet menu on mobile.
 */
export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
        scrolled
          ? 'glass-strong border-b border-[var(--glass-border)]'
          : 'border-b border-transparent',
      )}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-[var(--shell-content-max)] items-center justify-between gap-4 px-5 sm:px-8"
      >
        {/* Brand */}
        <Link
          href="/welcome"
          className="flex min-h-[44px] items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent-ai)] to-[var(--accent-primary)] text-[var(--accent-on-primary)] shadow-sm">
            <span className="text-sm font-black">P</span>
          </span>
          <span className="text-[15px] font-extrabold tracking-tight text-[var(--text-primary)]">
            Pitchwise
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden items-center gap-2 md:flex">
          <CtaButton href="/" variant="ghost" size="md">
            Open Match Centre
          </CtaButton>
          <CtaButton href="/predict" variant="primary" size="md">
            Run a prediction
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </CtaButton>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mkt-mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* Mobile sheet */}
      {open ? (
        <div
          id="mkt-mobile-menu"
          className="glass-strong border-t border-[var(--glass-border)] md:hidden"
        >
          <div className="mx-auto flex w-full max-w-[var(--shell-content-max)] flex-col gap-1 px-5 py-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center rounded-lg px-3 py-3 text-base font-medium text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <CtaButton href="/" variant="secondary" size="lg" onClick={() => setOpen(false)}>
                Open Match Centre
              </CtaButton>
              <CtaButton href="/predict" variant="primary" size="lg" onClick={() => setOpen(false)}>
                Run a prediction
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </CtaButton>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  )
}
