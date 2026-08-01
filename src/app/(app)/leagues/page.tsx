'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ChevronRight, Search, X } from 'lucide-react'

import { Stagger, StaggerItem } from '@/components/motion'
import { LeagueMark } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { leaguesForGender, type LeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

/** Regions that are not a single country — these group under cups. */
const SUPRANATIONAL = new Set(['EU', 'EARTH', 'SA'])

function isInternational(league: LeagueAccent): boolean {
  return !league.countryCode || SUPRANATIONAL.has(league.countryCode)
}

/** Case- and accent-insensitive match across the fields a fan would type. */
function matches(league: LeagueAccent, query: string): boolean {
  if (!query) return true
  // Strip combining marks so "copa america" finds "Copa América".
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  const q = norm(query)
  return [league.displayName, league.shortName, league.country].some((field) =>
    norm(field ?? '').includes(q)
  )
}

/**
 * Leagues index — a competition directory in the reference-class idiom:
 * domestic leagues first, then international and cup competitions, one compact
 * row each, filterable by name or country. Respects the men's/women's toggle.
 *
 * Every competition carries a real badge (see `leagueAccents`), seated on a
 * light plate by `LeagueMark` so dark marks stay legible on the dark surface.
 */
export default function LeaguesPage() {
  const { asQueryParam } = useGenderQuery()
  const [query, setQuery] = useState('')

  const leagues = useMemo(() => leaguesForGender(asQueryParam), [asQueryParam])

  const groups = useMemo(() => {
    const hits = leagues.filter((l) => matches(l, query))
    return [
      { title: 'Domestic leagues', items: hits.filter((l) => !isInternational(l)) },
      { title: 'International & cups', items: hits.filter(isInternational) },
    ].filter((g) => g.items.length > 0)
  }, [leagues, query])

  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <div className="flex items-baseline justify-between gap-3 px-1 pb-3">
        <h1 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">Leagues</h1>
        <span className="font-numeric text-[11px] tabular-nums text-[var(--text-tertiary)]">
          {total} {total === 1 ? 'competition' : 'competitions'}
        </span>
      </div>

      <div className="relative mb-3">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search competitions or countries"
          aria-label="Search competitions"
          className={cn(
            'h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)]',
            'pl-9 pr-9 text-[13px] text-[var(--text-primary)]',
            'placeholder:text-[var(--text-tertiary)]',
            'focus:border-[var(--accent-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]'
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <Card className="px-4 py-10 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            No competition matches “{query}”.
          </p>
        </Card>
      ) : (
        <Stagger className="space-y-4" inView={false} stagger={0.04}>
          {groups.map((group) => (
            <StaggerItem key={group.title}>
              <Card className="overflow-hidden p-0">
                <p className="border-b border-[var(--border-color)]/40 bg-[var(--background-secondary)]/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  {group.title}
                </p>
                <ul className="divide-y divide-[var(--border-color)]/40">
                  {group.items.map((league) => (
                    <li key={league.competitionId}>
                      <Link
                        href={`/leagues/${league.competitionId}`}
                        prefetch={false}
                        className={cn(
                          'group flex min-h-[56px] items-center gap-3 px-3',
                          'transition-colors hover:bg-[var(--card-hover)]',
                          'focus-visible:bg-[var(--card-hover)] focus-visible:outline-none'
                        )}
                      >
                        <LeagueMark league={league.competitionId} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
                            {league.displayName}
                          </span>
                          <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
                            {league.country}
                          </span>
                        </span>
                        <ChevronRight
                          className={cn(
                            'h-4 w-4 shrink-0 text-[var(--text-tertiary)]',
                            'transition-transform group-hover:translate-x-0.5',
                            'motion-reduce:transition-none motion-reduce:group-hover:translate-x-0'
                          )}
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  )
}
