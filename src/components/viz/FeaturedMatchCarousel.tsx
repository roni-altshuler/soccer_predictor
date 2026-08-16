'use client'

import Link from 'next/link'
import { useRef, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface FeaturedMatch {
  /** Stable id (fixture id). */
  id: string
  homeTeam: string
  awayTeam: string
  /** Club crest URLs (ESPN CDN). */
  homeCrestUrl?: string
  awayCrestUrl?: string
  /** Club brand hexes — drive the low-saturation duotone panel. */
  homeColor: string
  awayColor: string
  /** League line ("Premier League · Matchweek 24"). */
  league: string
  /** Pre-formatted kickoff ("Sat 17:30"). Shown for upcoming fixtures. */
  kickoff: string
  status?: 'upcoming' | 'live' | 'ft'
  /** Status detail — live minute ("74'") or final score ("2 – 1"). */
  statusDetail?: string
  /** Optional AI pick line ("AI pick · Arsenal 2-1"). Cyan chip. */
  aiPick?: string
  /** Link target (match detail route). Card is not a link when omitted. */
  href?: string
}

interface FeaturedMatchCarouselProps {
  matches: FeaturedMatch[]
  className?: string
}

function StatusChip({ match }: { match: FeaturedMatch }) {
  if (match.status === 'live') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption uppercase tracking-[0.06em]"
        style={{
          background: 'var(--live-bg)',
          borderColor: 'var(--live-border)',
          color: 'var(--live-text)',
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full motion-safe:animate-pulse"
          style={{ background: 'var(--live-text)' }}
          aria-hidden
        />
        Live{match.statusDetail ? ` · ${match.statusDetail}` : ''}
      </span>
    )
  }
  if (match.status === 'ft') {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--border-color)] bg-[var(--meta-chip-bg)] px-2.5 py-0.5 text-caption uppercase tracking-[0.06em] text-[var(--text-secondary)]">
        FT{match.statusDetail ? ` · ${match.statusDetail}` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border-color)] bg-[var(--meta-chip-bg)] px-2.5 py-0.5 text-caption uppercase tracking-[0.06em] text-[var(--accent-primary)]">
      {match.kickoff}
    </span>
  )
}

function Crest({ url, team, side }: { url?: string; team: string; side: 'home' | 'away' }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ESPN crest, decorative sizing handled locally
      <img src={url} alt={`${team} crest`} width={56} height={56} className="h-12 w-12 object-contain sm:h-14 sm:w-14" />
    )
  }
  return (
    <span
      className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-color)] text-h4 font-semibold text-[var(--text-primary)] sm:h-14 sm:w-14"
      style={{ background: `color-mix(in srgb, var(${side === 'home' ? '--fm-home-color' : '--fm-away-color'}) 24%, var(--card-bg))` }}
      aria-hidden
    >
      {team.slice(0, 2).toUpperCase()}
    </span>
  )
}

/**
 * Snap-scroll featured-fixture carousel with club-colour duotone panels.
 *
 * Soccer has no per-fixture photography, so instead of a photo layer each
 * card gets a quiet FotMob-style duotone: the two club hexes (via the
 * `--fm-home-color` / `--fm-away-color` CSS vars set from props) mixed at low
 * strength into `var(--card-bg)` from the left and right edges. Big crests
 * flank a centre block with the league line and team names; a status chip
 * carries kickoff / live minute / FT score, and an optional cyan AI-pick chip
 * appears when a committed prediction exists. Scroll-snaps horizontally,
 * hover scales a subtle 1.02 (suppressed under reduced motion via
 * `motion-safe:`), and desktop gets chevron paging buttons.
 */
export function FeaturedMatchCarousel({ matches, className }: FeaturedMatchCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)

  if (matches.length === 0) return null

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollerRef.current
    if (!el) return
    const delta = Math.round(el.clientWidth * 0.85) * (dir === 'left' ? -1 : 1)
    el.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const renderCard = (match: FeaturedMatch) => {
    const panelStyle = {
      '--fm-home-color': match.homeColor,
      '--fm-away-color': match.awayColor,
      // Flat, like every other card. This was a 100° two-club wash that made
      // the featured strip the most gradient-looking thing on a site whose
      // design language has none — a Sevilla/Rayo card read as a maroon panel.
      // The club colours stay: they are carried by the per-side bars below,
      // which are solid fills, so identity survives without a painted
      // background. Colour carries meaning here, never atmosphere.
      background: 'var(--card-bg)',
    } as CSSProperties

    const inner = (
      <div
        className="relative flex h-full w-full flex-col justify-between overflow-hidden rounded-xl border border-[var(--border-color)] p-4 transition-transform duration-300 motion-safe:group-hover:scale-[1.02] sm:p-5"
        style={panelStyle}
      >
        <div className="flex items-center justify-between gap-2">
          <StatusChip match={match} />
          {match.aiPick && (
            <span
              className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption uppercase tracking-[0.06em]"
              style={{
                color: 'var(--accent-ai)',
                borderColor: 'color-mix(in srgb, var(--accent-ai) 40%, transparent)',
                background: 'color-mix(in srgb, var(--accent-ai) 10%, transparent)',
              }}
            >
              {match.aiPick}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Crest url={match.homeCrestUrl} team={match.homeTeam} side="home" />
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-meta text-[var(--text-tertiary)]">{match.league}</p>
            <p className="mt-1 truncate text-h4 text-[var(--text-primary)]">
              {match.homeTeam}
              <span className="mx-1.5 text-[var(--text-tertiary)]">v</span>
              {match.awayTeam}
            </p>
          </div>
          <Crest url={match.awayCrestUrl} team={match.awayTeam} side="away" />
        </div>
      </div>
    )

    const wrapper: ReactNode = match.href ? (
      <Link href={match.href} className="group block h-full w-full">
        {inner}
      </Link>
    ) : (
      <div className="group h-full w-full">{inner}</div>
    )

    return (
      <div
        key={match.id}
        className="h-40 w-[86vw] max-w-[440px] shrink-0 snap-start sm:h-44 sm:w-[400px]"
      >
        {wrapper}
      </div>
    )
  }

  return (
    <div className={cn('relative', className)}>
      <div className="absolute -top-11 right-0 z-10 hidden gap-2 sm:flex">
        <button
          type="button"
          onClick={() => scroll('left')}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)]"
          aria-label="Previous fixtures"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => scroll('right')}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)]"
          aria-label="Next fixtures"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {matches.map(renderCard)}
      </div>
    </div>
  )
}

export default FeaturedMatchCarousel
