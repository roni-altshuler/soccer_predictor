'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  Brain,
  Calculator,
  Gauge,
  History,
  Info,
  Medal,
  Newspaper,
  Sparkles,
  TrendingUp,
  Trophy,
} from 'lucide-react'

import { BorderBeam } from '@/components/magicui/border-beam'
import { AnimatedGradientText } from '@/components/magicui/animated-gradient-text'
import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: typeof Activity
  /** Optional accent override — 'ai' uses cyan instead of green */
  accent?: 'ai'
}

const NAV: NavItem[] = [
  { href: '/', label: 'Match Centre', icon: Activity },
  { href: '/matches', label: 'Leagues', icon: Trophy },
  { href: '/tournaments', label: 'Tournaments', icon: Medal },
  { href: '/ai', label: 'AI Dashboard', icon: Sparkles, accent: 'ai' },
  { href: '/predict', label: 'AI Predict', icon: Brain, accent: 'ai' },
  { href: '/accuracy', label: 'Accuracy', icon: TrendingUp },
  { href: '/history', label: 'History', icon: History },
  { href: '/simulator', label: 'Simulator', icon: Calculator },
  { href: '/news', label: 'News', icon: Newspaper },
]

const SECONDARY: NavItem[] = [
  { href: '/diagnostics', label: 'Diagnostics', icon: Gauge },
  { href: '/about', label: 'About', icon: Info },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

/**
 * Desktop sidebar — fixed icon rail (68px) that expands to 232px on hover/focus.
 * The expanded panel is positioned over the main content (does not push layout),
 * so cursor movements never cause reflow. Hidden on mobile (bottom nav takes over).
 */
export function SidebarNav() {
  const pathname = usePathname()

  return (
    <aside
      aria-label="Primary"
      className={cn(
        'hidden md:flex group/shell fixed inset-y-0 left-0 z-40',
        'w-[68px] hover:w-[232px] focus-within:w-[232px]',
        'transition-[width] duration-200 ease-out',
        'border-r border-[var(--nav-border)] bg-[var(--nav-bg)] backdrop-blur-xl',
        'flex-col py-3'
      )}
    >
      {/* Brand mark with traced border-beam */}
      <Link
        href="/"
        aria-label="FotPredict AI home"
        className="relative mx-auto flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[var(--accent-ai)]/14 to-[var(--accent-primary)]/14 ring-1 ring-[var(--border-color)] transition-transform hover:scale-105"
      >
        <img src="/brand/logo-mark.svg" alt="" width={28} height={28} className="relative z-10 h-7 w-7" />
        <BorderBeam size={1} duration={8} borderRadius={12} colorFrom="var(--accent-ai)" colorTo="var(--accent-primary)" />
      </Link>

      {/* Wordmark — only visible when expanded */}
      <div className="mt-3 px-3 opacity-0 group-hover/shell:opacity-100 group-focus-within/shell:opacity-100 transition-opacity duration-150 overflow-hidden whitespace-nowrap">
        <div className="flex items-baseline gap-1.5">
          <AnimatedGradientText
            speed={10}
            colorFrom="var(--accent-primary)"
            colorTo="var(--accent-ai)"
            className="text-sm font-bold tracking-tight"
          >
            FotPredict
          </AnimatedGradientText>
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--accent-ai)]/18 text-[var(--accent-ai)] border border-[var(--accent-ai)]/30">
            AI
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">Match Centre · Predictions</p>
      </div>

      {/* Primary nav */}
      <nav className="mt-4 flex-1 overflow-y-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className="flex flex-col gap-1">
          {NAV.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              active={isActive(pathname || '/', item.href)}
            />
          ))}
        </ul>

        <div className="my-3 mx-3 h-px bg-[var(--border-color)] opacity-60" />

        <ul className="flex flex-col gap-1">
          {SECONDARY.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              active={isActive(pathname || '/', item.href)}
            />
          ))}
        </ul>
      </nav>

      {/* Footer area — version/build chip */}
      <div className="px-2 pt-2">
        <div className="shell-nav-item pointer-events-none opacity-70">
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"
            aria-hidden="true"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)] animate-pulse" />
          </span>
          <span className="opacity-0 group-hover/shell:opacity-100 group-focus-within/shell:opacity-100 transition-opacity whitespace-nowrap text-[11px] font-medium text-[var(--text-tertiary)]">
            Models live · v2.3
          </span>
        </div>
      </div>
    </aside>
  )
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <li>
      <Link
        href={item.href}
        data-active={active ? 'true' : 'false'}
        data-accent={item.accent ?? undefined}
        className="shell-nav-item"
        title={item.label}
      >
        <Icon
          className={cn(
            'h-[18px] w-[18px] shrink-0 transition-colors',
            active
              ? item.accent === 'ai'
                ? 'text-[var(--accent-ai)]'
                : 'text-[var(--accent-primary)]'
              : 'text-[var(--text-secondary)] group-hover/shell:text-[var(--text-primary)]'
          )}
          strokeWidth={2.1}
          aria-hidden="true"
        />
        <span className="opacity-0 group-hover/shell:opacity-100 group-focus-within/shell:opacity-100 transition-opacity duration-150 whitespace-nowrap">
          {item.label}
        </span>
      </Link>
    </li>
  )
}
