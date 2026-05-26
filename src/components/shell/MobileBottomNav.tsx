'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  Brain,
  Newspaper,
  Search,
  TrendingUp,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useCommandPalette } from '@/store/commandPaletteStore'

type Item = {
  href?: string
  label: string
  icon: typeof Activity
  accent?: 'ai'
  action?: 'palette'
}

const ITEMS: Item[] = [
  { href: '/', label: 'Matches', icon: Activity },
  { href: '/predict', label: 'Predict', icon: Brain, accent: 'ai' },
  { action: 'palette', label: 'Search', icon: Search },
  { href: '/accuracy', label: 'Accuracy', icon: TrendingUp },
  { href: '/news', label: 'News', icon: Newspaper },
]

function isActive(pathname: string, href?: string) {
  if (!href) return false
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export function MobileBottomNav() {
  const pathname = usePathname() || '/'
  const setPaletteOpen = useCommandPalette((s) => s.setOpen)

  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-2 left-2.5 right-2.5 z-40 glass rounded-2xl shadow-[var(--shadow-lg)] flex justify-around py-1.5 pb-[calc(env(safe-area-inset-bottom,0.5rem)+0.4rem)]"
    >
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon
        const inner = (
          <span
            className={cn(
              'relative flex flex-col items-center gap-0.5 px-2 py-1 min-w-[54px] rounded-xl transition-colors',
              active
                ? item.accent === 'ai'
                  ? 'text-[var(--accent-ai)] bg-[var(--accent-ai)]/10'
                  : 'text-[var(--accent-primary)] bg-[var(--tab-active-bg)]'
                : 'text-[var(--text-tertiary)]'
            )}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden="true" />
            <span className="text-[10px] font-semibold">{item.label}</span>
            {active && (
              <span className="absolute -bottom-0.5 h-[2px] w-5 rounded-full bg-current" />
            )}
          </span>
        )

        if (item.action === 'palette') {
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open search"
            >
              {inner}
            </button>
          )
        }

        return (
          <Link key={item.label} href={item.href!} aria-current={active ? 'page' : undefined}>
            {inner}
          </Link>
        )
      })}
    </nav>
  )
}
