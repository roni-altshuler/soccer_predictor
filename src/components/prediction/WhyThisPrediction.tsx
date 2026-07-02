'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { Lightbulb } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { EASE_OUT } from '@/lib/motion'
import type { AttributionItem } from '@/lib/types/attribution'
import { cn } from '@/lib/utils'

export type { AttributionItem }

/**
 * "Why this prediction" — a diverging bar chart of per-feature attributions
 * for the served pick, straight from the backend's integrated-gradients /
 * embedding-occlusion explanation (`AttributionItem[]`, logit units).
 *
 * Positive contributions pushed the model TOWARD its pick (bars extend right,
 * green); negative pushed against it (bars extend left, red). Renders nothing
 * when no attribution is present — the parent decides what to show instead.
 */

interface WhyThisPredictionProps {
  attribution?: AttributionItem[] | null
  predictedOutcome: 'home' | 'draw' | 'away'
  homeTeam: string
  awayTeam: string
  className?: string
}

const MAX_ROWS = 8

/* ---------------- feature → plain language ---------------- */

/**
 * Grouped categorical attributions (embedding occlusion). Their `value`
 * field is not a meaningful scalar, so we hide it.
 */
const GROUPED_FEATURES = new Set([
  'league_context',
  'home_team_identity',
  'away_team_identity',
  'referee_profile',
  'competition_phase',
])

/** Features whose raw value is a 0/1 flag — show Yes/No instead of a number. */
const BOOLEAN_FEATURES = new Set([
  'is_midweek',
  'is_post_intl_break',
  'is_outdoor_venue',
  'is_neutral_venue',
  'is_knockout',
  'is_2leg_aggregate',
])

/**
 * Translate a model feature name into plain language, substituting the
 * team names for home_/away_ features. Covers every name in the backend's
 * FEATURE_NAMES (feature_builder_v2.py) plus the grouped categorical labels;
 * unknown names fall back to a de-snake-cased label so nothing renders raw.
 */
