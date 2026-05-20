'use client'

import { motion } from 'framer-motion'
import { Activity, Brain, Trophy, Goal, ShieldAlert, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn, clamp, formatPct } from '@/lib/utils'

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
  model_version?: string
}

interface PredictionResultProps {
  prediction: PredictionPayload
  className?: string
}

/* ---------------- helpers ---------------- */

function OutcomeBars({ outcome, homeTeam, awayTeam }: { outcome: PredictionPayload['outcome']; homeTeam: string; awayTeam: string }) {
  const items: { label: string; pct: number; tone: 'home' | 'draw' | 'away' }[] = [
    { label: `${homeTeam} win`, pct: clamp(outcome.home_win), tone: 'home' },
    { label: 'Draw', pct: clamp(outcome.draw), tone: 'draw' },
    { label: `${awayTeam} win`, pct: clamp(outcome.away_win), tone: 'away' },
  ]
  const toneStyles: Record<string, { bg: string; track: string; text: string }> = {
    home: { bg: 'bg-[var(--accent-primary)]', track: 'bg-[var(--accent-primary)]/15', text: 'text-[var(--accent-primary)]' },
    draw: { bg: 'bg-[var(--accent-warn)]', track: 'bg-[var(--accent-warn)]/15', text: 'text-[var(--accent-warn)]' },
    away: { bg: 'bg-[var(--accent-loss)]', track: 'bg-[var(--accent-loss)]/15', text: 'text-[var(--accent-loss)]' },
  }
  return (
    <div className="space-y-3">
      {items.map((it) => {
        const styles = toneStyles[it.tone]
        return (
          <div key={it.label}>
            <div className="mb-1 flex items-center justify-between">
              <span className="truncate text-small font-medium text-[var(--text-primary)]">{it.label}</span>
              <span className={cn('text-small font-bold tabular-nums', styles.text)}>{formatPct(it.pct)}</span>
            </div>
            <div className={cn('h-2.5 w-full overflow-hidden rounded-full', styles.track)}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${it.pct * 100}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className={cn('h-full rounded-full', styles.bg)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ConfidenceGauge({ value, label }: { value: number; label?: string }) {
  const pct = clamp(value)
  const size = 96
  const stroke = 8
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - pct)
  const colour =
    pct >= 0.7
      ? 'var(--accent-primary)'
      : pct >= 0.4
      ? 'var(--accent-ai)'
      : 'var(--accent-warn)'

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="var(--surface-muted)"
            strokeOpacity={0.25}
            strokeWidth={stroke}
            fill="none"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colour}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            style={{ strokeDasharray: circumference }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-h3 font-black text-[var(--text-primary)] tabular-nums">
            {Math.round(pct * 100)}%
          </span>
          {label && (
            <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {label}
            </span>
          )}
        </div>
      </div>
    </div>
  )
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
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]/30">
        <motion.div
          className="h-full bg-[var(--accent-primary)]"
          initial={{ width: 0 }}
          animate={{ width: `${homePct}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.div
          className="h-full bg-[var(--accent-loss)]"
          initial={{ width: 0 }}
          animate={{ width: `${awayPct}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--text-tertiary)]">
        <span className="truncate pr-2">{homeTeam}</span>
        <span className="truncate pl-2 text-right">{awayTeam}</span>
      </div>
    </div>
  )
}

function ScorelineGrid({
  mostLikely,
  alternatives,
}: {
  mostLikely: PredictionPayload['most_likely_score']
  alternatives: PredictionPayload['alternative_scores']
}) {
  const all = [mostLikely, ...alternatives].slice(0, 5)
  const max = Math.max(...all.map((s) => s.probability), 1e-3)
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {all.map((s, idx) => {
        const isTop = idx === 0
        return (
          <motion.div
            key={`${s.score}-${idx}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * idx, duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'rounded-lg border px-3 py-2 text-center',
              isTop
                ? 'border-[var(--accent-primary)]/60 bg-[var(--accent-primary)]/10'
                : 'border-[var(--border-color)] bg-[var(--card-bg)]'
            )}
          >
            <div className="mb-1 flex items-center justify-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {isTop && <Trophy className="h-3 w-3 text-[var(--accent-primary)]" strokeWidth={2.5} />}
              {isTop ? 'Most likely' : `Alt #${idx}`}
            </div>
            <div
              className={cn(
                'text-h3 font-black tabular-nums',
                isTop ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'
              )}
            >
              {s.score}
            </div>
            <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">{formatPct(s.probability, 1)}</div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--surface-muted)]/20">
              <motion.div
                className={cn('h-full', isTop ? 'bg-[var(--accent-primary)]' : 'bg-[var(--accent-ai)]')}
                initial={{ width: 0 }}
                animate={{ width: `${(s.probability / max) * 100}%` }}
                transition={{ duration: 0.5, delay: 0.1 + 0.05 * idx, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </motion.div>
        )
      })}
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

function FactorsPanel({ factors }: { factors: PredictionPayload['factors'] }) {
  const items: { label: string; value: number; hint: string; tone: 'primary' | 'ai' | 'warn' | 'loss' }[] = [
    {
      label: 'ELO advantage',
      value: clamp((factors.elo_difference + 200) / 400),
      hint: `${factors.home_elo.toFixed(0)} vs ${factors.away_elo.toFixed(0)} (Δ ${factors.elo_difference >= 0 ? '+' : ''}${factors.elo_difference.toFixed(0)})`,
      tone: factors.elo_difference >= 0 ? 'primary' : 'loss',
    },
    {
      label: 'Form (home)',
      value: clamp(factors.home_form_score),
      hint: 'Weighted last-5 result share for the home side',
      tone: 'primary',
    },
    {
      label: 'Form (away)',
      value: clamp(factors.away_form_score),
      hint: 'Weighted last-5 result share for the away side',
      tone: 'loss',
    },
    {
      label: 'H2H lean',
      value: clamp((factors.h2h_advantage + 1) / 2),
      hint: 'Historical head-to-head advantage (positive = home)',
      tone: factors.h2h_advantage >= 0 ? 'primary' : 'loss',
    },
    {
      label: 'Squad availability',
      value: clamp(1 - Math.abs(factors.injury_impact)),
      hint: factors.injury_impact >= 0 ? 'Away squad more affected' : 'Home squad more affected',
      tone: 'warn',
    },
    {
      label: 'Rest advantage',
      value: clamp((factors.rest_days_diff + 7) / 14),
      hint: `${factors.rest_days_diff >= 0 ? '+' : ''}${factors.rest_days_diff} days more rest for home`,
      tone: 'ai',
    },
  ]
  const toneClass: Record<string, string> = {
    primary: 'bg-[var(--accent-primary)]',
    ai: 'bg-[var(--accent-ai)]',
    warn: 'bg-[var(--accent-warn)]',
    loss: 'bg-[var(--accent-loss)]',
  }
  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((item) => (
          <Tooltip key={item.label}>
            <TooltipTrigger asChild>
              <div className="cursor-help rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{item.label}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]/20">
                  <motion.div
                    className={cn('h-full rounded-full', toneClass[item.tone])}
                    initial={{ width: 0 }}
                    animate={{ width: `${item.value * 100}%` }}
                    transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>{item.hint}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}

/* ---------------- main ---------------- */

export function PredictionResult({ prediction, className }: PredictionResultProps) {
  const totalXg = prediction.goals.total_expected_goals
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex flex-col gap-4', className)}
    >
      <Card className="p-4 md:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-[var(--accent-ai)]" strokeWidth={2.5} />
            <h2 className="text-h4 font-bold text-[var(--text-primary)]">Outcome probabilities</h2>
          </div>
          <Badge variant="outline" className="border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/10 text-[var(--accent-ai)]">
            {prediction.league}
          </Badge>
        </div>
        <OutcomeBars
          outcome={prediction.outcome}
          homeTeam={prediction.home_team}
          awayTeam={prediction.away_team}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="flex flex-col items-center justify-center gap-2 p-4 md:p-5">
          <ConfidenceGauge value={prediction.confidence.overall} label="Confidence" />
        </Card>
        <Card className="col-span-1 flex flex-col justify-between gap-3 p-4 md:col-span-2 md:p-5">
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
        </Card>
      </div>

      <Card className="p-4 md:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent-primary)]" strokeWidth={2.5} />
          <h3 className="text-h4 font-bold text-[var(--text-primary)]">Most likely scorelines</h3>
        </div>
        <ScorelineGrid
          mostLikely={prediction.most_likely_score}
          alternatives={prediction.alternative_scores}
        />
      </Card>

      <Card className="p-4 md:p-5">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--accent-ai)]" strokeWidth={2.5} />
          <h3 className="text-h4 font-bold text-[var(--text-primary)]">Key factors</h3>
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
            <TooltipContent>
              Inputs the unified model relied on most. Hover any tile for the raw value.
            </TooltipContent>
          </Tooltip>
        </div>
        <FactorsPanel factors={prediction.factors} />
      </Card>

      <Separator className="opacity-50" />
      <p className="text-center text-[10px] text-[var(--text-tertiary)]">
        {prediction.model_version
          ? `Model ${prediction.model_version} · `
          : ''}
        Predictions are for educational/entertainment purposes only. Not intended for betting.
      </p>
    </motion.div>
  )
}
