'use client'

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Brain,
  ChevronDown,
  Globe2,
  Goal,
  ListTree,
  Loader2,
  Percent,
  Sparkles,
} from 'lucide-react'

import { PredictionResult as PredictionResultViz } from '@/components/prediction/PredictionResult'
import {
  MatchupPicker,
  flagCountryFor,
  isNationalCompetition,
  leagueAccentFor,
  resolveCatalogTeam,
  type TeamPick,
} from '@/components/TeamSelector'
import { AsyncSection, FlagBadge } from '@/components/primitives'
import { Skeleton } from '@/components/ui/skeleton'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import type { AttributionItem } from '@/lib/types/attribution'
import { adaptLegacyPrediction } from '@/components/prediction/adaptLegacyPrediction'

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
    tint: 'text-[var(--accent-ai)] bg-[color-mix(in_srgb,var(--accent-ai)_12%,transparent)]',
    title: 'Honest probabilities',
    desc: 'Win, draw and loss, scored publicly against the closing line.',
  },
  {
    Icon: Goal,
    tint: 'text-[var(--accent-primary)] bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)]',
    title: 'Scoreline distribution',
    desc: 'A probability for every plausible final score.',
  },
  {
    Icon: ListTree,
    tint: 'text-[var(--accent-warn)] bg-[color-mix(in_srgb,var(--accent-warn)_12%,transparent)]',
    title: 'Why this prediction',
    desc: 'Which signals moved the number.',
  },
] as const

/** `?league=` may be an ESPN id (`eng.1`) or a catalog name; either resolves. */
function catalogLeagueFor(param: string | null): string | undefined {
  if (!param) return undefined
  return ESPN_TO_CATALOG[param] ?? param
}

function PredictPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  // The matchup IS the URL: /predict?home=&away=&league=[&away_league=].
  // Read once on arrival, written back as the reader changes it, so a
  // pairing is shareable and a match card can link into a priced one.
  const preferredLeague = catalogLeagueFor(searchParams.get('league'))
  const [homeTeam, setHomeTeam] = useState<TeamPick | null>(() =>
    resolveCatalogTeam(searchParams.get('home') ?? '', preferredLeague)
  )
  const [awayTeam, setAwayTeam] = useState<TeamPick | null>(() =>
    resolveCatalogTeam(
      searchParams.get('away') ?? '',
      catalogLeagueFor(searchParams.get('away_league')) ?? preferredLeague
    )
  )
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

  // Keep the address bar in step with the picker. Replace, not push: the
  // picker is one control, not a history of every club tried in it.
  useEffect(() => {
    const next = new URLSearchParams()
    if (homeTeam) next.set('home', homeTeam.name)
    if (awayTeam) next.set('away', awayTeam.name)
    if (homeTeam) next.set('league', homeTeam.league)
    if (homeTeam && awayTeam && awayTeam.league !== homeTeam.league) {
      next.set('away_league', awayTeam.league)
    }
    const qs = next.toString()
    if (qs === searchParams.toString()) return
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [homeTeam, awayTeam, pathname, router, searchParams])

  const handlePredict = useCallback(async () => {
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
  }, [homeTeam, awayTeam, asQueryParam])

  // A deep link that names both sides is a matchup, so it is priced on
  // arrival rather than parked behind the button. Once, on mount.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current) return
    autoRan.current = true
    if (homeTeam && awayTeam && homeTeam.name !== awayTeam.name) void handlePredict()
  }, [homeTeam, awayTeam, handlePredict])

  const canPredict = Boolean(homeTeam && awayTeam && homeTeam.name !== awayTeam.name)
  const isCrossLeague = Boolean(
    homeTeam && awayTeam && homeTeam.league !== awayTeam.league
  )

  const adaptedPrediction = useMemo(() => {
    if (!result || result.error || !result.home_team || !result.away_team) return null
    return adaptLegacyPrediction(result, {
      home_team: result.home_team, away_team: result.away_team,
      league: result.is_cross_league
        ? `${result.home_league ?? ''} vs ${result.away_league ?? ''}`
        : result.home_league ?? result.away_league,
    })
  }, [result])

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 md:px-8">
        {/* Compact page title — no marketing hero */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
              Any matchup
            </h1>
            <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Any two clubs · 1X2 · scoreline
            </p>
          </div>
          {/* Gender toggle removed with the coverage waves — see TopBar. */}
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
            <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--accent-warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent-warn)_10%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--accent-warn)]">
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
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-color)] bg-[color-mix(in_srgb,var(--muted-bg)_60%,transparent)] px-3.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
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
                    <div className={`rounded-lg border p-3 ${result.verdict.recommended_action === 'play' ? 'border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)]' : 'border-[color-mix(in_srgb,var(--accent-warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent-warn)_10%,transparent)]'}`}>
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

        {/* What comes back — folded, so the page opens on the picker and
            the result. One line each; the long form lives on /about. */}
        <details className="group rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden">
            What the model returns
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <ul className="grid grid-cols-1 gap-3 border-t border-[var(--border-color)] px-4 py-3 sm:grid-cols-3">
            {OUTPUT_EXPLAINERS.map(({ Icon, tint, title, desc }) => (
              <li key={title} className="flex items-start gap-2.5">
                <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tint}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-[var(--text-primary)]">{title}</span>
                  <span className="block text-[11px] leading-snug text-[var(--text-tertiary)]">{desc}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-2 border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] text-[var(--text-tertiary)]">
            <Brain className="h-3.5 w-3.5 shrink-0 text-[var(--accent-ai)]" aria-hidden="true" />
            Cross-league pairings work: both sides sit on one strength scale.
          </p>
        </details>
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
