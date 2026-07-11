'use client'

import Link from 'next/link'
import { ChevronRight, Trophy } from 'lucide-react'

import { Stagger, StaggerItem } from '@/components/motion'
import { Card } from '@/components/ui/card'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { leaguesForGender, type LeagueAccent } from '@/lib/leagueAccents'

/** 28px league mark: real logo when available, neutral trophy fallback. */
function LeagueMark({ league }: { league: LeagueAccent }) {
  if (league.logoUrl) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--muted-bg)]/60">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={league.logoUrl} alt="" className="h-5 w-5 object-contain" aria-hidden="true" />
      </span>
    )
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--muted-bg)]/60 text-[var(--text-tertiary)]">
      <Trophy className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
    </span>
  )
}

/**
 * Leagues index — FotMob-style directory: domestic leagues first, then
 * international/cup competitions, one compact row per competition.
 * Respects the men's/women's universe toggle.
 */
export default function LeaguesPage() {
  const { asQueryParam } = useGenderQuery()
  const leagues = leaguesForGender(asQueryParam)

  const domestic = leagues.filter((l) => l.countryCode && !['EU', 'EARTH', 'SA'].includes(l.countryCode))
  const international = leagues.filter((l) => !l.countryCode || ['EU', 'EARTH', 'SA'].includes(l.countryCode))

  const groups = [
    { title: 'Domestic leagues', items: domestic },
    { title: 'International & cups', items: international },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <h1 className="px-1 pb-3 text-lg font-bold tracking-tight text-[var(--text-primary)]">
        Leagues
      </h1>

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
                      className="flex min-h-[52px] items-center gap-3 px-3 transition-colors hover:bg-[var(--card-hover)]"
                    >
                      <LeagueMark league={league} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
                          {league.displayName}
                        </span>
                        <span className="block text-[11px] text-[var(--text-tertiary)]">
                          {league.country}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  )
}
