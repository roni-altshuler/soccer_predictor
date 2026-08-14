'use client'

import Link from 'next/link'
import { useState } from 'react'

import { AuthModal } from '@/components/AuthModal'
import { useAuth } from '@/contexts/AuthContext'

/**
 * The topbar: brand mark on mobile, and the account control.
 *
 * The global search field is gone, and with it the command palette it opened
 * and the Cmd/Ctrl+K shortcut that was advertised on it. It searched leagues,
 * teams and matches — three things the app has one tap to each of anyway — and
 * a keyboard shortcut printed in a chip is a promise that the product is
 * bigger than it is. A directory of nine leagues and fourteen competitions
 * does not need a search index over it.
 */
export function TopBar() {
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { user, isAuthenticated, logout } = useAuth()

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

        {/* Right cluster */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
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