export function featureLabel(feature: string, homeTeam: string, awayTeam: string): string {
  const explicit: Record<string, string> = {
    // --- ELO + ratings ---
    elo_home: `${homeTeam} Elo rating`,
    elo_away: `${awayTeam} Elo rating`,
    elo_diff: 'Elo gap (magnitude)',
    elo_diff_signed: 'Elo rating gap',
    // --- recent form / rolling stats ---
    home_form_5_pts: `${homeTeam} form (last 5)`,
    away_form_5_pts: `${awayTeam} form (last 5)`,
    home_form_10_pts: `${homeTeam} form (last 10)`,
    away_form_10_pts: `${awayTeam} form (last 10)`,
    home_weighted_form: `${homeTeam} weighted form`,
    away_weighted_form: `${awayTeam} weighted form`,
    home_goals_for_avg5: `${homeTeam} goals scored (last 5)`,
    away_goals_for_avg5: `${awayTeam} goals scored (last 5)`,
    home_goals_against_avg5: `${homeTeam} goals conceded (last 5)`,
    away_goals_against_avg5: `${awayTeam} goals conceded (last 5)`,
    home_goals_for_avg10: `${homeTeam} goals scored (last 10)`,
    away_goals_for_avg10: `${awayTeam} goals scored (last 10)`,
    home_clean_sheet_pct: `${homeTeam} clean-sheet rate`,
    away_clean_sheet_pct: `${awayTeam} clean-sheet rate`,
    home_goal_diff_per_game: `${homeTeam} goal difference per game`,
    away_goal_diff_per_game: `${awayTeam} goal difference per game`,
    // --- venue splits ---
    home_home_win_pct: `${homeTeam} home win rate`,
    away_away_win_pct: `${awayTeam} away win rate`,
    home_home_goals_avg: `${homeTeam} goals at home`,
    away_away_goals_avg: `${awayTeam} goals on the road`,
    // --- head-to-head ---
    h2h_matches: 'Head-to-head meetings',
    h2h_home_advantage: 'Head-to-head record',
    h2h_avg_total_goals: 'Head-to-head goals per game',
    h2h_home_xg_advantage: 'Head-to-head xG edge',
    away_road_vs_opp_ppg: `${awayTeam} away points vs ${homeTeam}`,
    // --- season position & momentum ---
    season_progress: 'Season progress',
    home_matchday_norm: `${homeTeam} matchday progress`,
    away_matchday_norm: `${awayTeam} matchday progress`,
    home_streak: `${homeTeam} current streak`,
    away_streak: `${awayTeam} current streak`,
    home_unbeaten_run: `${homeTeam} unbeaten run`,
    away_unbeaten_run: `${awayTeam} unbeaten run`,
    home_minus_away_points: 'League points gap',
    // --- tactical rolling ---
    home_shots_ratio: `${homeTeam} shot share`,
    away_shots_ratio: `${awayTeam} shot share`,
    home_sot_ratio: `${homeTeam} shots-on-target share`,
    away_sot_ratio: `${awayTeam} shots-on-target share`,
    home_discipline_score: `${homeTeam} discipline`,
    away_discipline_score: `${awayTeam} discipline`,
    home_corner_dominance: `${homeTeam} corner dominance`,
    away_corner_dominance: `${awayTeam} corner dominance`,
    // --- market-implied ---
    implied_home_prob: 'Market odds: home win',
    implied_draw_prob: 'Market odds: draw',
    implied_away_prob: 'Market odds: away win',
    implied_over_2_5: 'Market odds: over 2.5 goals',
    market_overround: 'Bookmaker margin',
    // --- calendar / burnout ---
    home_days_rest: `${homeTeam} rest days`,
    away_days_rest: `${awayTeam} rest days`,
    rest_diff: 'Rest-day gap',
    home_matches_last_14d: `${homeTeam} fixtures in last 14 days`,
    away_matches_last_14d: `${awayTeam} fixtures in last 14 days`,
    is_midweek: 'Midweek fixture',
    is_post_intl_break: 'After international break',
    season_stage: 'Season stage',
    // --- weather ---
    weather_temp_c: 'Temperature',
    weather_precip_mm: 'Rainfall',
    weather_wind_kmh: 'Wind speed',
    weather_humidity: 'Humidity',
    is_outdoor_venue: 'Outdoor venue',
    // --- referee tendencies ---
    referee_avg_cards: 'Referee cards per game',
    referee_home_win_rate: 'Referee home-win rate',
    referee_draw_rate: 'Referee draw rate',
    // --- player availability ---
    home_squad_form: `${homeTeam} squad form`,
    away_squad_form: `${awayTeam} squad form`,
    home_missing_top3: `${homeTeam} missing key players`,
    away_missing_top3: `${awayTeam} missing key players`,
    // --- travel / venue ---
    away_travel_km: `${awayTeam} travel distance`,
    venue_altitude_m: 'Venue altitude',
    is_neutral_venue: 'Neutral venue',
    // --- motivation / cup context ---
    is_knockout: 'Knockout tie',
    is_2leg_aggregate: 'Two-legged tie',
    home_motivation: `${homeTeam} motivation`,
    away_motivation: `${awayTeam} motivation`,
    // --- interactions ---
    elo_x_form_diff: 'Rating × form interaction',
    elo_x_h2h: 'Rating × head-to-head interaction',
    implied_home_x_form: 'Market × form interaction',
    // --- grouped categorical (embedding occlusion) ---
    league_context: 'League context',
    home_team_identity: `${homeTeam} team profile`,
    away_team_identity: `${awayTeam} team profile`,
    referee_profile: 'Referee profile',
    competition_phase: 'Competition phase',
  }

  const mapped = explicit[feature]
  if (mapped) return mapped

  // Generic fallback: prefix the team name for home_/away_ features, strip
  // an is_ prefix, then de-snake-case the remainder.
  const humanize = (s: string) => {
    const words = s.replace(/^is_/, '').split('_').filter(Boolean).join(' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  if (feature.startsWith('home_')) return `${homeTeam} ${humanize(feature.slice(5)).toLowerCase()}`
  if (feature.startsWith('away_')) return `${awayTeam} ${humanize(feature.slice(5)).toLowerCase()}`
  return humanize(feature)
}

/** Format the raw feature value for display — or null when not meaningful. */
export function featureValueText(item: AttributionItem): string | null {
  if (GROUPED_FEATURES.has(item.feature)) return null
  if (!Number.isFinite(item.value)) return null
  if (BOOLEAN_FEATURES.has(item.feature)) return item.value >= 0.5 ? 'yes' : 'no'
  const v = item.value
  const abs = Math.abs(v)
  if (abs >= 100) return v.toFixed(0)
  if (abs >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

/* ---------------- component ---------------- */

export function WhyThisPrediction({
  attribution,
  predictedOutcome,
  homeTeam,
  awayTeam,
  className,
}: WhyThisPredictionProps) {
  const reduceMotion = useReducedMotion()

  if (!attribution || attribution.length === 0) return null

  const items = [...attribution]
    .filter((a) => Number.isFinite(a.contribution))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, MAX_ROWS)
  if (items.length === 0) return null

  const maxAbs = Math.max(...items.map((a) => Math.abs(a.contribution)), 1e-9)
  const pickLabel =
    predictedOutcome === 'home'
      ? `${homeTeam} win`
      : predictedOutcome === 'away'
        ? `${awayTeam} win`
        : 'a draw'

  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <div className="mb-1 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-[var(--accent-ai)]" strokeWidth={2.5} />
        <h3 className="text-h4 font-bold text-[var(--text-primary)]">Why this prediction</h3>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
        The signals that moved the model&apos;s pick —{' '}
        <span className="font-semibold text-[var(--text-primary)]">{pickLabel}</span>. Bars to the
        right pushed <span className="text-[var(--accent-primary)]">toward</span> the pick, bars to
        the left pushed <span className="text-[var(--accent-loss)]">against</span> it. Values are
        model logit contributions, not percentages.
      </p>

      <div
        aria-hidden="true"
        className="mb-2 flex items-center justify-between px-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]"
      >
        <span className="text-[var(--accent-loss)]">← against pick</span>
        <span className="text-[var(--accent-primary)]">toward pick →</span>
      </div>

      <motion.ul
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
        className="m-0 flex list-none flex-col gap-2.5 p-0"
      >
        {items.map((item, i) => {
          const positive = item.contribution >= 0
          const frac = Math.abs(item.contribution) / maxAbs
          const label = featureLabel(item.feature, homeTeam, awayTeam)
          const valueText = featureValueText(item)
          const signed = `${positive ? '+' : '−'}${Math.abs(item.contribution).toFixed(2)}`
          const aria = `${label}${valueText ? ` (value ${valueText})` : ''}: pushed ${
            positive ? 'toward' : 'against'
          } ${pickLabel}, contribution ${signed}`
          return (
            <li key={item.feature} aria-label={aria}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[12px] font-medium text-[var(--text-primary)]">
                  {label}
                  {valueText !== null && (
                    <span className="ml-1.5 text-[10px] tabular-nums text-[var(--text-tertiary)]">
                      {valueText}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-[11px] font-semibold tabular-nums',
                    positive ? 'text-[var(--accent-primary)]' : 'text-[var(--accent-loss)]'
                  )}
                >
                  {signed}
                </span>
              </div>
              {/* diverging bar: centre axis, fill grows toward the side the signal pushed */}
              <div
                aria-hidden="true"
                className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--muted-bg)]"
              >
                <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[var(--border-hover)]" />
                <motion.div
                  className={cn(
                    'absolute top-0 h-full',
                    positive
                      ? 'left-1/2 rounded-r-full bg-[var(--accent-primary)]'
                      : 'right-1/2 rounded-l-full bg-[var(--accent-loss)]'
                  )}
                  initial={reduceMotion ? false : { width: 0 }}
                  animate={{ width: `${frac * 50}%` }}
                  transition={{ duration: 0.55, delay: reduceMotion ? 0 : i * 0.05, ease: EASE_OUT }}
                />
              </div>
            </li>
          )
        })}
      </motion.ul>
    </Card>
  )
}
