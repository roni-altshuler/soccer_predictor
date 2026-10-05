'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Activity, Brain, Goal, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Prob1X2 } from '@/components/primitives'
import { WhyThisPrediction } from '@/components/prediction/WhyThisPrediction'
import {
  ChartContainer,
  OutcomeBars,
  ScorelineHeatmap,
  type OutcomeBarDatum,
  ScorelineChips,
  type ScorelineCell,
  type ScorelinePick,
} from '@/components/viz'
import type { AttributionItem } from '@/lib/types/attribution'
import { cn, clamp, formatPct } from '@/lib/utils'
import { isValidProbabilityTriple } from '@/lib/probabilityValidation'
import { availableNumber, availableProbability, validScorelines } from './predictionEvidence'

/**
 * Team identity tints — the match-detail page defines `--team-tint-home` /
 * `--team-tint-away` per fixture (club/league colours); everywhere else the
 * bars fall back to the Matchday brand tokens.
 */
const HOME_TINT = 'var(--team-tint-home, var(--accent-primary))'
const AWAY_TINT = 'var(--team-tint-away, var(--accent-info))'

/** Flat v3 card surface — 1px hairline, 12px radius, no elevation/glow. */
const FLAT_CARD =
  'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5'

/** Missing evidence stays null/absent; the full unified backend shape remains valid. */
export interface PredictionPayload {
  match_id?: number | string
  home_team: string
  away_team: string
  league: string
  outcome: { home_win: number; draw: number; away_win: number; confidence?: number | null }
  goals: {
    home_expected_goals?: number | null
    away_expected_goals?: number | null
    total_expected_goals?: number | null
    over_1_5?: number | null
    over_2_5?: number | null
    over_3_5?: number | null
    btts_yes?: number | null
  }
  most_likely_score: {
    score: string; home_goals: number; away_goals: number; probability: number | null
  } | null
  alternative_scores: NonNullable<PredictionPayload['most_likely_score']>[]
  /** Only inputs published with the prediction, never inferred from match context. */
  factors?: Partial<Record<
    'home_elo' | 'away_elo' | 'elo_difference' | 'home_form_score' | 'away_form_score' |
    'home_advantage' | 'h2h_advantage' | 'injury_impact' | 'rest_days_diff' | 'importance_factor',
    number | null
  >> | null
  /** Context published separately; it does not explain the prediction. */
  context?: Array<{ label: string; value: string }>
  confidence?: {
    data_quality?: number | null
    model_certainty?: number | null
    historical_accuracy?: number | null
    overall?: number | null
  } | null
  attribution?: AttributionItem[] | null
  model_version?: string
}

interface PredictionResultProps {
  prediction: PredictionPayload
  className?: string
}

/* ---------------- helpers ---------------- */

/**
 * Quiet confidence chip — replaces the old circular gauge. One line of
 * tabular numerals on a hairline chip; no needles, no dials.
 */
function ConfidenceChip({ value }: { value: number }) {
  const pct = clamp(value)
  const band = pct >= 0.7 ? 'High' : pct >= 0.45 ? 'Medium' : 'Low'
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)]"
      aria-label={`Prediction confidence ${Math.round(pct * 100)} percent, ${band}`}
    >
      <span className="tabular-nums text-[var(--text-primary)]">{Math.round(pct * 100)}%</span>
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {band} confidence
      </span>
    </span>
  )
}

/** Map the 1X2 outcome triple onto club-coloured OutcomeBars rows. */
function buildOutcomeRows(prediction: PredictionPayload): OutcomeBarDatum[] {
  return [
    {
      label: prediction.home_team,
      probability: clamp(prediction.outcome.home_win),
      color: HOME_TINT,
      sublabel: 'Home',
    },
    { label: 'Draw', probability: clamp(prediction.outcome.draw), color: 'var(--accent-warn)' },
    {
      label: prediction.away_team,
      probability: clamp(prediction.outcome.away_win),
      color: AWAY_TINT,
      sublabel: 'Away',
    },
  ]
}

/** Scoreline distribution cells from the payload's top scorelines. */
function buildScorelineCells(prediction: PredictionPayload): ScorelineCell[] {
  return validScorelines([prediction.most_likely_score, ...prediction.alternative_scores])
    .map((s) => ({ home: s.home_goals, away: s.away_goals, probability: s.probability! }))
}

function XGCompare({ home, away, homeTeam, awayTeam }: { home: number; away: number; homeTeam: string; awayTeam: string }) {
  const reducedMotion = useReducedMotion()
  const total = Math.max(0.1, home + away)
  const homePct = (home / total) * 100
  const awayPct = (away / total) * 100
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Expected goals</span>
        <span className="text-small font-bold text-[var(--text-primary)] tabular-nums">
          {home.toFixed(2)} <span className="text-[var(--text-tertiary)]">vs</span> {away.toFixed(2)}
        </span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--muted-bg)] ring-1 ring-[var(--border-color)]">
        <motion.div
          className="h-full"
          style={{ background: HOME_TINT }}
          initial={{ width: 0 }}
          animate={{ width: `${homePct}%` }}
          transition={{ duration: reducedMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.div
          className="h-full"
          style={{ background: AWAY_TINT }}
          initial={{ width: 0 }}
          animate={{ width: `${awayPct}%` }}
          transition={{ duration: reducedMotion ? 0 : 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--text-tertiary)]">
        <span className="truncate pr-2">{homeTeam}</span>
        <span className="truncate pl-2 text-right">{awayTeam}</span>
      </div>
    </div>
  )
}

