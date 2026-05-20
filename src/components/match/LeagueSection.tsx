'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { MatchRow, type MatchRowMatch } from '@/components/match/MatchRow'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * One league group on a Match Centre page, FotMob-style:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ 🏴󠁧󠁢󠁥󠁮󠁧󠁿  Premier League · England                  ▾  4 │   <- header
 *   ├────────────────────────────────────────────────────────────┤
 *   │ 14:00     Tottenham         🏟  Chelsea            FT 1-2  │
 *   │ 16:30     Liverpool         🏟  Man City           20:30   │
 *   │ ...                                                        │
 *   └────────────────────────────────────────────────────────────┘
 *
 * The header is clickable to collapse the section. Falls back to a soccer-
 * ball icon when no flag URL is provided.
 */

export interface LeagueSectionProps {
  leagueName: string
  leagueId?: string
  countryFlagUrl?: string | null
  leagueLogoUrl?: string | null
  countryLabel?: string
  matches: MatchRowMatch[]
  defaultOpen?: boolean
  /** Optional href factory turning a match into the destination URL. */
  hrefFor?: (match: MatchRowMatch) => string | undefined
}

export function LeagueSection({
  leagueName,
  leagueId,
  countryFlagUrl,
  leagueLogoUrl,
  countryLabel,
  matches,
  defaultOpen = true,
  hrefFor,
}: LeagueSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  if (matches.length === 0) return null

  const liveCount = matches.filter((m) => m.status === 'live').length
  const headerIcon = leagueLogoUrl || countryFlagUrl

  return (
    <section className="border-b border-[var(--border-color)]/40 first:border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 transition-colors',
          'hover:bg-[var(--card-hover)] focus-visible:bg-[var(--card-hover)] focus-visible:outline-none'
        )}
        aria-expanded={open}
        aria-controls={`league-${leagueId ?? leagueName}-content`}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" strokeWidth={2.5} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" strokeWidth={2.5} />
        )}
        {headerIcon ? (
          <img
            src={headerIcon}
            alt=""
            aria-hidden="true"
            className="h-4 w-auto rounded-sm"
            loading="lazy"
          />
        ) : (
          <span className="text-sm" aria-hidden="true">
            ⚽
          </span>
        )}
        <span className="truncate text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {leagueName}
          {countryLabel && (
            <span className="ml-1.5 text-[var(--text-tertiary)] normal-case font-medium tracking-normal">
              · {countryLabel}
            </span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {liveCount > 0 && (
            <Badge
              variant="outline"
              className="border-red-500/40 bg-red-500/10 px-1.5 py-0 text-[10px] font-semibold text-red-400"
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              {liveCount} LIVE
            </Badge>
          )}
          <span className="text-[10px] font-medium text-[var(--text-tertiary)]">{matches.length}</span>
          {leagueId && (
            <Link
              href={`/leagues/${leagueId}`}
              onClick={(e) => e.stopPropagation()}
              prefetch={false}
              className="text-[10px] font-medium text-[var(--accent-primary)] hover:underline"
            >
              View
            </Link>
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`league-${leagueId ?? leagueName}-content`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-[var(--border-color)]/40">
              {matches.map((match, idx) => (
                <MatchRow
                  key={match.id ?? `${leagueName}-${idx}`}
                  match={match}
                  href={hrefFor?.(match)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
