'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  BarChart3,
  CalendarRange,
  Info,
  Swords,
  TrendingUp,
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

// Two questions and the receipts.
//
// WATCH is where you follow football as it happens: what is on right now.
// FORECAST is the two shapes a season comes in
// — a league is a table, a tournament is a bracket — and each is its own
// destination rather than a tab inside a generic "model" bucket. EVIDENCE is
// how right it has been.
//
// The old nav split the same competition across four entries: `/leagues` was
// labelled "Standings", `/season` was "The Season Ahead", `/simulator` was
// "Title & Relegation" and `/tournaments` sat under "Model". A reader who
// wanted the Premier League had to know which of those held the part they
// were after. One competition is now one destination.
//
// `/standings` was one of those four and is gone for the same reason. A table
// is not a destination — it belongs to the competition it ranks, so it is on
// the league page and under the tournament's bracket. Keeping it separate
// meant a reader looking at the Champions League had to leave, pick the
// Champions League a second time, and come back.
const GROUPS: NavGroup[] = [
  {
    title: 'Watch',
    items: [{ href: '/', label: 'Today', icon: Activity }],
  },
  {
    title: 'Forecast',
    items: [
      { href: '/leagues', label: 'Leagues', icon: CalendarRange },
      { href: '/tournaments', label: 'Tournaments', icon: Swords },
    ],
  },
  {
    title: 'Evidence',
    items: [
      { href: '/evaluation', label: 'Evaluation', icon: BarChart3 },
      { href: '/accuracy', label: 'Accuracy', icon: TrendingUp },
      { href: '/about', label: 'How it works', icon: Info },
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
