'use client'

import { useEffect, useMemo, useState } from 'react'

import { AccuracyDeepCuts } from '@/components/accuracy/AccuracyDeepCuts'
import { AccuracyHeadline } from '@/components/accuracy/AccuracyHeadline'
import { AccuracyKpiStrip } from '@/components/accuracy/AccuracyKpiStrip'
import { BaselineLadder } from '@/components/accuracy/BaselineLadder'
import {
  LeagueAccuracy,
  PooledCallRecord,
  TournamentAccuracy,
} from '@/components/accuracy/CompetitionAccuracy'
import { MarketBenchmarkPanel } from '@/components/accuracy/MarketBenchmarkPanel'
import { ReliabilityPanel } from '@/components/accuracy/ReliabilityPanel'
import { ScopeNote } from '@/components/accuracy/ScopeNote'
import { samplePhrase } from '@/components/accuracy/accuracyMetrics'
import type { RecentPick } from '@/components/accuracy/RecentPicksFeed'
import { DocsRow } from '@/components/evidence/DocsLink'
import { LayerTabs, SectionRule, type Layer } from '@/components/evidence/LayerTabs'
import { EvidenceHeader } from '@/components/evidence/primitives'
import { callRecord, callsFor } from '@/components/evidence/tournamentCalls'
import { CompetitionSelect } from '@/components/forecast/CompetitionSelect'
import type { CompetitionOption } from '@/components/forecast/CompetitionSelect'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import {
  SERVED_COMPETITION_IDS,
  TOURNAMENT_COMPETITION_IDS,
  getLeagueAccent,
  tournamentRank,
} from '@/lib/leagueAccents'
import type {
  AccuracySummaryResponse,
  FlatAccuracyResponse,
  LeagueAccuracySummary,
} from '@/lib/types/accuracy'

/**
 * The published record — per competition, like its sibling.
 *
 * This page reported one pooled hit rate over every league at once. That is an
 * average of leagues that differ by six points, and it is nobody's question: a
 * reader wants the Premier League's record, or MLS's, or what the model has
 * called in the Champions League. `/evaluation` was reorganised per competition
 * for exactly that reason and this page had not caught up, so the two halves of
 * one section answered at different resolutions.
 *
 * Same shape as `/evaluation` now: layer, competition, then that competition
 * alone — and what is genuinely pooled below a heading that says it is pooled.
 *
 * The two pages still answer different questions. `/evaluation` is about the
 * MODEL: what it believed and what that belief was worth against the baselines.
 * This page is about the PICKS: what was published, scored after the fact.
 *
 * The knockout layer is the one place that distinction needs care. There is no
 * live per-tie record yet, so what this page can show is the call each edition
 * carried at its first knockout round — reconstructed by a model refit on
 * earlier seasons only. That is a backtest, it is labelled a backtest wherever
 * it appears, and it is never added to anything on the league side.
 */

interface RecentResponse {
  count: number
  predictions: RecentPick[]
}

