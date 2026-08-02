'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useCompanionSubject } from '@/components/companion/CompanionProvider'
import { AnimatedNumber } from '@/components/motion'
import { FeaturedMatch } from '@/components/live/FeaturedMatch'
import { LiveRailCard } from '@/components/live/LiveRailCard'
import { coerceMinute, type LiveMatch } from '@/components/live/types'
import { useGenderQuery } from '@/hooks/useGenderQuery'

interface TodaysMatchesResponse {
  live: LiveMatch[]
  upcoming: LiveMatch[]
  completed: LiveMatch[]
}

const POLL_MS = 30_000

function sortLive(a: LiveMatch, b: LiveMatch): number {
  return (coerceMinute(b.minute) ?? 0) - (coerceMinute(a.minute) ?? 0)
}
function sortUpcoming(a: LiveMatch, b: LiveMatch): number {
  return new Date(a.time).getTime() - new Date(b.time).getTime()
}

export default function LivePage() {
  const { asQueryParam } = useGenderQuery()

  // Tell the Ask Pitchverse rail the fan is on the live hub, in this universe.
  // The live board has no single subject, so the rail offers its live-aware
  // capabilities (everything running now, the model read alongside) rather than
  // the global default — and follows the gender toggle without a page reload.
  useCompanionSubject({ kind: 'live', gender: asQueryParam })

  const [data, setData] = useState<TodaysMatchesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const hasLiveRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/todays_matches?gender=${asQueryParam}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = (await res.json()) as TodaysMatchesResponse
      setData({
        live: Array.isArray(json.live) ? json.live : [],
        upcoming: Array.isArray(json.upcoming) ? json.upcoming : [],
        completed: [],
      })
      hasLiveRef.current = Array.isArray(json.live) && json.live.length > 0
    } catch {
      setData((prev) => prev ?? { live: [], upcoming: [], completed: [] })
    } finally {
      setLoading(false)
    }
  }, [asQueryParam])

  // Initial load + refetch whenever the gender universe changes.
  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // Poll while matches are live so the engine reads stay current.
  useEffect(() => {
    const id = setInterval(() => {
      if (hasLiveRef.current) load()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const live = useMemo(() => [...(data?.live ?? [])].sort(sortLive), [data])
  const upcoming = useMemo(() => [...(data?.upcoming ?? [])].sort(sortUpcoming), [data])

  const mode: 'live' | 'upcoming' | 'empty' = live.length ? 'live' : upcoming.length ? 'upcoming' : 'empty'
  const pool = mode === 'live' ? live : upcoming
  const featured = pool.find((m) => m.id === selectedId) ?? pool[0] ?? null

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Hero. */}
      <header className="live-hero mb-6 px-5 py-7 sm:px-8 sm:py-9">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--accent-ai)]">
          <span className="live-dot" />
          Live Intelligence
        </p>
        <h1 className="max-w-2xl text-2xl font-black leading-tight tracking-tight text-[var(--text-primary)] sm:text-4xl">
          The match, as the model sees it.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
          Win probability, the pre-match&nbsp;→&nbsp;now shift, historical base rates, and the likeliest
          finish — recalculated from the score and clock as the game moves.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <AnimatedNumber
              value={live.length}
              className="text-3xl font-black text-[var(--text-primary)]"
            />
            <span className="text-sm font-semibold text-[var(--text-secondary)]">
              {live.length === 1 ? 'match live now' : 'matches live now'}
            </span>
          </div>
          {upcoming.length > 0 && (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black tabular-nums text-[var(--text-primary)]">
                {upcoming.length}
              </span>
              <span className="text-sm font-semibold text-[var(--text-secondary)]">on deck today</span>
            </div>
          )}
        </div>
      </header>

      {loading && !data ? (
        <LiveSkeleton />
      ) : mode === 'empty' ? (
        <EmptyState />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Featured spotlight. */}
          <section aria-label="Featured match">
            {mode === 'upcoming' && (
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                Next up — pre-match read
              </p>
            )}
            {featured && (
              <FeaturedMatch key={featured.id} match={featured} isLive={mode === 'live'} />
            )}
          </section>

          {/* Rail. */}
          <aside className="space-y-5" aria-label="Match rail">
            {live.length > 0 && (
              <div>
                <p className="mb-2.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                  <span className="live-dot" /> Live now
                </p>
                <div className="space-y-2.5">
                  {live.map((m) => (
                    <LiveRailCard
                      key={m.id}
                      match={m}
                      isLive
                      selected={featured?.id === m.id}
                      onSelect={() => setSelectedId(m.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {upcoming.length > 0 && (
              <div>
                <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                  Coming up
                </p>
                <div className="space-y-2.5">
                  {upcoming.slice(0, 8).map((m) => (
                    <LiveRailCard
                      key={m.id}
                      match={m}
                      isLive={false}
                      selected={mode === 'upcoming' && featured?.id === m.id}
                      onSelect={() => setSelectedId(m.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

function LiveSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="skeleton-shimmer h-[520px] rounded-[20px]" />
      <div className="space-y-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-24 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--card-bg)] p-10 text-center">
      <p className="text-lg font-bold text-[var(--text-primary)]">No matches live or on deck right now</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--text-secondary)]">
        The board lights up the moment a tracked fixture kicks off. In the meantime, explore upcoming
        fixtures or how the model has been performing.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <Link href="/upcoming" className="btn-secondary">
          Upcoming fixtures
        </Link>
        <Link href="/accuracy" className="btn-primary">
          Model accuracy
        </Link>
      </div>
    </div>
  )
}