/**
 * Scoreline panel — a probability heatmap of the model's top scorelines
 * (predicted cell outlined) when a real distribution exists; a single quiet
 * chip when only the headline scoreline is known. Never pads the grid with
 * fabricated cells.
 */
function ScorelinePanel({
  cells,
  mostLikely,
}: {
  cells: ScorelineCell[]
  mostLikely: PredictionPayload['most_likely_score']
}) {
  // One pick, shared by the chips above the grid and the cells inside it.
  const [pick, setPick] = useState<ScorelinePick | null>(null)
  if (cells.length >= 3) {
    return (
      <div>
        {/* The chips live OUTSIDE the fixed-height chart box: it positions
            its children absolutely, so anything that wraps in there would
            overlap the card below. */}
        <ScorelineChips cells={cells} selected={pick} onSelect={setPick} className="mb-3" />
        {/* Heatmap height ≈ width (square grid + 48px axes) plus the one
            readout line; cap the width so the reserved box never clips. */}
        <ChartContainer height={356} label="Loading scoreline probabilities">
          <div className="mx-auto" style={{ maxWidth: 328 }}>
            {/* No `predicted` override — the heatmap outlines its true peak
                cell, so an unsorted upstream list can't outline an off-mode
                scoreline. */}
            <ScorelineHeatmap
              cells={cells}
              maxGoals={4}
              selected={pick}
              onSelect={setPick}
            />
          </div>
        </ChartContainer>
      </div>
    )
  }
  if (!mostLikely) return <Unavailable>Scoreline unavailable.</Unavailable>
  const probability = availableProbability(mostLikely.probability)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2">
        <span className="text-h4 font-bold tabular-nums text-[var(--text-primary)]">{mostLikely.score}</span>
        {probability !== null && <span className="text-caption tabular-nums text-[var(--text-secondary)]">{formatPct(probability, 1)}</span>}
      </span>
      <span className="text-caption text-[var(--text-tertiary)]">
        {probability !== null ? 'Most likely scoreline' : 'Exact-score chance unavailable'}
      </span>
    </div>
  )
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-[var(--text-tertiary)]">{children}</p>
}