interface TournamentEdition {
  competition_id: string
  season: number
  actual_champion?: string
  probability_on_actual?: number
  called_it?: boolean
  forecast_made_at_round?: string
  forecast_from?: string
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

function settledValue<T>(result: PromiseSettledResult<T | null>): T | null {
  return result.status === 'fulfilled' ? result.value : null
}

export default function AccuracyPage() {
  const { gender, asQueryParam } = useGenderQuery()
  const [metrics, setMetrics] = useState<FlatAccuracyResponse | null>(null)
  const [picks, setPicks] = useState<RecentPick[]>([])
  const [summary, setSummary] = useState<AccuracySummaryResponse | null>(null)
  const [editions, setEditions] = useState<TournamentEdition[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const [layer, setLayer] = useState<Layer>('leagues')
  const [leagueId, setLeagueId] = useState<string | null>(null)
  const [tournamentId, setTournamentId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // allSettled + never-throwing fetchJson: one failed endpoint hides its
    // section, it never blanks the page.
    Promise.allSettled([
      fetchJson<FlatAccuracyResponse>(`/api/v1/tracking/accuracy?gender=${asQueryParam}`),
      fetchJson<RecentResponse>(
        `/api/v1/tracking/recent?gender=${asQueryParam}&limit=30&completed_only=true`
      ),
      fetchJson<AccuracySummaryResponse>(`/api/v1/tracking/accuracy/summary?gender=${asQueryParam}`),
      fetchJson<{ tournaments?: TournamentEdition[] }>('/api/v1/tournaments/predictions'),
    ]).then(([accuracy, recent, summaryRes, tournaments]) => {
      if (cancelled) return
      const acc = settledValue(accuracy)
      setMetrics(acc)
      setPicks(settledValue(recent)?.predictions ?? [])
      setSummary(settledValue(summaryRes))
      setEditions(settledValue(tournaments)?.tournaments ?? [])
      setFailed(acc === null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [asQueryParam])

  const settled = metrics?.completed_predictions ?? 0
  const total = metrics?.total_predictions ?? 0
  const pending = metrics?.pending_predictions ?? Math.max(0, total - settled)

  // Per-league rollup, rekeyed by competition id. The endpoint keys `by_league`
  // by the DISPLAY NAME a prediction stores ("Premier League"), not by
  // "eng.1" — so every lookup against a competition id missed, silently.
  const leagueRows = useMemo(() => {
    if (!summary?.by_league) return new Map<string, LeagueAccuracySummary>()
    const byId = new Map<string, LeagueAccuracySummary>()
    for (const row of Object.values(summary.by_league)) {
      if (row.total > 0) byId.set(getLeagueAccent(row.league).competitionId, row)
    }
    return byId
  }, [summary])

  /**
   * Every served league, in the site's own order — exactly as `/evaluation`
   * does it, and for the same reason: **the registry decides membership, the
   * record only supplies numbers.**
   *
   * Deriving this list from the settled rows instead made a league vanish the
   * moment it had nothing settled, and right now that is every one of them:
   * the record is scoped to the serving model, and the serving model's 46
   * covered-league picks are all still pending. An empty list then disabled
   * the Leagues tab — the DEFAULT layer — so the page opened on a dead tab,
   * and switching to Tournaments was a one-way trip.
   *
   * "Nothing settled yet" is a real answer, and `LeagueAccuracy` has always
   * known how to say it. It was simply never reachable.
   */
  const leagues = useMemo(
    () =>
      (SERVED_COMPETITION_IDS as readonly string[])
        .filter((id) => getLeagueAccent(id).gender === asQueryParam)
        .map((id) => ({ id, row: leagueRows.get(id) ?? null })),
    [leagueRows, asQueryParam],
  )

  const calls = useMemo(() => callsFor(editions), [editions])
  const tournaments = useMemo(() => {
    const withCalls = new Set(calls.map((c) => c.competitionId))
    return TOURNAMENT_COMPETITION_IDS.filter((id) => withCalls.has(id)).sort(
      (a, b) => tournamentRank(a) - tournamentRank(b),
    )
  }, [calls])

  useEffect(() => {
    if (!leagueId && leagues.length) setLeagueId(leagues[0].id)
    if (!tournamentId && tournaments.length) setTournamentId(tournaments[0])
  }, [leagues, tournaments, leagueId, tournamentId])

  const leagueOptions: CompetitionOption[] = leagues.map(({ id, row }) => {
    const accent = getLeagueAccent(id)
    return {
      id,
      name: accent.displayName,
      subtitle: row
        ? `${accent.country} · ${row.total.toLocaleString()} settled`
        : `${accent.country} · nothing settled`,
    }
  })

  const tournamentOptions: CompetitionOption[] = tournaments.map((id) => {
    const accent = getLeagueAccent(id)
    const n = calls.filter((c) => c.competitionId === id).length
    return {
      id,
      name: accent.displayName,
      subtitle: `${accent.country} · ${n} edition${n === 1 ? '' : 's'} settled`,
    }
  })

  const selected = layer === 'leagues' ? leagueId : tournamentId
  const options = layer === 'leagues' ? leagueOptions : tournamentOptions

  if (loading && metrics === null) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
        <PageHeader />
        <AccuracySkeleton />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <PageHeader />

      {failed ? (
        <div className="mt-8">
          <EmptyState
            heading="The record isn't loading"
            body="The settled-results feed didn't respond. Nothing is estimated in its place — try again in a moment."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* ---- the one control that changes everything below ---------- */}
          {leagues.length || tournaments.length ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <LayerTabs
                value={layer}
                onChange={setLayer}
                enabled={{
                  leagues: leagues.length > 0,
                  tournaments: tournaments.length > 0,
                }}
              />
              {selected && options.length ? (
                <CompetitionSelect
                  options={options}
                  value={selected}
                  onChange={layer === 'leagues' ? setLeagueId : setTournamentId}
                  kind={layer === 'leagues' ? 'League' : 'Tournament'}
                  className="sm:flex-1"
                />
              ) : null}
            </div>
          ) : null}

          {/* ---- the selected competition -------------------------------- */}
          {layer === 'leagues' && leagueId ? (
            <LeagueAccuracy
              id={leagueId}
              row={leagues.find((l) => l.id === leagueId)?.row ?? null}
            />
          ) : null}

          {layer === 'tournaments' && tournamentId ? (
            <TournamentAccuracy
              id={tournamentId}
              record={callRecord(calls.filter((c) => c.competitionId === tournamentId))}
              calls={calls.filter((c) => c.competitionId === tournamentId)}
            />
          ) : null}

          {/* ---- what is measured across all of them --------------------- */}
          {layer === 'leagues' ? (
            <>
              <SectionRule label="Across every league" />
              {settled === 0 ? (
                <>
                  <ScopeNote scope={metrics?.scope} />
                  <EmptyState
                    heading={total > 0 ? 'No results in yet' : 'Nothing tracked here yet'}
                    body={
                      total > 0 ? (
                        <>
                          {samplePhrase(total, 'pick')} recorded, none with a final result
                          so far. The rates appear as soon as the first match finishes.
                        </>
                      ) : (
                        <>
                          Nothing in scope has been settled yet — the record covers the
                          model serving today in the covered leagues, and that intersection
                          is currently empty.
                        </>
                      )
                    }
                  />
                  {/* An empty live record is the strongest reason to show the
                      backtest: without it the page says nothing at all about
                      whether the model is any good. */}
                  <BaselineLadder />
                </>
              ) : (
                <>
                  <AccuracyHeadline
                    accuracy={metrics?.winner_accuracy ?? 0}
                    settled={settled}
                    pending={pending}
                    recentForm={metrics?.recent_form ?? []}
                    gender={gender}
                  />

                  <AccuracyKpiStrip
                    settled={settled}
                    probabilityScore={metrics?.brier_score ?? null}
                    calibrationGap={metrics?.expected_calibration_error ?? null}
                    recentAccuracy={metrics?.recent_accuracy ?? 0}
                    recentWindow={Math.min(50, settled)}
                  />

                  {/* Sits under the headline because it is what makes the
                      headline readable. Renders nothing if the benchmark has
                      never run. */}
                  <MarketBenchmarkPanel />
                  <BaselineLadder />

                  <ReliabilityPanel
                    bins={metrics?.calibration_bins ?? []}
                    gap={metrics?.expected_calibration_error ?? null}
                    settled={settled}
                  />

                  <AccuracyDeepCuts metrics={metrics} picks={picks} />
                  <ScopeNote scope={metrics?.scope} />
                </>
              )}
            </>
          ) : (
            <>
              <SectionRule label={`Across all ${tournaments.length} knockout competitions`} />
              <PooledCallRecord record={callRecord(calls)} competitions={tournaments.length} />
            </>
          )}

          <DocsRow
            docs={[
              { doc: 'tutorialJudge', label: 'How to read this' },
              { doc: 'scoring', label: 'What the metrics mean' },
              { doc: 'evaluation', label: 'How the record is kept' },
            ]}
          />
        </div>
      )}
    </div>
  )
}

/**
 * The same header the other evidence page uses.
 *
 * `/accuracy` and `/evaluation` are one section of the app and were rendering
 * as two products. `EvidenceHeader` is the single one.
 */
function PageHeader() {
  return (
    <>
      <EvidenceHeader
        title="Accuracy"
        lede="Every pick this site has published, scored against the final result — competition by competition."
      />
      <DocsRow
        className="mt-3"
        docs={[
          { doc: 'tutorialJudge', label: 'How to judge this' },
          { doc: 'scoring', label: 'What the metrics mean' },
        ]}
      />
    </>
  )
}

function EmptyState({ heading, body }: { heading: string; body: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--card-bg)] px-6 py-10 text-center">
      <h2 className="text-sm font-bold text-[var(--text-primary)]">{heading}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12px] leading-relaxed text-[var(--text-tertiary)]">
        {body}
      </p>
    </div>
  )
}

/** Loading skeleton mirroring the final layout — control, competition, pooled. */
function AccuracySkeleton() {
  return (
    <div className="mt-8 space-y-6" role="status" aria-label="Loading accuracy data">
      <div className="skeleton-shimmer h-[44px] rounded-xl border border-[var(--border-color)]" />
      <div className="skeleton-shimmer h-[240px] rounded-xl border border-[var(--border-color)]" />
      <div className="skeleton-shimmer h-[300px] rounded-xl border border-[var(--border-color)] sm:h-[160px] lg:h-[92px]" />
      <div className="skeleton-shimmer h-[440px] rounded-xl border border-[var(--border-color)]" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}
