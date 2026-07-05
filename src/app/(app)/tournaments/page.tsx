'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, CalendarDays, Globe2 } from 'lucide-react'

import { SectionHeader, StatusChip } from '@/components/primitives'
import { TournamentCrest } from '@/components/tournament'
import { useGenderPreference } from '@/hooks/useGenderPreference'
import { staggerContainer, staggerItem } from '@/lib/motion'

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
  /** Action label (defaults to "View bracket"). */
  actionLabel?: string
  featured?: boolean
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
    actionLabel: 'World Cup hub',
    featured: true,
  },
  {
    id: 'uefa.champions',
    name: 'UEFA Champions League',
    region: 'Europe',
    gender: 'M',
    window: 'Sep 2025 – May 2026',
    status: 'settled',
    href: '/tournaments/uefa.champions',
    featured: true,
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
    featured: true,
  },
  {
    id: 'uefa.wchampions',
    name: 'UEFA Women’s Champions League',
    region: 'Europe',
    gender: 'F',
    window: 'Sep 2025 – May 2026',
    status: 'settled',
    href: '/tournaments/uefa.wchampions',
    featured: true,
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

const STATUS_LABEL: Record<TournamentStatus, string | undefined> = {
  live: 'live now',
  settled: 'concluded',
  upcoming: undefined,
}

function TournamentCard({
  tile,
  status,
  featured = false,
}: {
  tile: TournamentTile
  status: TournamentStatus
  featured?: boolean
}) {
  return (
    <Link
      href={tile.href}
      className={`group flex h-full flex-col rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)] ${
        featured ? 'surface-elevated p-5' : 'p-4'
      }`}
      style={
        featured
          ? {
              background:
                'linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 8%, var(--card-bg)), var(--card-bg) 60%)',
            }
          : undefined
      }
    >
      <div className="flex items-start gap-3">
        <TournamentCrest tournamentId={tile.id} name={tile.name} size={featured ? 48 : 36} />
        <div className="min-w-0 flex-1">
          <p
            className={`font-semibold leading-snug text-[var(--text-primary)] ${
              featured ? 'text-lg' : 'text-sm'
            }`}
          >
            {tile.name}
          </p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            <Globe2 className="h-3 w-3" aria-hidden="true" />
            {tile.region}
          </p>
        </div>
        <StatusChip status={status} label={STATUS_LABEL[status]} />
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <span className="tabular inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <CalendarDays className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
          {tile.window}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-primary)]">
          {tile.actionLabel ?? 'View bracket'}
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </span>
      </div>
    </Link>
  )
}

export default function TournamentsIndexPage() {
  const { gender } = useGenderPreference()
  const reduceMotion = useReducedMotion()
  const filter = gender === 'women' ? 'F' : 'M'
  const now = Date.now()

  const visible = TOURNAMENTS.filter((t) => t.gender === filter)
  const featured = visible.filter((t) => t.featured)
  const rest = visible.filter((t) => !t.featured)
  const live = visible.filter((t) => statusFor(t, now) === 'live')

  const containerProps = reduceMotion
    ? {}
    : { variants: staggerContainer(0.05), initial: 'hidden' as const, animate: 'visible' as const }
  const itemProps = reduceMotion ? {} : { variants: staggerItem }

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 pt-6 pb-12">
      {/* Hero band */}
      <section className="hero-band surface-elevated flex flex-wrap items-end justify-between gap-4 p-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            {gender === 'women' ? "Women's" : "Men's"} football
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--text-primary)]">
            Tournaments
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--text-secondary)]">
            Live brackets, group stages, and AI-projected paths to the final. Tap any tournament
            for the full picture.
          </p>
        </div>
        {live.length > 0 ? (
          <Link
            href={live[0].href}
            className="inline-flex min-h-[44px] items-center gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2 transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
          >
            <StatusChip status="live" label="live now" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">{live[0].name}</span>
            <ArrowRight className="h-4 w-4 text-[var(--text-tertiary)]" aria-hidden="true" />
          </Link>
        ) : null}
      </section>

      {featured.length > 0 ? (
        <section className="space-y-4">
          <SectionHeader kicker="Spotlight" title="Featured now" />
          <motion.div className="grid grid-cols-1 gap-4 md:grid-cols-2" {...containerProps}>
            {featured.map((t) => (
              <motion.div key={t.id} className="h-full" {...itemProps}>
                <TournamentCard tile={t} status={statusFor(t, now)} featured />
              </motion.div>
            ))}
          </motion.div>
        </section>
      ) : null}

      <section className="space-y-4">
        <SectionHeader
          kicker="Calendar"
          title="All tournaments"
          description="Every competition the model covers, with its current place in the season cycle."
        />
        <motion.div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          {...containerProps}
        >
          {rest.map((t) => (
            <motion.div key={t.id} className="h-full" {...itemProps}>
              <TournamentCard tile={t} status={statusFor(t, now)} />
            </motion.div>
          ))}
        </motion.div>
      </section>
    </div>
  )
}
