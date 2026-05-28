'use client'

import Link from 'next/link'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AuthModal } from '@/components/AuthModal'
import { GenderToggle } from '@/components/GenderToggle'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAuth } from '@/contexts/AuthContext'
import { useCommandPalette } from '@/store/commandPaletteStore'

/**
 * Glass topbar that sits above the main content column. Renders the brand
 * mark on mobile (sidebar is hidden there), a global search trigger that
 * opens the Cmd+K palette, the gender + theme toggles, and the auth
 * button / user menu. Stays sticky on scroll.
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
        className="sticky top-0 z-30 flex h-[var(--shell-topbar-h)] items-center gap-3 border-b border-[var(--nav-border)] bg-[var(--nav-bg)] px-4 backdrop-blur-xl md:px-6"
        role="banner"
      >
        {/* Brand mark — only visible on mobile (sidebar is hidden there) */}
        <Link
          href="/"
          aria-label="Pitchwise home"
          className="md:hidden flex items-center gap-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-mark.svg" alt="" width={28} height={28} className="h-7 w-7" />
          <span className="text-sm font-bold text-[var(--text-primary)]">Pitchwise</span>
        </Link>

        {/* Global search trigger -> opens command palette */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="group relative ml-auto md:ml-0 flex h-9 min-w-[160px] max-w-[420px] flex-1 items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]/70 px-3 text-left text-sm text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)] focus-visible:border-[var(--accent-primary)]/50"
          aria-label="Open command palette"
        >
          <Search className="h-4 w-4 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
          <span className="hidden flex-1 truncate sm:inline">Search leagues, teams, matches…</span>
          <span className="ml-auto hidden items-center gap-1 sm:inline-flex">
            <span className="kbd">{shortcut}</span>
          </span>
        </button>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-2 md:ml-3">
          <GenderToggle size="default" className="hidden sm:inline-flex" />
          <ThemeToggle />
          {isAuthenticated && user ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent-secondary)] to-[var(--accent-primary)] text-sm font-bold text-[var(--accent-on-primary)] shadow-lg shadow-emerald-500/20"
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
              className="rounded-lg bg-gradient-to-br from-[var(--accent-secondary)] to-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-on-primary)] shadow-lg shadow-emerald-500/20"
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
