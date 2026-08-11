'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  BookOpen,
  Brain,
  Calculator,
  CalendarDays,
  Database,
  Globe,
  History,
  Info,
  Medal,
  Newspaper,
  Radio,
  TrendingUp,
  Trophy,
  Users,
  Swords,
} from 'lucide-react'

import { cn } from '@/lib/utils'

type NavItem = {
  href: string
  label: string
  icon: typeof Activity
  /** Optional accent override — 'ai' uses cyan instead of green */
  accent?: 'ai'
}

type NavGroup = {
  title: string
  items: NavItem[]
}

// Four things now, not three (PIVOT_2026-08 §2 + the tournament layer added
// 2026-08-11): what's on, what the model says about a season, what it says
// about a bracket, and how right it has been.
const GROUPS: NavGroup[] = [
  {
    title: 'Matches',
    items: [
      { href: '/', label: 'Today', icon: Activity },
      { href: '/upcoming', label: 'Fixtures', icon: CalendarDays },
      { href: '/leagues', label: 'Standings', icon: Trophy },
    ],
  },
  {
    title: 'Model',
    items: [
      { href: '/predict', label: 'Predict', icon: Brain, accent: 'ai' },
      { href: '/simulator', label: 'Title & Relegation', icon: Calculator },
      { href: '/tournaments', label: 'Tournaments', icon: Swords },
    ],
  },
  {
    title: 'Evidence',
    items: [
      { href: '/accuracy', label: 'Accuracy', icon: TrendingUp },
      { href: '/about', label: 'About', icon: Info },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

/**
 * Desktop sidebar — fixed 220px column with always-visible labels, grouped
 * FotMob/ESPN style. Flat surface, hairline right edge; the active item gets
 * a soft accent wash. No hover-expansion, no animated chrome.
 */
export function SidebarNav() {
  const pathname = usePathname() || '/'

  return (
    <aside
      aria-label="Primary"
      className="hidden md:flex fixed inset-y-0 left-0 z-40 w-[var(--shell-sidebar-w)] flex-col border-r border-[var(--nav-border)] bg-[var(--card-bg)]"
    >
      {/* Brand */}
      <Link
        href="/"
        aria-label="Pitchverse home"
        className="flex h-[var(--shell-topbar-h)] shrink-0 items-center gap-2.5 border-b border-[var(--nav-border)] px-4"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-mark.svg" alt="" width={24} height={24} className="h-6 w-6" />
        <span className="text-[15px] font-bold tracking-tight text-[var(--text-primary)]">
          Pitchverse
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {GROUPS.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              {group.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  const accentColor = item.accent === 'ai' ? 'var(--accent-ai)' : 'var(--accent-primary)'
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-h-[38px] items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium transition-colors',
          active
            ? 'text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]'
        )}
        style={
          active
            ? { background: `color-mix(in srgb, ${accentColor} 12%, transparent)` }
            : undefined
        }
      >
        <Icon
          className="h-[18px] w-[18px] shrink-0"
          style={active ? { color: accentColor } : undefined}
          strokeWidth={2.1}
          aria-hidden="true"
        />
        {item.label}
      </Link>
    </li>
  )
}
