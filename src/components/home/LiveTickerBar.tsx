'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

import { LeagueBadge } from '@/components/match/LeagueBadge'
import { cn } from '@/lib/utils'

/**
 * Horizontal-scroll live-matches strip rendered above the home match
 * list when there's at least one live game. Mirrors FotMob's "live
 * now" ribbon — each tile is ~220px wide and shows home/away + score
 * + pulsing minute. Clicking a tile routes to the match detail page.
 */

export interface LiveTickerMatch {
  id?: string
  home_team: string
  away_team: string
  home_score?: number | null
  away_score?: number | null
  minute?: number | string | null
  league?: string
  leagueId?: string
}

export interface LiveTickerBarProps {
  matches: LiveTickerMatch[]
  className?: string
}

export function LiveTickerBar({ matches, className }: LiveTickerBarProps) {
  if (!matches || matches.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'border-y border-[var(--accent-loss)]/30',
        className
      )}
      style={{ background: 'linear-gradient(to right, var(--card-bg), color-mix(in srgb, var(--accent-loss) 8%, var(--card-bg)))' }}
    >
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-2">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent-loss)]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent-loss)]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-loss)]" />
          </span>
          {matches.length} live
        </span>

        <div
          className="flex flex-1 items-center gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none]"
          aria-label="Live matches ticker"
        >
          {matches.map((m, idx) => {
            const href = m.id ? `/matches/${m.id}${m.leagueId ? `?league=${encodeURIComponent(m.leagueId)}` : ''}` : undefined
            const tile = (
              <div className="group/tile flex w-[220px] shrink-0 flex-col rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]/80 px-3 py-2 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-loss)]/55 hover:shadow-[var(--glow-loss)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">{m.home_team}</span>
                  <span className="font-numeric text-base font-black tabular-nums text-[var(--text-primary)]">{m.home_score ?? 0}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">{m.away_team}</span>
                  <span className="font-numeric text-base font-black tabular-nums text-[var(--text-primary)]">{m.away_score ?? 0}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  {m.league ? (
                    <LeagueBadge league={m.leagueId ?? m.league} size="sm" />
                  ) : (
                    <span />
                  )}
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-loss)]">
                    {m.minute ? `${m.minute}'` : 'LIVE'}
                  </span>
                </div>
              </div>
            )
            if (!href) {
              return <div key={m.id ?? idx}>{tile}</div>
            }
            return (
              <Link key={m.id ?? idx} href={href} prefetch={false}>
                {tile}
              </Link>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
