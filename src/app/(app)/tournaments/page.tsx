'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { StatusChip } from '@/components/primitives'
import { TournamentCrest } from '@/components/tournament'
import { Card } from '@/components/ui/card'
import { useGenderPreference } from '@/hooks/useGenderPreference'

type TournamentStatus = 'live' | 'settled' | 'upcoming'

interface TournamentTile {
  id: string
  name: string
  region: string
  gender: 'M' | 'F'
  /** Editorial calendar label — public tournament dates, not model output. */
  window: string
  /** Precise window (ISO) when known — used to derive live/settled honestly. */
  windowStart?: string
  windowEnd?: string
  /** Static status for tournaments without a precise window. */
  status?: TournamentStatus
  /** Route target — the live World Cup gets its dedicated hub. */
  href: string
}

const TOURNAMENTS: TournamentTile[] = [
  {
    id: 'fifa.world',
    name: 'FIFA World Cup',
    region: 'World',
    gender: 'M',
    window: 'Jun 11 – Jul 19, 2026',
    windowStart: '2026-06-11T00:00:00Z',
    windowEnd: '2026-07-19T23:59:59Z',
    href: '/world-cup',
  },
  {
    id: 'uefa.champions',
    name: 'UEFA Champions League',
    region: 'Europe',
    gender: 'M',
    window: 'Sep 2025 – May 2026',
    status: 'settled',
    href: '/tournaments/uefa.champions',
  },
  {
    id: 'uefa.europa',
    name: 'UEFA Europa League',
    region: 'Europe',
    gender: 'M',
    window: 'Sep 2025 – May 2026',
    status: 'settled',
    href: '/tournaments/uefa.europa',
  },
  {
    id: 'uefa.conference',
    name: 'UEFA Conference League',
    region: 'Europe',
    gender: 'M',
    window: 'Sep 2025 – May 2026',
    status: 'settled',
    href: '/tournaments/uefa.conference',
  },
  {
    id: 'uefa.euro',
    name: 'UEFA European Championship',
    region: 'Europe',
    gender: 'M',
    window: 'Next: summer 2028',
    status: 'upcoming',
    href: '/tournaments/uefa.euro',
  },
  {
    id: 'conmebol.america',
    name: 'Copa América',
    region: 'South America',
    gender: 'M',
    window: 'Last played: USA 2024',
    status: 'settled',
    href: '/tournaments/conmebol.america',
  },
  {
    id: 'fifa.world.w',
    name: 'FIFA Women’s World Cup',
    region: 'World',
    gender: 'F',
    window: 'Next: Brazil 2027',
    status: 'upcoming',
    href: '/tournaments/fifa.world.w',
  },
  {
    id: 'uefa.wchampions',
    name: 'UEFA Women’s Champions League',
    region: 'Europe',
    gender: 'F',
    window: 'Sep 2025 – May 2026',
    status: 'settled',
    href: '/tournaments/uefa.wchampions',
  },
  {
    id: 'uefa.weuro',
    name: 'UEFA Women’s Euro',
    region: 'Europe',
    gender: 'F',
    window: 'Last played: Switzerland 2025',
    status: 'settled',
    href: '/tournaments/uefa.weuro',
  },
]

/** Resolve a tile's status: date windows win over the static label. */
function statusFor(t: TournamentTile, now: number): TournamentStatus {
  if (t.windowStart && t.windowEnd) {
    const start = Date.parse(t.windowStart)
    const end = Date.parse(t.windowEnd)
    if (now < start) return 'upcoming'
    if (now > end) return 'settled'
    return 'live'
  }
  return t.status ?? 'upcoming'
}

function TournamentRow({ tile, status }: { tile: TournamentTile; status: TournamentStatus }) {
  return (
    <Link
      href={tile.href}
      prefetch={false}
      className="flex min-h-[56px] items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--card-hover)]"
    >
      <TournamentCrest tournamentId={tile.id} name={tile.name} size={28} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
            {tile.name}
          </span>
          {status === 'live' && <StatusChip status="live" label="live now" />}
        </span>
        <span className="block text-[11px] text-[var(--text-tertiary)]">
          {tile.region} · {tile.window}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
    </Link>
  )
}

/**
 * Tournaments index — flat directory of cup competitions for the active
 * gender universe. Live tournaments bubble to the top; each row links to
 * its hub.
 */
export default function TournamentsIndexPage() {
  const { gender } = useGenderPreference()
  const filter = gender === 'women' ? 'F' : 'M'
  const now = Date.now()

  const visible = TOURNAMENTS.filter((t) => t.gender === filter)
  const groups = [
    { title: 'In progress', items: visible.filter((t) => statusFor(t, now) === 'live') },
    { title: 'Upcoming', items: visible.filter((t) => statusFor(t, now) === 'upcoming') },
    { title: 'Concluded', items: visible.filter((t) => statusFor(t, now) === 'settled') },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <h1 className="px-1 pb-3 text-lg font-bold tracking-tight text-[var(--text-primary)]">
        Tournaments
      </h1>

      <div className="space-y-4">
        {groups.map((group) => (
          <Card key={group.title} className="overflow-hidden p-0">
            <p className="border-b border-[var(--border-color)]/40 bg-[var(--background-secondary)]/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              {group.title}
            </p>
            <ul className="divide-y divide-[var(--border-color)]/40">
              {group.items.map((tile) => (
                <li key={tile.id}>
                  <TournamentRow tile={tile} status={statusFor(tile, now)} />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
