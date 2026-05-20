'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { PredictionResult as PredictionResultViz, type PredictionPayload } from '@/components/prediction/PredictionResult'

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
  label, value, onSelect, placeholder, icon
}: {
  label: string; value: { name: string; league: string } | null
  onSelect: (team: { name: string; league: string } | null) => void
  placeholder: string; icon: string
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
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)]">
          <span className="text-lg">{icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{value.name}</p>
            <p className="text-[10px] text-[var(--text-tertiary)]">{value.league}</p>
          </div>
          <button onClick={() => { onSelect(null); setQuery(''); setResults([]) }} className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--text-tertiary)]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-lg">{icon}</div>
          <input
            ref={inputRef} type="text" value={query}
            onChange={(e) => { setQuery(e.target.value); setIsOpen(true) }}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-ai)] focus:border-[var(--accent-ai)]"
          />
          {loading && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[var(--accent-ai)] border-t-transparent rounded-full animate-spin" />}
        </div>
      )}
      {isOpen && results.length > 0 && !value && (
        <div ref={dropdownRef} className="absolute z-50 w-full mt-1 max-h-48 overflow-y-auto rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] shadow-xl">
          {results.map((team, idx) => (
            <button key={`${team.name}-${idx}`} onClick={() => { onSelect(team); setQuery(''); setResults([]); setIsOpen(false) }}
              className="w-full px-3 py-2 flex items-center gap-2 hover:bg-[var(--card-hover)] text-left text-sm">
              <span className="text-xs">⚽</span>
              <div><p className="text-[var(--text-primary)] font-medium">{team.name}</p><p className="text-[10px] text-[var(--text-tertiary)]">{team.league}</p></div>
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

  const handlePredict = async () => {
    if (!homeTeam || !awayTeam) return
    if (homeTeam.name === awayTeam.name) { setResult({ error: 'Please select different teams' }); return }
    setLoading(true); setResult(null)
    try {
      const response = await fetch('/api/predict/any-teams', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ home_team: homeTeam.name, away_team: awayTeam.name, home_league: homeTeam.league, away_league: awayTeam.league }),
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
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-2xl mx-auto px-4 py-4">
        <>
            <div className="mb-4 fm-surface p-4 md:p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">Match Predictor</p>
              <h1 className="text-xl font-bold text-[var(--text-primary)]">Realistic match outcome forecasts</h1>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Predictions blend team strength, recent form, league calibration, and scoreline realism. Season simulation has been removed from the main workflow to keep the product focused on match forecasting.
              </p>
            </div>
            {/* Team Selection Card */}
            <div className="fm-surface p-4 mb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TeamSearchInput label="Home Team" value={homeTeam} onSelect={setHomeTeam} placeholder="Search home team..." icon="🏠" />
                <TeamSearchInput label="Away Team" value={awayTeam} onSelect={setAwayTeam} placeholder="Search away team..." icon="✈️" />
              </div>

              {homeTeam && awayTeam && homeTeam.league !== awayTeam.league && (
                <div className="mt-3 text-center text-[10px] text-amber-500 font-semibold rounded-lg border border-amber-500/35 bg-amber-500/10 py-2">🌍 Cross-league: {homeTeam.league} vs {awayTeam.league}</div>
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

              <button onClick={handlePredict} disabled={loading || !canPredict}
                className="w-full mt-4 py-3 rounded-xl font-semibold text-sm text-[#021320] bg-gradient-to-br from-[var(--accent-ai-light)] to-[var(--accent-ai)] hover:opacity-95 disabled:opacity-35 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20">
                {loading ? (
                  <><div className="w-4 h-4 border-2 border-[#021320] border-t-transparent rounded-full animate-spin" /> Analyzing...</>
                ) : (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#021320" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v4" /><path d="M20 12h-4" /><path d="M12 18v4" /><path d="M4 12h4" /></svg> Get AI Prediction</>
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
              <div className="bg-[var(--card-bg)] rounded-xl border border-red-500/30 p-4 flex items-center gap-3">
                <span className="text-lg">❌</span>
                <div><p className="text-sm font-semibold text-[var(--text-primary)]">Prediction Failed</p><p className="text-xs text-[var(--text-secondary)]">{result.error}</p></div>
              </div>
            )}

            {/* How It Works — only shown when no result */}
            {!result && (
              <div className="mt-6">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3 px-1">How It Works</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { icon: '📈', title: 'ELO Ratings', desc: 'Dynamic ratings adjusted with league strength and home edge' },
                    { icon: '⚽', title: 'Poisson Goals', desc: 'Realistic scoreline and goal-market probabilities' },
                    { icon: '🌍', title: 'Cross-League', desc: 'League strength coefficients plus recent-form calibration' },
                  ].map((item) => (
                    <div key={item.title} className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-3 text-center shadow-[var(--shadow-sm)]">
                      <span className="text-xl block mb-1">{item.icon}</span>
                      <p className="text-xs font-semibold text-[var(--text-primary)] mb-0.5">{item.title}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)]">{item.desc}</p>
                    </div>
                  ))}
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
