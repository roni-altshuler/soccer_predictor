'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Brain,
  Clock,
  History,
  Loader2,
  Radio,
  Sparkles,
  X,
} from 'lucide-react'

import {
  PredictionResult as PredictionResultViz,
  type PredictionPayload,
} from '@/components/prediction/PredictionResult'
import { Badge } from '@/components/ui/badge'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { adaptLegacyPrediction } from '@/components/prediction/adaptLegacyPrediction'
import { cn } from '@/lib/utils'

type MatchState = 'live' | 'finished' | 'upcoming'

interface AIPredictionTabProps {
  /** The match's prediction if the live pipeline already picked it up. */
  prediction: PredictionPayload | null
  /** Inferred match state used to pick the empty-state copy. */
  matchState: MatchState
  /** Team + league context required for the retrospective /api/predict/any-teams call. */
  retrospectiveContext: {
    home_team: string
    away_team: string
    league?: string
    leagueId?: string
    home_score?: number | null
    away_score?: number | null
  }
}

/**
 * AI Prediction tab for the match detail page.
 *
 * **Opening the tab IS the request.** There is nothing to decide before asking
 * for a prediction, so a button that only means "yes, the thing you just
 * clicked on" is a gate, not a choice — and the two other match cards on this
 * site (`/season/fixture` and `/tournaments/tie`) already show the model's
 * answer the moment they render. This one now does the same: if the live
 * pipeline has not picked the fixture up, the on-demand number is fetched on
 * mount and the tab shows a loading card rather than a call to action.
 *
 * **What does not change is where the number came from.** A prediction computed
 * on demand is not the recorded pre-match pick, and for a match already played
 * it is not a forecast at all — this whole project is built on that
 * distinction. So every on-demand result carries a provenance line, and the
 * wording follows the match state rather than being softened into one label.
 * Removing a click must not remove the caveat.
 *
 *   1) Live prediction in the feed → render it, unlabelled: it is the real pick.
 *   2) No live pick → fetch immediately, then render under a provenance line.
 *   3) The fetch failed → say so, and offer a retry. A button here is a
 *      response to an error, not a gate in front of the answer.
 */
