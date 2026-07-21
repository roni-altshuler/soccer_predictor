'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ChevronLeft } from 'lucide-react'

import { FlagBadge } from '@/components/primitives'
import {
  featuredBySlug,
  loadLandscape,
  type MomentumLandscape,
} from '@/lib/reconstructions'

/**
 * One reconstruction — a compact scoreboard header plus the 3D momentum wave.
 *
 * The wave is a WebGL surface, so it's loaded client-only (`ssr: false`); the
 * committed artifact is fetched on the client and gated to an honest empty when
 * missing. Unknown slugs fall back to a plain not-found notice.
 */
const MomentumWave = dynamic(
  () => import('@/components/reconstruction/MomentumWave').then((m) => m.MomentumWave),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
        style={{ height: 'clamp(320px, 46vw, 560px)' }}
        aria-hidden
      />
    ),
  }
)

export default function ReconstructionDetailPage() {
  const params = useParams()
  const slug = String(params.matchId ?? '')
  const featured = featuredBySlug(slug)

  const [landscape, setLandscape] = useState<MomentumLandscape | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!featured) {
      setLoading(false)
      return
    }
    let cancelled = false
    loadLandscape(slug)
      .then((data) => {
        if (!cancelled) setLandscape(data)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, featured])

  if (!featured) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center md:px-8">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Reconstruction not found</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          There is no showcased reconstruction at this address.
        </p>
        <Link
          href="/reconstructions"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-primary)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          All reconstructions
        </Link>
      </div>
    )
  }

  const home = landscape?.home.team ?? featured.home
  const away = landscape?.away.team ?? featured.away

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
      <Link
        href="/reconstructions"
        className="group -ml-2 inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        <span>All reconstructions</span>
      </Link>

      {/* Scoreboard header */}
      <header className="mt-2 border-b border-[var(--border-color)] pb-4">
        <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          {featured.competition} · {featured.stage}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-6">
          <div className="flex min-w-0 items-center justify-end gap-2.5">
            <span className="truncate text-right text-lg font-bold text-[var(--text-primary)] md:text-2xl">
              {home}
            </span>
            <FlagBadge country={home} teamName={home} size={32} />
          </div>
          <div className="px-2 text-center">
            {landscape ? (
              <div className="flex items-center gap-2.5">
                <span className="font-numeric text-3xl font-extrabold tabular-nums text-[var(--text-primary)] md:text-4xl">
                  {landscape.finalScore.home}
                </span>
                <span className="text-lg font-bold text-[var(--text-tertiary)]">–</span>
                <span className="font-numeric text-3xl font-extrabold tabular-nums text-[var(--text-primary)] md:text-4xl">
                  {landscape.finalScore.away}
                </span>
              </div>
            ) : (
              <span className="text-sm font-semibold text-[var(--text-tertiary)]">{featured.scoreline}</span>
            )}
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              Full time
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2.5">
            <FlagBadge country={away} teamName={away} size={32} />
            <span className="truncate text-lg font-bold text-[var(--text-primary)] md:text-2xl">
              {away}
            </span>
          </div>
        </div>
        {landscape?.finalScore.note && (
          <p className="mt-2 text-center text-xs text-[var(--text-tertiary)]">
            {landscape.finalScore.note}
          </p>
        )}
      </header>

      <div className="mt-5">
        {loading ? (
          <div
            className="w-full animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
            style={{ height: 'clamp(320px, 46vw, 560px)' }}
            aria-hidden
          />
        ) : (
          <MomentumWave landscape={landscape} />
        )}
      </div>
    </div>
  )
}
