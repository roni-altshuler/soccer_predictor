'use client'

import { useEffect, useState } from 'react'
import { Bookmark, BookmarkCheck } from 'lucide-react'

import {
  WATCHLIST_STORAGE_KEY,
  normalizeTeamName,
  type WatchTeam,
} from '@/lib/watchlist'
import { cn } from '@/lib/utils'

/**
 * Follow a club from its own page.
 *
 * Following used to be reachable only from a match detail page, which made
 * the whole feature invisible until a reader happened across the button
 * there. The club page is where a person who cares about one team already
 * is — and every club name on the site links here now.
 *
 * Same storage contract as the match-page follow buttons: `WatchTeam` rows
 * under WATCHLIST_STORAGE_KEY, matched on the Today feed by normalised name.
 */
export function FollowTeamButton({
  teamName,
  league,
  className,
}: {
  teamName: string
  /** League display name, stored alongside — the feed matches on name only. */
  league: string
  className?: string
}) {
  const [tracked, setTracked] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
      const teams: WatchTeam[] = raw ? JSON.parse(raw) : []
      const target = normalizeTeamName(teamName)
      setTracked(teams.some((t) => normalizeTeamName(t.name) === target))
    } catch {
      /* private mode — the button still renders, it just starts unfollowed */
    }
  }, [teamName])

  const toggle = () => {
    try {
      const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
      const teams: WatchTeam[] = raw ? JSON.parse(raw) : []
      const target = normalizeTeamName(teamName)
      const next = tracked
        ? teams.filter((t) => normalizeTeamName(t.name) !== target)
        : [...teams, { name: teamName, league }]
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next))
      setTracked(!tracked)
    } catch {
      /* storage refused the write; leave the state as it was */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={tracked}
      className={cn(
        'inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
        tracked
          ? 'border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] text-[var(--accent-primary)]'
          : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:border-[var(--border-hover)] hover:text-[var(--text-secondary)]',
        className,
      )}
    >
      {tracked ? (
        <>
          <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Following
        </>
      ) : (
        <>
          <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
          Follow
        </>
      )}
    </button>
  )
}
