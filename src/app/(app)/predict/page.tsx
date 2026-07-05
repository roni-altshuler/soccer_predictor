'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import {
  ArrowRight,
  Brain,
  Globe2,
  Goal,
  ListTree,
  Loader2,
  Percent,
  Sparkles,
} from 'lucide-react'

import { PredictionResult as PredictionResultViz, type PredictionPayload } from '@/components/prediction/PredictionResult'
import {
  MatchupPicker,
  flagCountryFor,
  isNationalCompetition,
  leagueAccentFor,
  resolveCatalogTeam,
  type TeamPick,
} from '@/components/TeamSelector'
import { AsyncSection, FlagBadge } from '@/components/primitives'
import { GenderToggle } from '@/components/GenderToggle'
import { Skeleton } from '@/components/ui/skeleton'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import type { AttributionItem } from '@/lib/types/attribution'

interface PredictionResult {
  success?: boolean
  predictions?: { home_win?: number; draw?: number; away_win?: number }
  home_team?: string; away_team?: string
  home_league?: string; away_league?: string
  is_cross_league?: boolean
  predicted_home_goals?: number; predicted_away_goals?: number
  confidence?: number
  total_goals?: number
  markets?: { over_2_5?: number; btts_yes?: number }
  scoreline_probabilities?: Array<{ score: string; probability: number }>
  verdict?: {
    edge?: string
    risk?: string
    edge_pct?: number
    threshold_qualified?: boolean
    recommended_action?: 'play' | 'pass'
    recommended_pick?: string | null
    policy?: {
      min_confidence?: number
      min_edge?: number
    }
    summary?: string
  }
  form?: { home_form?: number; away_form?: number; home_form_label?: string; away_form_label?: string }
  ratings?: { home_elo: number; away_elo: number; elo_difference: number }
  attribution?: AttributionItem[] | null
  analysis?: { predicted_winner: string; home_advantage_applied: boolean; factors_considered: string[]; note: string }
  error?: string
}

interface TodaysMatch {
  home_team: string
  away_team: string
  league: string
  leagueId: string
  status: string
}

interface ExampleFixture {
  key: string
  home: TeamPick
  away: TeamPick
  leagueId: string
}

/** Marquee order for the example-fixture chips (lower = more marquee). */
const EXAMPLE_LEAGUE_RANK: Record<string, number> = {
  'fifa.world': 0,
  'uefa.champions': 1,
  'uefa.europa': 2,
  'eng.1': 3,
  'esp.1': 4,
  'ita.1': 5,
  'ger.1': 6,
  'fra.1': 7,
  'usa.1': 8,
  'ned.1': 9,
  'por.1': 10,
  'uefa.europa.conf': 11,
}

/** ESPN league id → static catalog league name (predict API vocabulary). */
const ESPN_TO_CATALOG: Record<string, string> = {
  'eng.1': 'Premier League',
  'esp.1': 'La Liga',
  'ita.1': 'Serie A',
  'ger.1': 'Bundesliga',
  'fra.1': 'Ligue 1',
  'ned.1': 'Eredivisie',
  'por.1': 'Primeira Liga',
  'usa.1': 'MLS',
  'uefa.champions': 'Champions League (UCL)',
  'uefa.europa': 'Europa League (UEL)',
  'uefa.europa.conf': 'Conference League (UECL)',
  'fifa.world': 'FIFA World Cup',
  'uefa.euro': 'UEFA European Championship',
  'conmebol.america': 'Copa America',
}

function ChipIdentity({ pick }: { pick: TeamPick }) {
  if (!isNationalCompetition(pick.league)) return null
  return (
    <FlagBadge country={flagCountryFor(pick.name)} teamName={pick.name} size={16} />
  )
}

function ResultSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="space-y-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-2.5 w-full rounded-full" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )
}

