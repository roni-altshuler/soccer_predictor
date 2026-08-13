'use client'

import Link from 'next/link'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AuthModal } from '@/components/AuthModal'
import { useAuth } from '@/contexts/AuthContext'
import { useCommandPalette } from '@/store/commandPaletteStore'

/**
 * Glass topbar that sits above the main content column. Renders the brand
 * mark on mobile (sidebar is hidden there), a global search trigger that
 * opens the Cmd+K palette, the gender toggle, and the auth button / user
 * menu. Stays sticky on scroll.
 */
export function TopBar() {
  const setPaletteOpen = useCommandPalette((s) => s.setOpen)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { user, isAuthenticated, logout } = useAuth()
  const [shortcut, setShortcut] = useState<'⌘K' | 'Ctrl K'>('⌘K')

  useEffect(() => {
    if (typeof navigator !== 'undefined' && !/Mac|iPhone|iPad/.test(navigator.platform)) {
      setShortcut('Ctrl K')
    }
  }, [])

  return (
    <>
      <header
        className="sticky top-0 z-30 flex h-[var(--shell-topbar-h)] items-center gap-3 border-b border-[var(--nav-border)] bg-[var(--nav-bg)] px-4 backdrop-blur-md md:px-6"
        role="banner"
      >
        {/* Brand mark — only visible on mobile (sidebar is hidden there) */}
        <Link
          href="/"
          aria-label="Pitchverse home"
          className="md:hidden flex shrink-0 items-center gap-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-mark.svg" alt="" width={28} height={28} className="h-7 w-7" />
          <span className="text-sm font-bold text-[var(--text-primary)]">Pitchverse</span>
        </Link>

        {/* Global search trigger -> opens command palette. min-w-0 below sm so
            the bar can never exceed the viewport: the search field absorbs the
            squeeze instead of pushing the right cluster off-screen (its
            placeholder text is hidden at that width anyway). */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="group relative ml-auto md:ml-0 flex h-9 min-w-0 max-w-[380px] flex-1 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] px-3 text-left text-sm text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-hover)] focus-visible:border-[color-mix(in_srgb,var(--accent-primary)_50%,transparent)] sm:min-w-[160px]"
          aria-label="Open command palette"
        >
          <Search className="h-4 w-4 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
          <span className="hidden flex-1 truncate sm:inline">Search leagues, teams, matches…</span>
          <span className="ml-auto hidden items-center gap-1 sm:inline-flex">
            <span className="kbd">{shortcut}</span>
          </span>
        </button>

        {/* Right cluster */}
        <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-3">
          {/* The men's/women's switch is not rendered while women's
              competitions sit outside the coverage waves (docs/PIVOT_2026-08.md
              §5). The preference plumbing stays — every fetch still threads
              `gender`, defaulting to 'men' — so restoring the control is a
              one-line change when the evidence gate opens. Offering the switch
              today would advertise five competitions the model has never been
              scored on. */}
          {isAuthenticated && user ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-primary)] text-sm font-bold text-[var(--accent-on-primary)]"
                aria-label="Account menu"
              >
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full" />
                ) : (
                  (user.display_name || user.email)[0].toUpperCase()
                )}
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] py-1 shadow-xl">
                  <div className="border-b border-[var(--border-color)] px-4 py-2">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {user.display_name || 'User'}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">{user.email}</p>
                  </div>
                  <button
                    onClick={async () => {
                      await logout()
                      setUserMenuOpen(false)
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-[var(--accent-loss)] hover:bg-[var(--card-hover)]"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setAuthModalOpen(true)}
              className="rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-on-primary)] transition-opacity hover:opacity-90"
            >
              Sign In
            </button>
          )}
        </div>
      </header>
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </>
  )
}
