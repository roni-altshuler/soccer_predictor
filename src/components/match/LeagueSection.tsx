'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { LeagueBadge } from '@/components/match/LeagueBadge'
import { MatchRow, type MatchRowMatch } from '@/components/match/MatchRow'
import { Badge } from '@/components/ui/badge'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

/**
 * One league group on a Match Centre page. Redesign goals (from the
 * "feels beginner" audit):
 *
 *   - Replace the ⚽ emoji fallback with the new `LeagueBadge` so each
 *     league has a clear brand presence.
 *   - Add a thin left-edge accent bar coloured per league (Premier
 *     League purple, La Liga red, NWSL green, …) for visual
 *     differentiation between competitions in a long list.
 *   - Surface a "table leader" pill in the header when the caller
 *     supplies one.
 *   - Keep the collapsible interaction — FotMob does the same.
 */

export interface LeagueSectionProps {
  leagueName: string
  leagueId?: string
  countryFlagUrl?: string | null
  leagueLogoUrl?: string | null
  countryLabel?: string
  matches: MatchRowMatch[]
  defaultOpen?: boolean
  hrefFor?: (match: MatchRowMatch) => string | undefined
  /** Optional caption shown next to the league name (e.g. "Manchester City lead"). */
  tableLeader?: string | null
}

/** Competitions contested by national teams — fixture identities resolve to country flags. */
const NATIONAL_COMPETITION_IDS = new Set([
  'fifa.world',
  'fifa.wwc',
  'fifa.friendly',
  'fifa.friendly.w',
  'uefa.euro',
  'uefa.weuro',
  'uefa.nations',
  'conmebol.america',
  'caf.nations',
  'concacaf.gold',
  'afc.asian.cup',
])

const NATIONAL_COMPETITION_NAME_RE =
  /world cup|european championship|nations league|copa am[eé]rica|gold cup|africa cup|asian cup|friendl/i

export function LeagueSection({
  leagueName,
  leagueId,
  matches,
  defaultOpen = true,
  hrefFor,
  tableLeader,
}: LeagueSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const accent = getLeagueAccent(leagueId ?? leagueName)

  if (matches.length === 0) return null

  const liveCount = matches.filter((m) => m.status === 'live').length
  const isNationalCompetition = leagueId
    ? NATIONAL_COMPETITION_IDS.has(leagueId)
    : NATIONAL_COMPETITION_NAME_RE.test(leagueName)
  // Stamp every match with the league accent (crest-fallback brand colour)
  // and the national-team flag so MatchRow renders real country flags.
  const stampedMatches = matches.map((m) => ({
    ...m,
    league_accent: m.league_accent ?? accent.accent,
    is_national: m.is_national ?? isNationalCompetition,
  }))

  return (
    <section
      className="relative border-b border-[var(--border-color)]/40 first:border-t"
      style={{ borderLeft: `3px solid ${accent.accent}` }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2.5 transition-colors',
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
        <LeagueBadge league={leagueId ?? leagueName} size="md" />
        <span className="ml-1 hidden truncate text-xs font-medium text-[var(--text-tertiary)] sm:inline">
          {accent.country}
        </span>
        {tableLeader && (
          <Badge
            variant="outline"
            className="hidden border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[10px] text-[var(--accent-primary)] md:inline-flex"
          >
            Leader: {tableLeader}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          {liveCount > 0 && (
            <Badge
              variant="outline"
              className="border-[var(--live-border)] bg-[var(--live-bg)] px-1.5 py-0 text-[10px] font-semibold text-[var(--live-text)]"
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-loss)]" />
              {liveCount} LIVE
            </Badge>
          )}
          <span className="text-[10px] font-medium text-[var(--text-tertiary)]">{matches.length}</span>
          {leagueId && (
            <Link
              href={`/leagues/${leagueId}`}
              onClick={(e) => e.stopPropagation()}
              prefetch={false}
              className="-my-2 inline-flex min-h-[40px] items-center px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-primary)] hover:underline"
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
              {stampedMatches.map((match, idx) => (
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
