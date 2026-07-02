'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Activity,
  Globe,
  Search,
  Sparkles,
  TrendingUp,
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
  { href: '/', label: 'Matches', icon: Activity },
  // Tournament-period slot — swap back to { href: '/matches', label:
  // 'Leagues', icon: Trophy } after the 2026 final on July 19.
  { href: '/world-cup', label: 'World Cup', icon: Globe },
  { action: 'palette', label: 'Search', icon: Search },
  { href: '/ai', label: 'AI', icon: Sparkles, accent: 'ai' },
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
      className="md:hidden fixed bottom-2 left-2.5 right-2.5 z-40 glass-strong rounded-2xl shadow-[var(--shadow-lg)] flex justify-around py-1.5 pb-[calc(env(safe-area-inset-bottom,0.5rem)+0.4rem)]"
    >
      {/* top hairline so the floating bar reads as a lit surface */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--hairline-bright)] to-transparent"
      />
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href)
        const Icon = item.icon
        const accentColor = item.accent === 'ai' ? 'var(--accent-ai)' : 'var(--accent-primary)'
        const inner = (
          <span
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 px-2 py-1 min-w-[54px] min-h-[44px] rounded-xl transition-colors duration-200',
              active ? '' : 'text-[var(--text-tertiary)]'
            )}
            style={active ? { color: accentColor } : undefined}
          >
            {active && (
              // Shared-layout slide is disabled under prefers-reduced-motion:
              // the highlight simply appears on the active tab instead of
              // animating between tabs.
              <motion.span
                {...(reduceMotion
                  ? {}
                  : { layoutId: 'bottomnav-active', transition: springSnappy })}
                className="absolute inset-0 rounded-xl"
                style={{
                  background: `color-mix(in srgb, ${accentColor} 14%, transparent)`,
                  boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentColor} 30%, transparent)`,
                }}
              />
            )}
            <Icon
              className={cn('relative h-[18px] w-[18px] transition-transform', active && '-translate-y-px')}
              strokeWidth={2.2}
              aria-hidden="true"
            />
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
