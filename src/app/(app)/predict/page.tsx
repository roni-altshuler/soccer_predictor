'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import {
  ArrowRight,
  Brain,
  Globe2,
  Goal,
  Home,
  Loader2,
  Plane,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react'

import { PredictionResult as PredictionResultViz, type PredictionPayload } from '@/components/prediction/PredictionResult'
import { PredictHero } from '@/components/prediction/PredictHero'
import { useGenderQuery } from '@/hooks/useGenderQuery'

interface TeamSearchResult { name: string; league: string }

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
  analysis?: { predicted_winner: string; home_advantage_applied: boolean; factors_considered: string[]; note: string }
  error?: string
}

interface LeagueOverview {
  total_matches: number
  avg_goals_per_match: number
  avg_home_goals: number
  avg_away_goals: number
  home_win_rate: number
  draw_rate: number
  away_win_rate: number
}

interface SeasonTrendEntry {
  season: string
  avg_goals: number
  home_wins: number
  draws: number
  away_wins: number
  total_matches: number
}

interface LeagueInsight {
  overview: LeagueOverview | null
  latestTrend: SeasonTrendEntry | null
  previousTrend: SeasonTrendEntry | null
}

function TeamSearchInput({
  label, value, onSelect, placeholder, Icon
}: {
  label: string; value: { name: string; league: string } | null
  onSelect: (team: { name: string; league: string } | null) => void
  placeholder: string; Icon: typeof Goal
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TeamSearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const searchTeams = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/search-teams?q=${encodeURIComponent(q)}`)
      if (res.ok) { const data = await res.json(); setResults(data.teams || []) }
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { if (query && !value) searchTeams(query) }, 300)
    return () => clearTimeout(timer)
  }, [query, value, searchTeams])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) && !inputRef.current?.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">{label}</label>
      {value ? (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)] shadow-sm">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-ai)]/12 text-[var(--accent-ai)]">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{value.name}</p>
            <p className="text-[10px] text-[var(--text-tertiary)]">{value.league}</p>
          </div>
          <button onClick={() => { onSelect(null); setQuery(''); setResults([]) }} className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--text-tertiary)]" aria-label={`Clear ${label}`}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
          <input
            ref={inputRef} type="text" value={query}
            onChange={(e) => { setQuery(e.target.value); setIsOpen(true) }}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ai)]/30 focus:border-[var(--accent-ai)]/70 transition-shadow shadow-sm"
          />
          {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-[var(--accent-ai)]" aria-hidden="true" />}
        </div>
      )}
      {isOpen && results.length > 0 && !value && (
        <div ref={dropdownRef} className="absolute z-50 w-full mt-1.5 max-h-56 overflow-y-auto rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)] shadow-2xl">
          {results.map((team, idx) => (
            <button key={`${team.name}-${idx}`} onClick={() => { onSelect(team); setQuery(''); setResults([]); setIsOpen(false) }}
              className="w-full px-3 py-2 flex items-center gap-2 hover:bg-[var(--card-hover)] text-left text-sm">
              <Goal className="h-3 w-3 text-[var(--text-tertiary)] shrink-0" aria-hidden="true" />
              <div className="min-w-0"><p className="text-[var(--text-primary)] font-medium truncate">{team.name}</p><p className="text-[10px] text-[var(--text-tertiary)] truncate">{team.league}</p></div>
            </button>
          ))}
        </div>
      )}
      {isOpen && query.length >= 2 && results.length === 0 && !loading && !value && (
        <div className="absolute z-50 w-full mt-1 p-3 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] text-center text-xs text-[var(--text-tertiary)]">
          No teams found
        </div>
      )}
    </div>
  )
}

function PredictPageContent() {
  const [homeTeam, setHomeTeam] = useState<{ name: string; league: string } | null>(null)
  const [awayTeam, setAwayTeam] = useState<{ name: string; league: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PredictionResult | null>(null)
  const [leagueInsights, setLeagueInsights] = useState<Record<string, LeagueInsight | null>>({})
  const [loadingLeagueInsights, setLoadingLeagueInsights] = useState(false)

  useEffect(() => { setResult(null) }, [homeTeam, awayTeam])

  const selectedLeagues = useMemo(() => {
    const leagues = [homeTeam?.league, awayTeam?.league].filter((league): league is string => Boolean(league))
    return Array.from(new Set(leagues))
  }, [homeTeam?.league, awayTeam?.league])

  useEffect(() => {
    if (selectedLeagues.length === 0) {
      setLeagueInsights({})
      return
    }

    let cancelled = false
    setLoadingLeagueInsights(true)

    Promise.all(
      selectedLeagues.map(async (league) => {
        try {
          const [overviewResponse, trendsResponse] = await Promise.all([
            fetch(`/api/analytics/overview/${encodeURIComponent(league)}`),
            fetch(`/api/analytics/season_trends/${encodeURIComponent(league)}`),
          ])

          const overview = overviewResponse.ok ? ((await overviewResponse.json()) as LeagueOverview) : null
          const trendPayload = trendsResponse.ok
            ? ((await trendsResponse.json()) as { trends?: SeasonTrendEntry[] })
            : null
          const trends = trendPayload?.trends || []
          const latestTrend = trends.length > 0 ? trends[trends.length - 1] : null
          const previousTrend = trends.length > 1 ? trends[trends.length - 2] : null

          return [league, { overview, latestTrend, previousTrend }] as const
        } catch {
          return [league, null] as const
        }
      }),
    )
      .then((entries) => {
        if (cancelled) return
        const next: Record<string, LeagueInsight | null> = {}
        for (const [league, data] of entries) {
          next[league] = data
        }
        setLeagueInsights(next)
      })
      .finally(() => {
        if (!cancelled) setLoadingLeagueInsights(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedLeagues])

  const { asQueryParam } = useGenderQuery()

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

  const canPredict = homeTeam && awayTeam && homeTeam.name !== awayTeam.name
  const formatPct = (value: number) => `${(value * 100).toFixed(1)}%`

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
        model_certainty: confOverall,
        historical_accuracy: 0.5,
        overall: confOverall,
      },
      model_version: 'legacy-elo-poisson',
    }
  }, [])

  const adaptedPrediction = useMemo(
    () => (result && !result.error ? adaptResult(result) : null),
    [result, adaptResult]
  )

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 md:px-8">
        <>
            <PredictHero />
            {/* Team Selection Card */}
            <div className="bento-card p-5">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                Step 1 · Pick two teams
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TeamSearchInput label="Home Team" value={homeTeam} onSelect={setHomeTeam} placeholder="Search home team…" Icon={Home} />
                <TeamSearchInput label="Away Team" value={awayTeam} onSelect={setAwayTeam} placeholder="Search away team…" Icon={Plane} />
              </div>

              {homeTeam && awayTeam && homeTeam.league !== awayTeam.league && (
                <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-[var(--accent-warn)]/35 bg-[var(--accent-warn)]/10 px-3 py-2 text-[11px] font-semibold text-[var(--accent-warn)]">
                  <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Cross-league: {homeTeam.league} vs {awayTeam.league}
                </div>
              )}

              {selectedLeagues.length > 0 && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {selectedLeagues.map((league) => {
                    const insight = leagueInsights[league]
                    const trendDelta = insight?.latestTrend && insight.previousTrend
                      ? insight.latestTrend.avg_goals - insight.previousTrend.avg_goals
                      : null

                    return (
                      <div key={league} className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">League context</p>
                        <p className="text-xs font-semibold text-[var(--text-primary)]">{league}</p>

                        {loadingLeagueInsights && (!insight || !insight.overview) && (
                          <p className="text-[11px] text-[var(--text-tertiary)] mt-1">Loading analytics…</p>
                        )}

                        {!loadingLeagueInsights && (!insight || !insight.overview) && (
                          <p className="text-[11px] text-[var(--text-tertiary)] mt-1">No settled analytics available yet.</p>
                        )}

                        {insight?.overview && (
                          <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[10px] text-[var(--text-secondary)]">
                            <span className="px-2 py-1 rounded bg-[var(--card-bg)]">Matches: {insight.overview.total_matches}</span>
                            <span className="px-2 py-1 rounded bg-[var(--card-bg)]">Avg goals: {insight.overview.avg_goals_per_match.toFixed(2)}</span>
                            <span className="px-2 py-1 rounded bg-[var(--card-bg)]">Home: {formatPct(insight.overview.home_win_rate)}</span>
                            <span className="px-2 py-1 rounded bg-[var(--card-bg)]">Draw: {formatPct(insight.overview.draw_rate)}</span>
                            {insight.latestTrend && (
                              <span className="px-2 py-1 rounded bg-[var(--card-bg)] col-span-2">
                                Season {insight.latestTrend.season}: {insight.latestTrend.avg_goals.toFixed(2)} goals/match
                                {trendDelta !== null && (
                                  <span className={trendDelta >= 0 ? 'text-emerald-400' : 'text-amber-400'}>
                                    {' '}({trendDelta >= 0 ? '+' : ''}{trendDelta.toFixed(2)} vs prior season)
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <button
                onClick={handlePredict}
                disabled={loading || !canPredict}
                className="group mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[var(--accent-ai)] to-[var(--accent-primary)] py-3.5 text-sm font-bold text-[var(--accent-on-primary)] shadow-lg shadow-[var(--accent-ai)]/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[var(--accent-ai)]/30 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    Get AI Prediction
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>

            {/* Result visualisation — new unified PredictionResult component */}
            {adaptedPrediction && (
              <div className="mt-4">
                <PredictionResultViz prediction={adaptedPrediction} />
              </div>
            )}

            {/* Legacy verdict / policy strip — kept because the new component
                doesn't yet render policy or cross-league context. */}
            {result && !result.error && result.predictions && (() => {
              return (
                <div className="space-y-4 animate-fade-in mt-4">
                  {/* Market & realism layer */}
                  <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] p-4 shadow-[var(--shadow-sm)]">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Policy & cross-league context</p>
                    {result.verdict && (
                      <div className={`mt-3 rounded-lg border p-3 ${result.verdict.recommended_action === 'play' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/35 bg-amber-500/10'}`}>
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Policy Decision</p>
                            <p className={`text-sm font-semibold ${result.verdict.recommended_action === 'play' ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {result.verdict.recommended_action === 'play' ? 'Play' : 'Pass'}
                              {result.verdict.recommended_pick ? ` · ${result.verdict.recommended_pick}` : ''}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5 text-[10px] text-[var(--text-secondary)]">
                            {typeof result.verdict.edge_pct === 'number' && (
                              <span className="px-2 py-1 rounded-full bg-[var(--muted-bg)]">Edge: {result.verdict.edge_pct.toFixed(1)}pp</span>
                            )}
                            {result.verdict.policy?.min_confidence !== undefined && (
                              <span className="px-2 py-1 rounded-full bg-[var(--muted-bg)]">Min Conf: {result.verdict.policy.min_confidence}%</span>
                            )}
                            {result.verdict.policy?.min_edge !== undefined && (
                              <span className="px-2 py-1 rounded-full bg-[var(--muted-bg)]">Min Edge: {result.verdict.policy.min_edge}pp</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {result.verdict?.summary && (
                      <p className="mt-3 text-xs text-[var(--text-secondary)]">{result.verdict.summary}</p>
                    )}
                  </div>
                </div>
              )
            })()}

            {result?.error && (
              <div className="flex items-center gap-3 rounded-xl border border-[var(--accent-loss)]/30 bg-[var(--accent-loss)]/5 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-loss)]/15 text-[var(--accent-loss)]">
                  <X className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Prediction Failed</p>
                  <p className="text-xs text-[var(--text-secondary)]">{result.error}</p>
                </div>
              </div>
            )}

            {/* How It Works — only shown when no result */}
            {!result && (
              <div>
                <p className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  How it works
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    {
                      Icon: TrendingUp,
                      tint: 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/12',
                      title: 'ELO ratings',
                      desc: 'Dynamic team strength adjusted for league quality and home edge.',
                    },
                    {
                      Icon: Goal,
                      tint: 'text-[var(--accent-ai)] bg-[var(--accent-ai)]/12',
                      title: 'Poisson goals',
                      desc: 'Bivariate-Poisson xG head returns a realistic scoreline distribution.',
                    },
                    {
                      Icon: Globe2,
                      tint: 'text-[var(--accent-warn)] bg-[var(--accent-warn)]/12',
                      title: 'Cross-league',
                      desc: 'Strength coefficients let you predict UCL vs MLS without breaking calibration.',
                    },
                  ].map(({ Icon: ItemIcon, tint, title, desc }) => (
                    <div key={title} className="bento-card p-4">
                      <span className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
                        <ItemIcon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
                      <p className="mt-1 text-[12px] leading-snug text-[var(--text-tertiary)]">{desc}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--accent-ai)]/30 bg-[var(--accent-ai)]/8 px-4 py-2.5 text-[12px] text-[var(--text-secondary)]">
                  <Brain className="h-4 w-4 shrink-0 text-[var(--accent-ai)]" aria-hidden="true" />
                  Pick two teams above to see calibrated probabilities, an xG breakdown, the
                  most-likely scoreline, and the factors the model weighed most heavily.
                </div>
              </div>
            )}
        </>
      </div>
    </div>
  )
}

export default function PredictPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[var(--accent-ai)] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <PredictPageContent />
    </Suspense>
  )
}
