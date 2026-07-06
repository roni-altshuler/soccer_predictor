'use client'

import { useCallback, useState } from 'react'
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
import type { AttributionItem } from '@/lib/types/attribution'
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
 * AI Prediction tab for the match detail page. Three flows:
 *   1) Live prediction in feed → render PredictionResultViz directly.
 *   2) No prediction + match is past or live → polished empty card with a
 *      "Run retrospective analysis" button that hits /api/predict/any-teams
 *      and shows the result with a "retrospective, not the live pick" banner.
 *   3) No prediction + upcoming → explain when the pipeline next runs and
 *      offer an on-demand prediction.
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

  const runRetrospective = useCallback(async () => {
    setRetroLoading(true)
    setRetroError(null)
    try {
      const res = await fetch(`/api/predict/any-teams?gender=${asQueryParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          home_team: retrospectiveContext.home_team,
          away_team: retrospectiveContext.away_team,
          home_league: retrospectiveContext.league ?? '',
          away_league: retrospectiveContext.league ?? '',
          gender: asQueryParam,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Retrospective prediction failed')
      }
      const data = await res.json()
      setRetro(adaptLegacyPrediction(data, retrospectiveContext))
    } catch (err) {
      setRetroError(err instanceof Error ? err.message : 'Retrospective prediction failed')
    } finally {
      setRetroLoading(false)
    }
  }, [asQueryParam, retrospectiveContext])

  // 1) The live pipeline already picked this fixture — render straight away.
  if (prediction) {
    return <PredictionResultViz prediction={prediction} />
  }

  // 2) The user already ran a retrospective on this load — show it with a banner.
  if (retro) {
    return (
      <div className="flex flex-col gap-3">
        <RetrospectiveBanner />
        <PredictionResultViz prediction={retro} />
      </div>
    )
  }

  // 3) Otherwise — polished empty state tuned to match state.
  return (
    <EmptyState
      matchState={matchState}
      loading={retroLoading}
      error={retroError}
      onRun={runRetrospective}
      retrospectiveContext={retrospectiveContext}
    />
  )
}

function EmptyState({
  matchState,
  loading,
  error,
  onRun,
  retrospectiveContext,
}: {
  matchState: MatchState
  loading: boolean
  error: string | null
  onRun: () => void
  retrospectiveContext: AIPredictionTabProps['retrospectiveContext']
}) {
  const finalScore =
    typeof retrospectiveContext.home_score === 'number' &&
    typeof retrospectiveContext.away_score === 'number'
      ? `${retrospectiveContext.home_score}–${retrospectiveContext.away_score}`
      : null

  const copy: Record<MatchState, { eyebrow: string; title: string; body: string; cta: string; Icon: typeof Brain }> = {
    finished: {
      eyebrow: 'Past fixture',
      title: 'No live pre-match pick on file',
      body:
        'This match has already finished. Live picks only cover upcoming fixtures, but you can run a retrospective analysis — what the AI would have predicted given everything we knew before kickoff.',
      cta: 'Run retrospective analysis',
      Icon: History,
    },
    live: {
      eyebrow: 'Match in progress',
      title: 'Live prediction not in the feed yet',
      body:
        "This fixture didn't get a pick before kickoff. You can still run an on-demand analysis — same AI, but it doesn't see in-play events.",
      cta: 'Run on-demand prediction',
      Icon: Radio,
    },
    upcoming: {
      eyebrow: 'Upcoming fixture',
      title: 'Live pick pending',
      body:
        'Predictions refresh several times a day and cover all matches in the next 7 days. This fixture will appear here after the next refresh — or you can generate an on-demand prediction now.',
      cta: 'Run prediction now',
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
      className="bento-card bento-ai overflow-hidden"
    >
      <div className="relative isolate p-6 md:p-8">
        {/* Layered ambient */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_15%_10%,color-mix(in_srgb,var(--accent-ai)_24%,transparent),transparent_60%),radial-gradient(50%_50%_at_85%_25%,color-mix(in_srgb,var(--accent-primary)_22%,transparent),transparent_60%)]"
        />

        <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--accent-ai)]/35 bg-[var(--accent-ai)]/15 text-[var(--accent-ai)]">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="space-y-2">
              <Badge
                variant="outline"
                className="border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]"
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
            onClick={onRun}
            disabled={loading}
            className={cn(
              'group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[var(--accent-ai)] to-[var(--accent-primary)] px-4 py-2.5 text-sm font-bold text-[var(--accent-on-primary)] shadow-lg shadow-[var(--accent-ai)]/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[var(--accent-ai)]/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0'
            )}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Running…
              </>
            ) : (
              <>
                <Brain className="h-4 w-4" aria-hidden="true" />
                {c.cta}
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-[var(--accent-loss)]/30 bg-[var(--accent-loss)]/5 p-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-loss)]/15 text-[var(--accent-loss)]">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <p className="text-[12px] text-[var(--text-secondary)]">{error}</p>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function RetrospectiveBanner() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--accent-warn)]/30 bg-[var(--accent-warn)]/8 px-4 py-2.5 text-[12px] text-[var(--text-secondary)]">
      <History className="h-3.5 w-3.5 shrink-0 text-[var(--accent-warn)]" aria-hidden="true" />
      <span>
        Retrospective analysis — same AI, but{' '}
        <span className="font-semibold text-[var(--text-primary)]">not</span> the live pre-match
        pick. Useful for auditing predictions on past fixtures.
      </span>
    </div>
  )
}

/* ---------------- legacy → PredictionPayload adapter (kept local) ---------------- */

interface LegacyPrediction {
  success?: boolean
  predictions?: { home_win?: number; draw?: number; away_win?: number }
  home_team?: string
  away_team?: string
  home_league?: string
  away_league?: string
  predicted_home_goals?: number
  predicted_away_goals?: number
  confidence?: number
  total_goals?: number
  markets?: { over_2_5?: number; btts_yes?: number }
  scoreline_probabilities?: Array<{ score: string; probability: number }>
  form?: { home_form?: number; away_form?: number }
  ratings?: { home_elo: number; away_elo: number; elo_difference: number }
  attribution?: AttributionItem[] | null
}

function parseScore(s: string): { home_goals: number; away_goals: number } {
  const m = s.match(/(\d+)\s*[-–]\s*(\d+)/)
  return m ? { home_goals: Number(m[1]), away_goals: Number(m[2]) } : { home_goals: 0, away_goals: 0 }
}

function adaptLegacyPrediction(
  r: LegacyPrediction,
  ctx: AIPredictionTabProps['retrospectiveContext']
): PredictionPayload {
  const homeWin = r.predictions?.home_win ?? 0
  const draw = r.predictions?.draw ?? 0
  const awayWin = r.predictions?.away_win ?? 0
  const total = homeWin + draw + awayWin || 1
  const norm = { home: homeWin / total, draw: draw / total, away: awayWin / total }
  const conf = (r.confidence ?? 0) / 100

  const scorelines = (r.scoreline_probabilities ?? []).map((s) => ({
    score: s.score,
    probability: s.probability,
    ...parseScore(s.score),
  }))
  const mostLikely =
    scorelines[0] ?? {
      score: `${Math.round(r.predicted_home_goals ?? 1)}-${Math.round(r.predicted_away_goals ?? 1)}`,
      home_goals: Math.round(r.predicted_home_goals ?? 1),
      away_goals: Math.round(r.predicted_away_goals ?? 1),
      probability: norm.home > norm.away ? norm.home : norm.away,
    }

  const totalXg = r.total_goals ?? (r.predicted_home_goals ?? 0) + (r.predicted_away_goals ?? 0)
  const over_2_5 = r.markets?.over_2_5 ?? Math.max(0, Math.min(1, (totalXg - 1.5) / 2))
  const over_1_5 = Math.max(over_2_5, Math.min(1, (totalXg - 0.5) / 2))
  const over_3_5 = Math.max(0, Math.min(over_2_5, (totalXg - 2.5) / 2))

  return {
    home_team: r.home_team ?? ctx.home_team,
    away_team: r.away_team ?? ctx.away_team,
    league: ctx.league ?? r.home_league ?? r.away_league ?? 'Match',
    outcome: { home_win: norm.home, draw: norm.draw, away_win: norm.away, confidence: conf },
    goals: {
      home_expected_goals: r.predicted_home_goals ?? 0,
      away_expected_goals: r.predicted_away_goals ?? 0,
      total_expected_goals: totalXg,
      over_1_5,
      over_2_5,
      over_3_5,
      btts_yes: r.markets?.btts_yes ?? 0.5,
    },
    most_likely_score: mostLikely,
    alternative_scores: scorelines.slice(1, 5),
    factors: {
      home_elo: r.ratings?.home_elo ?? 1500,
      away_elo: r.ratings?.away_elo ?? 1500,
      elo_difference: r.ratings?.elo_difference ?? 0,
      home_form_score: r.form?.home_form ?? 0.5,
      away_form_score: r.form?.away_form ?? 0.5,
      home_advantage: 0.25,
      h2h_advantage: 0,
      injury_impact: 0,
      rest_days_diff: 0,
      importance_factor: 1.0,
    },
    confidence: {
      data_quality: 0.8,
      model_certainty: conf,
      historical_accuracy: 0.5,
      overall: conf,
    },
    // Only real backend attribution is forwarded — nothing is fabricated
    // for legacy heuristic responses.
    attribution: Array.isArray(r.attribution) && r.attribution.length > 0 ? r.attribution : null,
    model_version: 'retrospective-legacy',
  }
}
