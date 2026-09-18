'use client'

import { Bookmark, BookmarkCheck } from 'lucide-react'

import { normalizeTeamName } from '@/lib/watchlist'
import { useTeamWatchlist } from '@/hooks/useTeamWatchlist'
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
  const { teams, toggle, error } = useTeamWatchlist()
  const tracked = teams.some((t) => normalizeTeamName(t.name) === normalizeTeamName(teamName))

  return (
    <button
      type="button"
      onClick={() => toggle({ name: teamName, league })}
      aria-label={error ? `Couldn’t save ${teamName}. Retry` : `${tracked ? 'Unfollow' : 'Follow'} ${teamName}`}
      aria-pressed={tracked}
      className={cn(
        'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
        tracked
          ? 'border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] text-[var(--accent-primary)]'
          : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:border-[var(--border-hover)] hover:text-[var(--text-secondary)]',
        className,
      )}
    >
      {error ? 'Couldn’t save · retry' : tracked ? (
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
