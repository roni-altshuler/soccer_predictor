'use client'

import { motion } from 'framer-motion'
import { Activity, Brain, Goal, ShieldAlert, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Prob1X2 } from '@/components/primitives'
import { WhyThisPrediction } from '@/components/prediction/WhyThisPrediction'
import {
  ChartContainer,
  OutcomeBars,
  ScorelineHeatmap,
  type OutcomeBarDatum,
  type ScorelineCell,
} from '@/components/viz'
import type { AttributionItem } from '@/lib/types/attribution'
import { cn, clamp, formatPct } from '@/lib/utils'

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

/**
 * Showcase prediction visualization, designed for the AI prediction page
 * and the match-detail "AI Prediction" tab.
 *
 * Four sub-panels:
 *   ┌── outcome bars (3 bars, animated width) ───────────────────────────┐
 *   ├── confidence gauge (circular dial) + xG dial ─────────────────────┤
 *   ├── scoreline grid (top 5 with mini bars) ──────────────────────────┤
 *   └── top factors (ELO diff, form, H2H, ... with bullet bar) ─────────┘
 *
 * Pure presentational — accepts a `MatchPrediction`-shaped object straight
 * from the API.
 */

export interface PredictionPayload {
  match_id?: number | string
  home_team: string
  away_team: string
  league: string
  outcome: {
    home_win: number
    draw: number
    away_win: number
    confidence: number
  }
  goals: {
    home_expected_goals: number
    away_expected_goals: number
    total_expected_goals: number
    over_1_5: number
    over_2_5: number
    over_3_5: number
    btts_yes: number
  }
  most_likely_score: { score: string; home_goals: number; away_goals: number; probability: number }
  alternative_scores: Array<{ score: string; home_goals: number; away_goals: number; probability: number }>
  factors: {
    home_elo: number
    away_elo: number
    elo_difference: number
    home_form_score: number
    away_form_score: number
    home_advantage: number
    h2h_advantage: number
    injury_impact: number
    rest_days_diff: number
    importance_factor: number
  }
  confidence: {
    data_quality: number
    model_certainty: number
    historical_accuracy: number
    overall: number
  }
  /**
   * Optional "why this prediction" per-feature attribution for the served
   * pick (logit units, positive = toward the pick). Only present when the
   * backend was asked to explain — absent for legacy/heuristic responses.
   */
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
  const all = [prediction.most_likely_score, ...prediction.alternative_scores]
  const seen = new Set<string>()
  const cells: ScorelineCell[] = []
  for (const s of all) {
    if (!s || !Number.isFinite(s.probability) || s.probability <= 0) continue
    const key = `${s.home_goals}-${s.away_goals}`
    if (seen.has(key)) continue
    seen.add(key)
    cells.push({ home: s.home_goals, away: s.away_goals, probability: s.probability })
  }
  return cells
}

