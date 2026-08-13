'use client'

import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { DocsRow } from '@/components/evidence/DocsLink'
import { TournamentPicker } from '@/components/tournament/TournamentPicker'
import type { TournamentForecast } from '@/components/tournament/TournamentPicker'

/**
 * The tournament layer — the football, not the argument for it.
 *
 * This page used to be both. Under the brackets sat the whole knockout
 * backtest: the ladder against a coin flip, a calibration table, per-round
 * accuracy, the progression check. All of it is real evidence and none of it
 * belongs between a reader and the next round of the Champions League, so it
 * now lives on `/evaluation`, per competition, where a reader who wants to
 * interrogate the model can find it together with the league record rather
 * than scattered across the two pages that make the claims.
 *
 * What remains is one question — who advances, and who lifts it — answered for
 * one edition at a time. The framing that used to open the page in two
 * paragraphs (a tie has two outcomes, so these numbers are not the 1X2 numbers
 * made bigger) is in the handbook, linked below the picker.
 */

export default function TournamentsPage() {
  const [forecasts, setForecasts] = useState<TournamentForecast[]>([])
  const [loading, setLoading] = useState(true)

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
      <header>
        <h1 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] md:text-[28px]">
          Tournaments
        </h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Who advances each tie, and who lifts the trophy.
        </p>
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
      ) : (
        <div className="mt-6 space-y-6">
          <TournamentPicker tournaments={forecasts} />

          <DocsRow
            docs={[
              { doc: 'tutorialBracket', label: 'How to read this' },
              { doc: 'models', hash: '3-knockout-tie--random-forest', label: 'How the model works' },
            ]}
          />
        </div>
      )}
    </div>
  )
}