export function AIPredictionTab({
  prediction,
  matchState,
  retrospectiveContext,
}: AIPredictionTabProps) {
  const [retro, setRetro] = useState<PredictionPayload | null>(null)
  const [retroLoading, setRetroLoading] = useState(false)
  const [retroError, setRetroError] = useState<string | null>(null)
  const { asQueryParam } = useGenderQuery()

  const ctx = useRef(retrospectiveContext)
  ctx.current = retrospectiveContext

  const runRetrospective = useCallback(async () => {
    setRetroLoading(true)
    setRetroError(null)
    try {
      const res = await fetch(`/api/predict/any-teams?gender=${asQueryParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          home_team: ctx.current.home_team,
          away_team: ctx.current.away_team,
          home_league: ctx.current.league ?? '',
          away_league: ctx.current.league ?? '',
          gender: asQueryParam,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Retrospective prediction failed')
      }
      const data = await res.json()
      const adapted = adaptLegacyPrediction(data, ctx.current)
      if (!adapted) throw new Error('Prediction unavailable for this match')
      setRetro(adapted)
    } catch (err) {
      setRetroError(err instanceof Error ? err.message : 'Retrospective prediction failed')
    } finally {
      setRetroLoading(false)
    }
  }, [asQueryParam])

  // Fetch as soon as the tab mounts without a live pick. Guarded by a ref
  // rather than by the effect's dependencies: the parent builds
  // `retrospectiveContext` inline, so it is a new object on every render and
  // a dependency on it would re-fire this on each one.
  const started = useRef(false)
  useEffect(() => {
    if (prediction || started.current) return
    started.current = true
    void runRetrospective()
  }, [prediction, runRetrospective])

  // The prediction-tab body switches on match state: a recorded live pick
  // renders as-is, otherwise the on-demand retrospective (labelled with its
  // provenance), a loading card while it fetches, or the failed/empty state.
  let body: ReactNode
  if (prediction) {
    // 1) The live pipeline picked this fixture. It is the recorded pre-match
    //    pick, so it carries no caveat — it is the thing the caveats are about.
    body = <PredictionResultViz prediction={prediction} />
  } else if (retro) {
    // 2) Fetched on demand. Always labelled with where it came from.
    body = (
      <div className="flex flex-col gap-3">
        <ProvenanceNote matchState={matchState} />
        <PredictionResultViz prediction={retro} />
      </div>
    )
  } else if (retroLoading) {
    body = <LoadingCard matchState={matchState} />
  } else {
    // 3) The fetch failed, or there was nothing to ask about. A control here
    //    answers an error; it does not stand between the reader and the answer.
    body = (
      <FailedState
        matchState={matchState}
        error={retroError}
        onRetry={runRetrospective}
        retrospectiveContext={retrospectiveContext}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {body}
    </div>
  )
}

/** The card that holds the space while the on-demand number is being fetched. */
function LoadingCard({ matchState }: { matchState: MatchState }) {
  const label =
    matchState === 'finished'
      ? 'Running the model over what was known before kickoff'
      : 'Asking the model for this fixture'
  return (
    <div
      role="status"
      aria-live="polite"
      data-prediction="loading"
      className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6 md:p-8"
    >
      <div className="flex items-center gap-3">
        <Loader2
          className="h-4 w-4 animate-spin text-[var(--accent-ai)]"
          aria-hidden="true"
        />
        <p className="text-[13px] text-[var(--text-secondary)]">{label}…</p>
      </div>
      <div
        aria-hidden="true"
        className="mt-5 h-40 animate-pulse rounded-xl border border-[var(--border-color)]"
      />
    </div>
  )
}

function FailedState({
  matchState,
  error,
  onRetry,
  retrospectiveContext,
}: {
  matchState: MatchState
  error: string | null
  onRetry: () => void
  retrospectiveContext: AIPredictionTabProps['retrospectiveContext']
}) {
  const finalScore =
    typeof retrospectiveContext.home_score === 'number' &&
    typeof retrospectiveContext.away_score === 'number'
      ? `${retrospectiveContext.home_score}–${retrospectiveContext.away_score}`
      : null

  // The copy describes what failed, not what the reader might like to do:
  // asking was automatic, so there is no offer left to make.
  const copy: Record<MatchState, { eyebrow: string; title: string; body: string; Icon: typeof Brain }> = {
    finished: {
      eyebrow: 'Past fixture',
      title: 'Could not reach the model for this match',
      body:
        'This match has already finished and no live pre-match pick was recorded for it, so the number here has to be computed on demand — and that request did not come back.',
      Icon: History,
    },
    live: {
      eyebrow: 'Match in progress',
      title: 'Could not reach the model for this match',
      body:
        "This fixture did not get a pick before kickoff, so the number here has to be computed on demand — and that request did not come back.",
      Icon: Radio,
    },
    upcoming: {
      eyebrow: 'Upcoming fixture',
      title: 'Could not reach the model for this match',
      body:
        'The recorded pick appears here after the next refresh, which runs several times a day and covers the next 7 days. In the meantime the on-demand request did not come back.',
      Icon: Clock,
    },
  }

  const c = copy[matchState]
  const Icon = c.Icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
    >
      <div className="p-6 md:p-8">
        <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--accent-ai)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent-ai)_10%,transparent)] text-[var(--accent-ai)]">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="space-y-2">
              <Badge
                variant="outline"
                className="border-[color-mix(in_srgb,var(--accent-ai)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-ai)_10%,transparent)] text-[var(--accent-ai)]"
              >
                <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" /> {c.eyebrow}
              </Badge>
              <h3 className="text-h4 font-bold text-[var(--text-primary)]">{c.title}</h3>
              <p className="max-w-xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {c.body}
              </p>
              {finalScore && matchState === 'finished' && (
                <p className="text-[12px] text-[var(--text-tertiary)]">
                  Final score:{' '}
                  <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                    {retrospectiveContext.home_team} {finalScore} {retrospectiveContext.away_team}
                  </span>
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onRetry}
            className={cn(
              'inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-bold text-[var(--accent-on-primary)] transition-opacity hover:opacity-90'
            )}
          >
            <Brain className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </div>

        {error && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--accent-loss)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-loss)_5%,transparent)] p-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent-loss)_15%,transparent)] text-[var(--accent-loss)]">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <p className="text-[12px] text-[var(--text-secondary)]">{error}</p>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/**
 * Where an on-demand number came from — the caveat the removed button used to
 * carry implicitly.
 *
 * The wording follows the match state rather than collapsing into one label,
 * because the two cases are not equally serious. For an upcoming fixture this
 * is a genuine forecast that simply is not the recorded one. For a match
 * already played it is not a forecast at all, and calling it one is the single
 * mistake this project is most careful about.
 */
function ProvenanceNote({ matchState }: { matchState: MatchState }) {
  const past = matchState !== 'upcoming'
  return (
    <div
      data-provenance={past ? 'retrospective' : 'on-demand'}
      className="flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--accent-warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-warn)_8%,transparent)] px-4 py-2.5 text-[12px] text-[var(--text-secondary)]"
    >
      <History className="h-3.5 w-3.5 shrink-0 text-[var(--accent-warn)]" aria-hidden="true" />
      {past ? (
        <span>
          Run just now, after the match —{' '}
          <span className="font-semibold text-[var(--text-primary)]">not</span> a forecast, and not
          the recorded pre-match pick. Useful for auditing, never for scoring.
        </span>
      ) : (
        <span>
          Computed on demand just now. It is a real pre-match forecast, but{' '}
          <span className="font-semibold text-[var(--text-primary)]">not</span> the recorded pick —
          that one appears here after the next refresh, and it is the one that gets scored.
        </span>
      )}
    </div>
  )
}
