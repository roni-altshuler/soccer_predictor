'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { ThemeToggle } from './ThemeToggle'
import { AuthModal } from './AuthModal'
import { GenderToggle } from './GenderToggle'
import { useAuth } from '@/contexts/AuthContext'

const navLinks = [
  { href: '/', label: 'Matches', mobileLabel: 'Matches', icon: MatchesIcon },
  { href: '/matches', label: 'Leagues', mobileLabel: 'Leagues', icon: LeaguesIcon },
  { href: '/predict', label: 'AI Predict', mobileLabel: 'Predict', icon: PredictIcon },
  { href: '/tracking', label: 'Accuracy', mobileLabel: 'Accuracy', icon: AccuracyIcon },
  { href: '/news', label: 'News', mobileLabel: 'News', icon: NewsIcon },
]

function MatchesIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  )
}

function LeaguesIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}

function PredictIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent-ai)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4" /><path d="m15.5 7.5 2.8-2.8" /><path d="M20 12h-4" />
      <path d="m15.5 16.5 2.8 2.8" /><path d="M12 18v4" /><path d="m4.2 19.8 2.8-2.8" />
      <path d="M4 12h4" /><path d="m4.2 4.2 2.8 2.8" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  )
}

function AccuracyIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
    </svg>
  )
}

function NewsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent-primary)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8" /><path d="M15 18h-5" /><rect width="8" height="5" x="10" y="6" rx="1" />
    </svg>
  )
}

export const Navbar = () => {
  const pathname = usePathname()
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { user, isAuthenticated, logout } = useAuth()

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/'
    return pathname.startsWith(path)
  }

  return (
    <>
      {/* Desktop Top Nav */}
      <nav className="sticky top-0 z-50 bg-[var(--nav-bg)] border-b border-[var(--nav-border)] backdrop-blur-md hidden md:block" role="navigation">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between h-[62px]">
            <Link href="/" className="flex items-center gap-2.5 group" aria-label="FotPredict AI home">
              <img
                src="/brand/logo-mark.svg"
                alt=""
                width={36}
                height={36}
                className="w-9 h-9 group-hover:scale-[1.04] transition-transform"
              />
              <div className="flex items-baseline gap-1.5">
                <span className="text-base font-bold text-[var(--text-primary)] tracking-tight">FotPredict</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[var(--accent-ai)]/18 text-[var(--accent-ai)] border border-[var(--accent-ai)]/30">AI</span>
              </div>
            </Link>

            <div className="flex items-center gap-1 rounded-xl border border-[var(--border-color)]/70 bg-[var(--card-bg)]/65 p-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    isActive(link.href)
                      ? link.href === '/predict'
                        ? 'bg-[var(--accent-ai)]/14 text-[var(--accent-ai)] border border-[var(--accent-ai)]/30'
                        : 'bg-[var(--tab-active-bg)] text-[var(--accent-primary)] border border-[var(--accent-primary)]/30'
                      : 'text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--card-hover)]/85'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <GenderToggle className="hidden lg:inline-flex" size="default" />
              <ThemeToggle />
              {isAuthenticated && user ? (
                <div className="relative">
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--accent-secondary)] to-[var(--accent-primary)] flex items-center justify-center text-[#04120a] font-bold text-sm shadow-lg shadow-emerald-500/20"
                  >
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                    ) : (
                      (user.display_name || user.email)[0].toUpperCase()
                    )}
                  </button>
                  {userMenuOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl shadow-xl py-1 z-50">
                      <div className="px-4 py-2 border-b border-[var(--border-color)]">
                        <p className="text-sm font-medium text-[var(--text-primary)]">{user.display_name || 'User'}</p>
                        <p className="text-xs text-[var(--text-secondary)]">{user.email}</p>
                      </div>
                      <button onClick={async () => { await logout(); setUserMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-[var(--card-hover)]">
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button onClick={() => setAuthModalOpen(true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-br from-[var(--accent-secondary)] to-[var(--accent-primary)] text-[#04120a] shadow-lg shadow-emerald-500/20">
                  Sign In
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Top Bar (minimal) */}
      <div className="md:hidden sticky top-0 z-50 bg-[var(--nav-bg)] border-b border-[var(--nav-border)] backdrop-blur-md">
        <div className="flex items-center justify-between h-12 px-4">
          <Link href="/" className="flex items-center gap-2" aria-label="FotPredict AI home">
            <img src="/brand/logo-mark.svg" alt="" width={28} height={28} className="w-7 h-7" />
            <span className="text-sm font-bold text-[var(--text-primary)]">FotPredict</span>
            <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-[var(--accent-ai)]/16 text-[var(--accent-ai)] border border-[var(--accent-ai)]/25">AI</span>
          </Link>
          <div className="flex items-center gap-2">
            <GenderToggle size="compact" />
            <ThemeToggle />
            {isAuthenticated && user ? (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[var(--accent-secondary)] to-[var(--accent-primary)] flex items-center justify-center text-[#04120a] font-bold text-xs shadow-md shadow-emerald-500/20">
                {(user.display_name || user.email)[0].toUpperCase()}
              </div>
            ) : (
              <button onClick={() => setAuthModalOpen(true)} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-gradient-to-br from-[var(--accent-secondary)] to-[var(--accent-primary)] text-[#04120a] shadow-md shadow-emerald-500/20">
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Bottom Tab Bar — FotMob style */}
      <div className="bottom-nav md:hidden">
        {navLinks.map((link) => {
          const active = isActive(link.href)
          const IconComponent = link.icon
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex flex-col items-center gap-0.5 py-1 px-2 min-w-[56px] rounded-xl transition-colors ${
                active
                  ? (link.href === '/predict' ? 'text-[var(--accent-ai)] bg-[var(--accent-ai)]/10' : 'text-[var(--accent-primary)] bg-[var(--tab-active-bg)]')
                  : 'text-[var(--text-tertiary)]'
              }`}
            >
              <IconComponent active={active} />
              <span className="text-[10px] font-semibold">{link.mobileLabel}</span>
              {active && <span className="absolute -bottom-1 w-6 h-[2px] rounded-full bg-current" />}
            </Link>
          )
        })}
      </div>

      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </>
  )
}
