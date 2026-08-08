'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Activity,
  Brain,
  Search,
  TrendingUp,
  Trophy,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { springSnappy } from '@/lib/motion'
import { useCommandPalette } from '@/store/commandPaletteStore'

type Item = {
  href?: string
  label: string
  icon: typeof Activity
  accent?: 'ai'
  action?: 'palette'
}

const ITEMS: Item[] = [
  { href: '/', label: 'Today', icon: Activity },
  { href: '/leagues', label: 'Standings', icon: Trophy },
  { action: 'palette', label: 'Search', icon: Search },
  { href: '/predict', label: 'Predict', icon: Brain, accent: 'ai' },
  { href: '/accuracy', label: 'Accuracy', icon: TrendingUp },
]

function isActive(pathname: string, href?: string) {
  if (!href) return false
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export function MobileBottomNav() {
  const pathname = usePathname() || '/'
  const setPaletteOpen = useCommandPalette((s) => s.setOpen)
  const reduceMotion = useReducedMotion()

  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 flex justify-around border-t border-[var(--nav-border)] bg-[var(--nav-bg)] backdrop-blur-md pt-1 pb-[calc(env(safe-area-inset-bottom,0px)+0.25rem)]"
    >
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon
        const accentColor = item.accent === 'ai' ? 'var(--accent-ai)' : 'var(--accent-primary)'
        const inner = (
          <span
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 px-2 py-1 min-w-[54px] min-h-[44px] transition-colors duration-200',
              active ? '' : 'text-[var(--text-tertiary)]'
            )}
            style={active ? { color: accentColor } : undefined}
          >
            {active && (
              // FotMob tab grammar: a small underline-style indicator at the
              // top edge. Slide between tabs unless reduced motion is set.
              <motion.span
                {...(reduceMotion
                  ? {}
                  : { layoutId: 'bottomnav-active', transition: springSnappy })}
                className="absolute -top-1 h-[3px] w-8 rounded-full"
                style={{ background: accentColor }}
              />
            )}
            <Icon className="relative h-[19px] w-[19px]" strokeWidth={2.1} aria-hidden="true" />
            <span className="relative text-[10px] font-semibold">{item.label}</span>
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
