'use client'

import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { DocsRow } from '@/components/evidence/DocsLink'
import { TournamentDirectory } from '@/components/tournament/TournamentDirectory'
import { TournamentPicker } from '@/components/tournament/TournamentPicker'
import type { TournamentForecast } from '@/components/tournament/TournamentPicker'

/**
 * The tournament layer — the football, not the argument for it.
 *
 * Two views, the way a competition section works everywhere else: a directory
 * of what is on, and then one competition in full. The page used to open
 * straight into a dropdown — one competition visible, thirteen behind a click —
 * which is a control rather than a home page, and it made a section covering
 * the Champions League, the World Cup and twelve more look like it covered one.
 *
 * The model's own record is not here. The knockout backtest — ladder against a
 * coin flip, calibration, per-round accuracy, the progression check — is on
 * `/evaluation`, per competition, because a reader who came to see who plays
 * Real Madrid should not have to scroll a calibration table to reach it.
 */

export default function TournamentsPage() {
  const [forecasts, setForecasts] = useState<TournamentForecast[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/v1/tournaments/predictions', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { tournaments: [] }))
      .then((p: { tournaments?: TournamentForecast[] }) => {
        if (!live) return
        setForecasts(p.tournaments ?? [])
        setLoading(false)
      })
      .catch(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          {openId ? (
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="-ml-1 inline-flex min-h-[36px] items-center gap-1 px-1 text-[12px] font-semibold text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              All tournaments
            </button>
          ) : null}
          <h1 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] md:text-[28px]">
            Tournaments
          </h1>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            Who advances each tie, and who lifts the trophy.
          </p>
        </div>
        <DocsRow
          docs={[
            { doc: 'tutorialBracket', label: 'How to read this' },
            { doc: 'models', hash: '3-knockout-tie--random-forest', label: 'How the model works' },
          ]}
        />
      </header>

      {loading ? (
        <div
          className="mt-8 h-64 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
          role="status"
          aria-label="Loading tournaments"
        />
      ) : !forecasts.length ? (
        <div className="mt-8">
          <EmptyState
            title="No tournament forecast has been generated here"
            description="It is a regenerable artifact, not shipped data. Run predict_tournaments to populate this page."
          />
        </div>
      ) : openId ? (
        <TournamentPicker className="mt-6" tournaments={forecasts} initialId={openId} />
      ) : (
        <TournamentDirectory
          className="mt-6"
          tournaments={forecasts}
          onOpen={(id) => setOpenId(id)}
        />
      )}
    </div>
  )
}