function MarketsStrip({ goals }: { goals: PredictionPayload['goals'] }) {
  const cells: { label: string; value: number | null | undefined }[] = [
    { label: 'Over 1.5', value: goals.over_1_5 },
    { label: 'Over 2.5', value: goals.over_2_5 },
    { label: 'Over 3.5', value: goals.over_3_5 },
    { label: 'BTTS', value: goals.btts_yes },
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1.5 text-center"
        >
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{c.label}</div>
          <div className={cn('mt-1 text-small tabular-nums', availableProbability(c.value) === null ? 'text-[11px] text-[var(--text-tertiary)]' : 'font-bold text-[var(--text-primary)]')}>
            {availableProbability(c.value) === null ? 'Unavailable' : formatPct(c.value!)}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Raw published inputs are evidence of values, not evidence of their influence. */
function PredictionInputs({ factors }: { factors: PredictionPayload['factors'] }) {
  const labels: Record<string, string> = {
    home_elo: 'Home rating', away_elo: 'Away rating', elo_difference: 'Rating difference',
    home_form_score: 'Home form score', away_form_score: 'Away form score',
    home_advantage: 'Home advantage input', h2h_advantage: 'Head-to-head input',
    injury_impact: 'Squad availability input', rest_days_diff: 'Rest-day difference',
    importance_factor: 'Match importance input',
  }
  const inputs = Object.entries(factors ?? {}).filter(([key, value]) => key in labels && availableNumber(value) !== null)
  if (!inputs.length) return <Unavailable>Individual inputs are unavailable for this prediction.</Unavailable>
  return (
    <>
      <Unavailable>Published inputs. Their influence is shown only when an explanation is available.</Unavailable>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {inputs.map(([key, value]) => <div key={key} className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] py-2.5 text-xs">
          <dt className="text-[var(--text-secondary)]">{labels[key]}</dt>
          <dd className="font-mono tabular-nums text-[var(--text-primary)]">{Number(value).toLocaleString('en-GB', { maximumFractionDigits: 3 })}</dd>
        </div>)}
      </dl>
    </>
  )
}

/* ---------------- main ---------------- */

export function PredictionResult({ prediction, className }: PredictionResultProps) {
  const reducedMotion = useReducedMotion()
  const totalXg = availableNumber(prediction.goals.total_expected_goals)
  const homeXg = availableNumber(prediction.goals.home_expected_goals)
  const awayXg = availableNumber(prediction.goals.away_expected_goals)
  const confidence = availableProbability(prediction.confidence?.overall ?? prediction.outcome.confidence)
  const { home_win, draw, away_win } = prediction.outcome
  const predictedOutcome: 'home' | 'draw' | 'away' =
    home_win >= draw && home_win >= away_win ? 'home' : away_win >= draw ? 'away' : 'draw'
  const outcomeRows = buildOutcomeRows(prediction)
  const scorelineCells = buildScorelineCells(prediction)
  if (!isValidProbabilityTriple({ home: home_win, draw, away: away_win })) {
    return <div className={cn(FLAT_CARD, className)}><Unavailable>Prediction unavailable for this match.</Unavailable></div>
  }
  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex flex-col gap-4', className)}
    >
      <div className={FLAT_CARD}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-[var(--accent-ai)]" strokeWidth={2.5} />
            <h2 className="text-h4 font-bold text-[var(--text-primary)]">Win probability</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-[color-mix(in_srgb,var(--accent-ai)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-ai)_10%,transparent)] text-[var(--accent-ai)]">
              {prediction.league}
            </Badge>
            {/* Confidence as a quiet chip — no gauges, no needles. */}
            {confidence !== null && <ConfidenceChip value={confidence} />}
          </div>
        </div>
        {/* bet365-grammar 1X2 boxes — argmax tinted cyan */}
        <div className="mb-3 flex items-center justify-center">
          <Prob1X2
            home={prediction.outcome.home_win}
            draw={prediction.outcome.draw}
            away={prediction.outcome.away_win}
          />
        </div>
        {/* Club-coloured Home/Draw/Away probability rows (viz kit). */}
        <OutcomeBars data={outcomeRows} sorted={false} />
      </div>

      <div className={cn(FLAT_CARD, 'flex flex-col gap-3')}>
        <div className="flex items-center gap-2">
          <Goal className="h-4 w-4 text-[var(--accent-primary)]" strokeWidth={2.5} />
          <h3 className="text-h4 font-bold text-[var(--text-primary)]">Goals & markets</h3>
          {totalXg !== null && totalXg >= 0 && <Badge variant="outline" className="ml-auto shrink-0 whitespace-nowrap text-[11px]">{totalXg.toFixed(2)} total xG</Badge>}
        </div>
        {homeXg !== null && awayXg !== null && homeXg >= 0 && awayXg >= 0 ? <XGCompare
          home={homeXg} away={awayXg} homeTeam={prediction.home_team} awayTeam={prediction.away_team}
        /> : <Unavailable>Expected goals by team unavailable.</Unavailable>}
        <MarketsStrip goals={prediction.goals} />
      </div>

      <div className={FLAT_CARD}>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent-primary)]" strokeWidth={2.5} />
          <h3 className="text-h4 font-bold text-[var(--text-primary)]">{scorelineCells.length ? 'Most likely scorelines' : 'Score pick'}</h3>
        </div>
        <ScorelinePanel cells={scorelineCells} mostLikely={scorelineCells[0] ? {
          score: `${scorelineCells[0].home}-${scorelineCells[0].away}`, home_goals: scorelineCells[0].home,
          away_goals: scorelineCells[0].away, probability: scorelineCells[0].probability,
        } : prediction.most_likely_score} />
      </div>

      <div className={FLAT_CARD}>
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--accent-ai)]" strokeWidth={2.5} />
          <h3 className="text-h4 font-bold text-[var(--text-primary)]">Prediction inputs</h3>
        </div>
        <PredictionInputs factors={prediction.factors} />
      </div>

      {!!prediction.context?.length && <div className={FLAT_CARD}>
        <h3 className="mb-2 text-h4 font-bold text-[var(--text-primary)]">Match context</h3>
        <Unavailable>Background information, separate from the prediction explanation.</Unavailable>
        <dl className="mt-3 divide-y divide-[var(--border-color)]">
          {prediction.context.map((item) => <div key={item.label} className="flex flex-wrap justify-between gap-2 py-2.5 text-xs">
            <dt className="text-[var(--text-secondary)]">{item.label}</dt>
            <dd className="font-mono text-[var(--text-primary)]">{item.value}</dd>
          </div>)}
        </dl>
      </div>}

      {/* "Why this prediction" — only when the backend supplied real
          per-feature attribution; renders nothing otherwise. */}
      <WhyThisPrediction
        attribution={prediction.attribution}
        predictedOutcome={predictedOutcome}
        homeTeam={prediction.home_team}
        awayTeam={prediction.away_team}
      />

      <Separator className="opacity-50" />
      <p className="text-center text-[10px] text-[var(--text-tertiary)]">
        A model probability, not a recommendation. Scored against the closing line on the accuracy page.
      </p>
    </motion.div>
  )
}