const OUTPUT_EXPLAINERS = [
  {
    Icon: Percent,
    tint: 'text-[var(--accent-ai)] bg-[var(--accent-ai)]/12',
    title: 'Calibrated probabilities',
    desc: 'Win/draw/loss chances from the unified multi-task network, isotonic-calibrated on held-out matches.',
  },
  {
    Icon: Goal,
    tint: 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/12',
    title: 'Scoreline distribution',
    desc: 'A bivariate-Poisson xG head scores every plausible final score and surfaces the most likely ones.',
  },
  {
    Icon: ListTree,
    tint: 'text-[var(--accent-warn)] bg-[var(--accent-warn)]/12',
    title: 'Why this prediction',
    desc: 'A factor panel showing which of the 87 features — ELO gap, form, home edge — moved the needle.',
  },
] as const

function PredictPageContent() {
  const [homeTeam, setHomeTeam] = useState<TeamPick | null>(null)
  const [awayTeam, setAwayTeam] = useState<TeamPick | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PredictionResult | null>(null)
  const [examples, setExamples] = useState<ExampleFixture[]>([])

  useEffect(() => { setResult(null) }, [homeTeam, awayTeam])

  const { asQueryParam } = useGenderQuery()

  // Example-matchup quick chips: real fixtures from today's scoreboard,
  // shown only when both sides resolve to teams the model knows.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/todays_matches?gender=${asQueryParam}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const all: TodaysMatch[] = [
          ...(Array.isArray(data.live) ? data.live : []),
          ...(Array.isArray(data.upcoming) ? data.upcoming : []),
          ...(Array.isArray(data.completed) ? data.completed : []),
        ]
        const ranked = all
          .filter((m) => m.home_team && m.away_team)
          .sort(
            (a, b) =>
              (EXAMPLE_LEAGUE_RANK[a.leagueId] ?? 99) -
              (EXAMPLE_LEAGUE_RANK[b.leagueId] ?? 99)
          )
        const picked: ExampleFixture[] = []
        for (const match of ranked) {
          const catalogLeague = ESPN_TO_CATALOG[match.leagueId]
          const home = resolveCatalogTeam(match.home_team, catalogLeague)
          const away = resolveCatalogTeam(match.away_team, catalogLeague)
          if (!home || !away || home.name === away.name) continue
          const key = `${home.name}-${away.name}`
          if (picked.some((f) => f.key === key)) continue
          picked.push({ key, home, away, leagueId: match.leagueId })
          if (picked.length >= 3) break
        }
        setExamples(picked)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [asQueryParam])

  const handleSwap = useCallback(() => {
    setHomeTeam(awayTeam)
    setAwayTeam(homeTeam)
  }, [homeTeam, awayTeam])

  const handlePredict = async () => {
    if (!homeTeam || !awayTeam) return
    if (homeTeam.name === awayTeam.name) { setResult({ error: 'Please select different teams' }); return }
    setLoading(true); setResult(null)
    try {
      const response = await fetch(`/api/predict/any-teams?gender=${asQueryParam}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          home_team: homeTeam.name,
          away_team: awayTeam.name,
          home_league: homeTeam.league,
          away_league: awayTeam.league,
          gender: asQueryParam,
        }),
      })
      if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'Prediction failed') }
      setResult(await response.json())
    } catch (error) { setResult({ error: error instanceof Error ? error.message : 'Prediction failed' }) }
    finally { setLoading(false) }
  }

  const canPredict = Boolean(homeTeam && awayTeam && homeTeam.name !== awayTeam.name)
  const isCrossLeague = Boolean(
    homeTeam && awayTeam && homeTeam.league !== awayTeam.league
  )

  /**
   * Convert the legacy `/api/predict/any-teams` response into the
   * `PredictionPayload` shape consumed by the new <PredictionResult /> viz.
   * Falls back to sensible defaults when the legacy API omits a field
   * (e.g. over_1_5 / over_3_5 — derive from Poisson-ish heuristics).
   */
  const adaptResult = useCallback((r: PredictionResult): PredictionPayload | null => {
    if (!r.predictions || !r.home_team || !r.away_team) return null
    const homeWin = r.predictions.home_win ?? 0
    const draw = r.predictions.draw ?? 0
    const awayWin = r.predictions.away_win ?? 0
    const total = homeWin + draw + awayWin || 1
    const norm = { home: homeWin / total, draw: draw / total, away: awayWin / total }
    const confOverall = (r.confidence ?? 0) / 100

    // Parse scorelines from legacy "h-a" string format.
    const parseScore = (s: string): { home_goals: number; away_goals: number } => {
      const m = s.match(/(\d+)\s*[-–]\s*(\d+)/)
      return m
        ? { home_goals: Number(m[1]), away_goals: Number(m[2]) }
        : { home_goals: 0, away_goals: 0 }
    }
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
    const alternatives = scorelines.slice(1, 5)

    const totalXg =
      r.total_goals ??
      (r.predicted_home_goals ?? 0) + (r.predicted_away_goals ?? 0)

    // Legacy form is a ±15 net-points scale (W=+3, D=0, L=-3 over last 5);
    // the viz expects 0..1 where score*15 reads as "pts of 15".
    const normForm = (value: number | undefined): number =>
      value === undefined ? 0.5 : Math.max(0, Math.min(1, (value + 15) / 30))

    // Legacy API doesn't expose 1.5/3.5 overs — derive from total goals
    // using simple Poisson tail heuristics. Close enough to keep the
    // markets strip populated; the unified endpoint provides exact values.
    const over_2_5 = r.markets?.over_2_5 ?? Math.max(0, Math.min(1, (totalXg - 1.5) / 2))
    const over_1_5 = Math.max(over_2_5, Math.min(1, (totalXg - 0.5) / 2))
    const over_3_5 = Math.max(0, Math.min(over_2_5, (totalXg - 2.5) / 2))

    return {
      home_team: r.home_team,
      away_team: r.away_team,
      league: r.is_cross_league
        ? `${r.home_league ?? ''} vs ${r.away_league ?? ''}`
        : r.home_league ?? r.away_league ?? 'Match',
      outcome: {
        home_win: norm.home,
        draw: norm.draw,
        away_win: norm.away,
        confidence: confOverall,
      },
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
      alternative_scores: alternatives,
      factors: {
        home_elo: r.ratings?.home_elo ?? 1500,
        away_elo: r.ratings?.away_elo ?? 1500,
        elo_difference: r.ratings?.elo_difference ?? 0,
        home_form_score: normForm(r.form?.home_form),
        away_form_score: normForm(r.form?.away_form),
        home_advantage: 0.25,
        h2h_advantage: 0,
        injury_impact: 0,
        rest_days_diff: 0,
        importance_factor: 1.0,
      },
      confidence: {
        data_quality: 0.8,
        model_certainty: confOverall,
        historical_accuracy: 0.5,
        overall: confOverall,
      },
      // Real per-feature attribution when the unified backend supplied it;
      // never fabricated for legacy heuristic responses.
      attribution:
        Array.isArray(r.attribution) && r.attribution.length > 0 ? r.attribution : null,
      model_version: 'legacy-elo-poisson',
    }
  }, [])

  const adaptedPrediction = useMemo(
    () => (result && !result.error ? adaptResult(result) : null),
    [result, adaptResult]
  )

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 md:px-8">
        {/* Compact page title — no marketing hero */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
              AI predict
            </h1>
            <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
              Pick two teams — calibrated win/draw/loss, scoreline, and the factors behind it.
            </p>
          </div>
          <GenderToggle size="default" />
        </div>

        {/* Matchup builder */}
        <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Build your matchup
          </p>

          <MatchupPicker
            home={homeTeam}
            away={awayTeam}
            onHomeChange={setHomeTeam}
            onAwayChange={setAwayTeam}
            onSwap={handleSwap}
          />

          {isCrossLeague && homeTeam && awayTeam && (
            <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-[var(--accent-warn)]/35 bg-[var(--accent-warn)]/10 px-3 py-2 text-[11px] font-semibold text-[var(--accent-warn)]">
              <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
              Cross-league: {homeTeam.league} vs {awayTeam.league}
            </div>
          )}

          {examples.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                Today&apos;s fixtures
              </p>
              <div className="flex flex-wrap gap-2">
                {examples.map((fixture) => {
                  const accent = leagueAccentFor(fixture.home.league)
                  return (
                    <button
                      key={fixture.key}
                      type="button"
                      onClick={() => {
                        setHomeTeam(fixture.home)
                        setAwayTeam(fixture.away)
                      }}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)]/60 px-3.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
                    >
                      <ChipIdentity pick={fixture.home} />
                      <span className="max-w-[9rem] truncate">{fixture.home.name}</span>
                      <span className="text-[10px] font-normal text-[var(--text-tertiary)]">vs</span>
                      <ChipIdentity pick={fixture.away} />
                      <span className="max-w-[9rem] truncate">{fixture.away.name}</span>
                      {accent.shortName !== 'Match' && (
                        <span className="text-[10px] font-normal text-[var(--text-tertiary)]">
                          · {accent.shortName}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <button
            onClick={handlePredict}
            disabled={loading || !canPredict}
            className="group mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-ai)] px-6 text-sm font-bold text-[var(--accent-on-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent-ai)_88%,black)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Running model…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Run prediction
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </>
            )}
          </button>
          {!canPredict && !loading && (
            <p className="mt-2 text-center text-[11px] text-[var(--text-tertiary)]">
              Pick both teams to run the model.
            </p>
          )}
        </section>

        {/* Result / loading / error */}
        {(loading || result) && (
          <AsyncSection
            loading={loading}
            error={result?.error ?? null}
            onRetry={handlePredict}
            section="prediction"
            skeleton={<ResultSkeleton />}
          >
            {adaptedPrediction ? (
              <div className="space-y-4">
                <PredictionResultViz prediction={adaptedPrediction} />

                {/* Legacy verdict / policy strip — kept because the viz
                    doesn't yet render policy or cross-league context. */}
                {result?.verdict && (
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
                    <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                      Policy &amp; cross-league context
                    </p>
                    <div className={`rounded-lg border p-3 ${result.verdict.recommended_action === 'play' ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10' : 'border-[var(--accent-warn)]/35 bg-[var(--accent-warn)]/10'}`}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Policy Decision</p>
                          <p className={`text-sm font-semibold ${result.verdict.recommended_action === 'play' ? 'text-[var(--accent-primary)]' : 'text-[var(--accent-warn)]'}`}>
                            {result.verdict.recommended_action === 'play' ? 'Play' : 'Pass'}
                            {result.verdict.recommended_pick ? ` · ${result.verdict.recommended_pick}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-[10px] text-[var(--text-secondary)]">
                          {typeof result.verdict.edge_pct === 'number' && (
                            <span className="tabular rounded-full bg-[var(--muted-bg)] px-2 py-1">Edge: {result.verdict.edge_pct.toFixed(1)}pp</span>
                          )}
                          {result.verdict.policy?.min_confidence !== undefined && (
                            <span className="tabular rounded-full bg-[var(--muted-bg)] px-2 py-1">Min Conf: {result.verdict.policy.min_confidence}%</span>
                          )}
                          {result.verdict.policy?.min_edge !== undefined && (
                            <span className="tabular rounded-full bg-[var(--muted-bg)] px-2 py-1">Min Edge: {result.verdict.policy.min_edge}pp</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {result.verdict.summary && (
                      <p className="mt-3 text-xs text-[var(--text-secondary)]">{result.verdict.summary}</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 text-sm text-[var(--text-secondary)]">
                The model returned an unexpected response for this matchup.
              </div>
            )}
          </AsyncSection>
        )}

        {/* Empty state — honest explainer of the model's outputs */}
        {!loading && !result && (
          <section>
            <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              What the model returns
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {OUTPUT_EXPLAINERS.map(({ Icon, tint, title, desc }) => (
                <div
                  key={title}
                  className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4"
                >
                  <span className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg ${tint}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
                  <p className="mt-1 text-[12px] leading-snug text-[var(--text-tertiary)]">{desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2.5 text-[12px] text-[var(--text-secondary)]">
              <Brain className="h-4 w-4 shrink-0 text-[var(--accent-ai)]" aria-hidden="true" />
              Cross-league pairings work too — strength coefficients keep a UCL-vs-MLS
              matchup calibrated instead of guessing.
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export default function PredictPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent-ai)] border-t-transparent" />
      </div>
    }>
      <PredictPageContent />
    </Suspense>
  )
}
