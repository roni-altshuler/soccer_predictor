import Link from 'next/link'
import type { Metadata } from 'next'

import { FlagBadge } from '@/components/primitives'
import { FEATURED_RECONSTRUCTIONS } from '@/lib/reconstructions'

export const metadata: Metadata = {
  title: 'Match reconstructions',
  description:
    'Famous finals rebuilt as 3D momentum landscapes from full event data — a showcase.',
}

/**
 * Reconstructions showcase index (unlinked — not yet in nav). A short honest
 * intro plus one card per featured match. Each card opens the 3D momentum wave.
 * A visible data credit is required by the source licence.
 */
export default function ReconstructionsIndexPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
      <header className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Showcase
        </p>
        <h1 className="mt-1 text-2xl font-bold text-[var(--text-primary)]">Match reconstructions</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          A handful of famous finals rebuilt from their full event streams — thousands of passes,
          carries and shots — as sweeping 3D momentum landscapes you can orbit. The long axis is the
          clock, the depth is the pitch from the home side&apos;s point of view, and the height is who
          held the attacking threat, minute by minute. Only matches with complete event data can be
          shown this way, so this is a curated set rather than a per-match feature.
        </p>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {FEATURED_RECONSTRUCTIONS.map((m) => (
          <Link
            key={m.slug}
            href={`/reconstructions/${m.slug}`}
            className="group flex flex-col rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 transition-colors hover:bg-[var(--card-hover)]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                {m.competition} · {m.stage}
              </span>
              <span className="text-[11px] text-[var(--text-tertiary)]">
                {new Date(m.date).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <FlagBadge country={m.home} teamName={m.home} size={28} />
                <span className="truncate text-base font-bold text-[var(--text-primary)]">
                  {m.home}
                </span>
              </div>
              <span className="text-sm font-medium text-[var(--text-tertiary)]">v</span>
              <div className="flex min-w-0 items-center gap-2">
                <FlagBadge country={m.away} teamName={m.away} size={28} />
                <span className="truncate text-base font-bold text-[var(--text-primary)]">
                  {m.away}
                </span>
              </div>
            </div>

            <p className="mt-2 text-sm font-semibold tabular-nums text-[var(--text-secondary)]">
              {m.scoreline}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-tertiary)]">{m.blurb}</p>

            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-primary)]">
              Open 3D wave
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-6 text-[11px] text-[var(--text-tertiary)]">Data: StatsBomb</p>
    </div>
  )
}