function XGCompare({ home, away, homeTeam, awayTeam }: { home: number; away: number; homeTeam: string; awayTeam: string }) {
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
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.div
          className="h-full"
          style={{ background: AWAY_TINT }}
          initial={{ width: 0 }}
          animate={{ width: `${awayPct}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
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
  if (cells.length >= 3) {
    return (
      /* Heatmap height ≈ width (square grid + 48px axes); cap the width so
         the reserved box never clips the bottom rows. */
      <ChartContainer height={332} label="Loading scoreline probabilities">
        <div className="mx-auto" style={{ maxWidth: 328 }}>
          {/* No `predicted` override — the heatmap outlines its true peak
              cell, so an unsorted upstream list can't outline an off-mode
              scoreline. */}
          <ScorelineHeatmap cells={cells} maxGoals={4} />
        </div>
      </ChartContainer>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--accent-ai)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-ai)_10%,transparent)] px-3 py-1.5">
        <span className="text-h4 font-bold tabular-nums text-[var(--text-primary)]">
          {mostLikely.score}
        </span>
        <span className="text-caption tabular-nums text-[var(--text-secondary)]">
          {formatPct(mostLikely.probability, 1)}
        </span>
      </span>
      <span className="text-caption text-[var(--text-tertiary)]">Most likely scoreline</span>
    </div>
  )
}

function MarketsStrip({ goals }: { goals: PredictionPayload['goals'] }) {
  const cells: { label: string; value: number }[] = [
    { label: 'Over 1.5', value: goals.over_1_5 },
    { label: 'Over 2.5', value: goals.over_2_5 },
    { label: 'Over 3.5', value: goals.over_3_5 },
    { label: 'BTTS', value: goals.btts_yes },
  ]
  return (
    <div className="grid grid-cols-4 gap-2">
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1.5 text-center"
        >
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{c.label}</div>
          <div className="text-small font-bold tabular-nums text-[var(--text-primary)]">{formatPct(c.value)}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * Key drivers — an honest directional read of the factors the unified model
 * consumed. Each driver maps a published factor onto a signed lean in
 * [-1, 1] (positive = favours the home side) and a magnitude. These are the
 * model's *inputs*, ordered by how strongly each leans; they are deliberately
 * NOT presented as an exact per-factor split of the win probability — the
 * neural model does not expose a SHAP-style decomposition, so claiming
 * "ELO = +8.2% of the home win" would be fabricated. Direction + relative
 * strength is what the data honestly supports.
 */
type Driver = {
  label: string
  lean: number // signed, + favours home
  detail: string
}

function buildDrivers(
  factors: PredictionPayload['factors'],
  homeTeam: string,
  awayTeam: string,
): Driver[] {
  const fmtElo = (n: number) => n.toFixed(0)
  const drivers: Driver[] = [
    {
      label: 'Rating edge',
      lean: Math.tanh(factors.elo_difference / 200),
      detail: `Ratings ${fmtElo(factors.home_elo)} vs ${fmtElo(factors.away_elo)} · edge ${factors.elo_difference >= 0 ? '+' : ''}${fmtElo(factors.elo_difference)}`,
    },
    {
      label: 'Recent form',
      lean: clamp(factors.home_form_score - factors.away_form_score, -1, 1),
      detail: `Last 5: ${homeTeam} ${Math.round(factors.home_form_score * 15)}/15 · ${awayTeam} ${Math.round(factors.away_form_score * 15)}/15 pts`,
    },
    {
      label: 'Head-to-head',
      lean: clamp(factors.h2h_advantage, -1, 1),
      detail:
        Math.abs(factors.h2h_advantage) < 0.05
          ? 'Past meetings split evenly'
          : `Recent meetings favour ${factors.h2h_advantage >= 0 ? homeTeam : awayTeam}`,
    },
    {
      label: 'Home advantage',
      lean: clamp(factors.home_advantage, 0, 1),
      detail: `Venue edge for ${homeTeam}`,
    },
    {
      label: 'Squad availability',
      lean: clamp(factors.injury_impact * 3, -1, 1),
      detail:
        Math.abs(factors.injury_impact) < 0.03
          ? 'Both squads near full strength'
          : `${factors.injury_impact >= 0 ? awayTeam : homeTeam} carrying more absences`,
    },
    {
      label: 'Rest & freshness',
      lean: clamp(factors.rest_days_diff / 4, -1, 1),
      detail:
        factors.rest_days_diff === 0
          ? 'Both sides equally rested'
          : `${Math.abs(factors.rest_days_diff)} day${Math.abs(factors.rest_days_diff) === 1 ? '' : 's'} more rest for ${factors.rest_days_diff > 0 ? homeTeam : awayTeam}`,
    },
  ]
  return drivers.sort((a, b) => Math.abs(b.lean) - Math.abs(a.lean))
}

function strengthLabel(mag: number): string {
  if (mag < 0.1) return 'Even'
  if (mag < 0.32) return 'Slight'
  if (mag < 0.6) return 'Moderate'
  return 'Strong'
}

function KeyDriversPanel({
  factors,
  homeTeam,
  awayTeam,
}: {
  factors: PredictionPayload['factors']
  homeTeam: string
  awayTeam: string
}) {
  const drivers = buildDrivers(factors, homeTeam, awayTeam)
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between px-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-1 text-[var(--accent-loss)]">{awayTeam}</span>
        <span>Favours →</span>
        <span className="inline-flex items-center gap-1 text-[var(--accent-primary)]">{homeTeam}</span>
      </div>
      {drivers.map((d, i) => {
        const mag = Math.abs(d.lean)
        const favoursHome = d.lean >= 0
        const direction =
          mag < 0.1 ? 'Even' : `${strengthLabel(mag)} · ${favoursHome ? homeTeam : awayTeam}`
        return (
          <motion.div
            key={d.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2.5"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">{d.label}</span>
              <span
                className={cn(
                  'text-[11px] font-semibold tabular-nums',
                  mag < 0.1
                    ? 'text-[var(--text-tertiary)]'
                    : favoursHome
                      ? 'text-[var(--accent-primary)]'
                      : 'text-[var(--accent-loss)]',
                )}
              >
                {direction}
              </span>
            </div>
            {/* diverging bar: centre line, fill grows toward the favoured side */}
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--muted-bg)]">
              <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[var(--border-hover)]" />
              <motion.div
                className={cn(
                  'absolute top-0 h-full',
                  favoursHome
                    ? 'left-1/2 rounded-r-full bg-[var(--accent-primary)]'
                    : 'right-1/2 rounded-l-full bg-[var(--accent-loss)]',
                )}
                initial={{ width: 0 }}
                animate={{ width: `${mag * 50}%` }}
                transition={{ duration: 0.55, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">{d.detail}</p>
          </motion.div>
        )
      })}
    </div>
  )
}

/* ---------------- main ---------------- */

export function PredictionResult({ prediction, className }: PredictionResultProps) {
  const totalXg = prediction.goals.total_expected_goals
  const { home_win, draw, away_win } = prediction.outcome
  const predictedOutcome: 'home' | 'draw' | 'away' =
    home_win >= draw && home_win >= away_win ? 'home' : away_win >= draw ? 'away' : 'draw'
  const outcomeRows = buildOutcomeRows(prediction)
  const scorelineCells = buildScorelineCells(prediction)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
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
            <Badge variant="outline" className="border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]">
              {prediction.league}
            </Badge>
            {/* Confidence as a quiet chip — no gauges, no needles. */}
            <ConfidenceChip value={prediction.confidence.overall} />
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
          <Badge variant="outline" className="ml-auto">
            {totalXg.toFixed(2)} total xG
          </Badge>
        </div>
        <XGCompare
          home={prediction.goals.home_expected_goals}
          away={prediction.goals.away_expected_goals}
          homeTeam={prediction.home_team}
          awayTeam={prediction.away_team}
        />
        <MarketsStrip goals={prediction.goals} />
      </div>

      <div className={FLAT_CARD}>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent-primary)]" strokeWidth={2.5} />
          <h3 className="text-h4 font-bold text-[var(--text-primary)]">Most likely scorelines</h3>
        </div>
        <ScorelinePanel cells={scorelineCells} mostLikely={prediction.most_likely_score} />
      </div>

      <div className={FLAT_CARD}>
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--accent-ai)]" strokeWidth={2.5} />
          <h3 className="text-h4 font-bold text-[var(--text-primary)]">Key drivers</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="What are these?"
                className="ml-auto rounded-full p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px]">
              The signals behind this prediction, ordered by how strongly each
              leans. Bars show <em>which side</em> a factor favours and its relative
              strength — not an exact split of the win probability.
            </TooltipContent>
          </Tooltip>
        </div>
        <KeyDriversPanel
          factors={prediction.factors}
          homeTeam={prediction.home_team}
          awayTeam={prediction.away_team}
        />
      </div>

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
