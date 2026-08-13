'use client'

import { useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { CompetitionSelect } from '@/components/forecast/CompetitionSelect'
import type { CompetitionOption } from '@/components/forecast/CompetitionSelect'
import { LeagueEvidence, TournamentEvidence } from '@/components/evidence/CompetitionEvidence'
import { DocsRow } from '@/components/evidence/DocsLink'
import { RecordsHero } from '@/components/evidence/RecordsHero'
import {
  ProgressionPanel,
  TieCalibrationPanel,
  TieFeaturesPanel,
  TieRoundsPanel,
} from '@/components/evidence/TiePooledPanels'
import type { CalibrationBand, ImportanceRow, RoundRow } from '@/components/evidence/TiePooledPanels'
import { trophyRecord } from '@/components/evidence/competitionRecords'
import type { BracketEventRow, LeagueMeasured } from '@/components/evidence/competitionRecords'
import { EvidenceHeader, MetricRow, Panel, StatTile } from '@/components/evidence/primitives'
import type { Historical } from '@/components/forecast/EvidencePanel'
import { BracketRecord } from '@/components/tournament/BracketRecord'
import type { BracketSummary } from '@/components/tournament/BracketRecord'
import { TournamentLadder } from '@/components/tournament/TournamentLadder'
import type { LadderEntry } from '@/components/tournament/TournamentLadder'
import {
  SERVED_COMPETITION_IDS,
  TOURNAMENT_COMPETITION_IDS,
  getLeagueAccent,
  tournamentRank,
} from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

/**
 * Model evaluation, competition by competition.
 *
 * Two rules shape this page, and both are the LAYOUT rather than a sentence
 * inside it.
 *
 * **One competition at a time.** The evidence exists per competition — each
 * league carries its own walk-forward block, each knockout competition its own
 * backtested editions — and the pooled headline hides the spread it is an
 * average of: .59303 over the top five, whose members run .56873 to .62101. A
 * reader looking at MLS is not served by the Portuguese number folded into it.
 * So the page opens on a picker, and everything under it is about that one
 * competition. What is genuinely pooled is printed under a heading that says
 * so, never attributed to whatever happens to be selected.
 *
 * **Historical walk-forward and live published forecasts are never mixed, and
 * never summed.** They are different samples measuring different things — one
 * retrospective and large, one prospective and often zero — and presenting
 * either as the other would be the most misleading thing this product could do.
 *
 * What this page deliberately does NOT do any more is explain itself at
 * length. Every methodology paragraph that used to live here is in
 * `docs/handbook/`, linked from the sections it belongs to. The pages carry
 * the numbers; the handbook carries the reasoning.
 */

interface Bucket {
  bin_low: number
  bin_high: number
  n: number
  stated: number
  observed: number
}

interface Sample {
  basis?: string
  n: number
  brier?: number
  log_loss?: number
  accuracy?: number
  ece?: number
  reliability?: Bucket[]
  by_league?: Record<string, { n: number; brier: number | null; note?: string }>
  by_model_version?: Record<string, { n: number; brier: number | null; note?: string }>
  baselines?: { uniform: number; sample_base_rate: number; note: string }
}

/**
 * Why the scored sample is the size it is.
 *
 * "Not played yet" and "we could not match this club to a result" both shrink
 * the live sample, and only one of them means something is broken. A rehearsal
 * against last season found the join silently discarding 31% of fixtures
 * because one source says "Gladbach" and the other "Borussia Mönchengladbach".
 * It looked exactly like a small sample.
 */
interface JoinReport {
  snapshots?: number
  scored?: number
  awaiting_result?: number
  unresolved_count?: number
  unresolved_clubs?: Record<string, number>
}

interface EvalPayload {
  available: boolean
  generated_at?: string
  live?: Sample
  join?: JoinReport
  historical?: Historical
  snapshot_store?: {
    rows: number
    fixtures: number
    versions: number
    by_version?: Record<string, number>
  }
}

interface ProjectionsPayload {
  available?: boolean
  leagues?: Array<{ competition_id: string; measured?: LeagueMeasured }>
}

interface TiesArtifact {
  n_ties_scored: number
  test_seasons: number[]
  ladder: LadderEntry[]
  calibration: CalibrationBand[]
  by_round: Record<string, RoundRow>
  by_competition?: Record<string, { n: number; accuracy: number; brier?: number }>
  permutation_importance?: ImportanceRow[]
  method: {
    competitions: string[]
    progression_check: { checked: number; confirmed: number; rate: number }
  }
}

interface KnockoutPayload {
  available: boolean
  ties?: TiesArtifact | null
  brackets?: { summary?: BracketSummary; events?: BracketEventRow[] } | null
}

type Layer = 'leagues' | 'tournaments'

// A reliability chart needs enough points per band to have a shape. Below this
// the honest rendering is a sentence, not a diagram.
const MIN_FOR_CHART = 200

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

export default function EvaluationPage() {
  const [evaluation, setEvaluation] = useState<EvalPayload | null>(null)
  const [projections, setProjections] = useState<ProjectionsPayload | null>(null)
  const [knockout, setKnockout] = useState<KnockoutPayload | null>(null)
  const [loading, setLoading] = useState(true)

  const [layer, setLayer] = useState<Layer>('leagues')
  const [leagueId, setLeagueId] = useState<string | null>(null)
  const [tournamentId, setTournamentId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      getJson<EvalPayload>('/api/v1/evaluation'),
      getJson<ProjectionsPayload>('/api/v1/season/projections'),
      getJson<KnockoutPayload>('/api/v1/tournaments/knockout'),
    ]).then(([ev, pr, kn]) => {
      if (!alive) return
      setEvaluation(ev)
      setProjections(pr)
      setKnockout(kn)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const live = evaluation?.live
  const ties = knockout?.ties ?? null
  const events = useMemo(() => knockout?.brackets?.events ?? [], [knockout])

  /** Leagues in the order the site serves them, each with its measured block. */
  const leagues = useMemo(() => {
    const measured = new Map<string, LeagueMeasured | undefined>()
    for (const l of projections?.leagues ?? []) measured.set(l.competition_id, l.measured)
    // The registry is the source of order and membership; the artifact only
    // supplies numbers. A checkout where the nightly job has not run still
    // lists every served league, each rendering without a number rather than
    // with a zero.
    return SERVED_COMPETITION_IDS.filter((id) => measured.has(id) || !projections?.leagues?.length)
      .map((id) => ({ id, measured: measured.get(id) ?? null }))
  }, [projections])

  /** Knockout competitions that have at least one measured edition. */
  const tournaments = useMemo(() => {
    const withEvidence = new Set<string>(events.map((e) => e.competition))
    for (const id of Object.keys(ties?.by_competition ?? {})) withEvidence.add(id)
    return TOURNAMENT_COMPETITION_IDS.filter((id) => withEvidence.has(id)).sort(
      (a, b) => tournamentRank(a) - tournamentRank(b),
    )
  }, [events, ties])

  // Open on the first competition of whichever layer has evidence.
  useEffect(() => {
    if (!leagueId && leagues.length) setLeagueId(leagues[0].id)
    if (!tournamentId && tournaments.length) setTournamentId(tournaments[0])
  }, [leagues, tournaments, leagueId, tournamentId])

  const leagueOptions: CompetitionOption[] = leagues.map(({ id, measured }) => {
    const accent = getLeagueAccent(id)
    return {
      id,
      name: accent.displayName,
      subtitle: measured?.n_scored
        ? `${accent.country} · ${measured.n_scored.toLocaleString()} matches scored`
        : `${accent.country} · no measured block yet`,
    }
  })

  const tournamentOptions: CompetitionOption[] = tournaments.map((id) => {
    const accent = getLeagueAccent(id)
    const record = trophyRecord(events, id)
    return {
      id,
      name: accent.displayName,
      subtitle: record
        ? `${accent.country} · ${record.editions} edition${record.editions === 1 ? '' : 's'} backtested`
        : `${accent.country} · ties only`,
    }
  })

  const selected = layer === 'leagues' ? leagueId : tournamentId
  const options = layer === 'leagues' ? leagueOptions : tournamentOptions
  // A list of leagues with no measured block behind any of them is not
  // evidence — it is the registry. On a checkout where nothing has been
  // generated, the honest page is the empty state rather than nine pickable
  // competitions that each say "no measured block".
  const nothingMeasured = !leagues.some((l) => l.measured) && !tournaments.length

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <EvidenceHeader
        title="Evaluation"
        lede="What the model believed in each competition, and what those beliefs were worth against the yardsticks it had to beat."
      />
      <DocsRow
        className="mt-3"
        docs={[
          { doc: 'tutorialJudge', label: 'How to judge this' },
          { doc: 'scoring', label: 'What the metrics mean' },
          { doc: 'models', label: 'How the models work' },
        ]}
      />

      {loading ? (
        <div
          className="mt-8 h-64 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
          role="status"
          aria-label="Loading evaluation"
        />
      ) : nothingMeasured && !evaluation?.available ? (
        <div className="mt-8">
          <EmptyState
            title="No evaluation has been generated here"
            description="These are regenerable artifacts, not shipped data. Run evaluate_live, forecast_season and benchmark_knockout to populate this page."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* ---- the one control that changes everything below ---------- */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <LayerTabs
              value={layer}
              onChange={setLayer}
              enabled={{ leagues: leagues.length > 0, tournaments: tournaments.length > 0 }}
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

          {/* ---- the selected competition -------------------------------- */}
          {layer === 'leagues' && leagueId ? (
            <LeagueEvidence
              id={leagueId}
              measured={leagues.find((l) => l.id === leagueId)?.measured ?? null}
              live={liveForLeague(live, leagueId)}
            />
          ) : null}

          {layer === 'tournaments' && tournamentId ? (
            <TournamentEvidence
              id={tournamentId}
              trophy={trophyRecord(events, tournamentId)}
              tie={ties?.by_competition?.[tournamentId] ?? null}
            />
          ) : null}

          {/* ---- what is measured across all of them --------------------- */}
          <SectionRule
            label={
              layer === 'leagues'
                ? 'Across every league'
                : `Across all ${ties?.method?.competitions?.length ?? tournaments.length} knockout competitions`
            }
          />

          {layer === 'leagues' ? (
            <PooledMatchRecord evaluation={evaluation} live={live} />
          ) : (
            <PooledTieRecord ties={ties} brackets={knockout?.brackets ?? null} />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The live record for one league.
 *
 * `by_league` is only present once something has been scored; before that the
 * whole block is absent rather than a map of zeroes, and this returns null so
 * the panel says "nothing scored yet" instead of "Brier 0.00000".
 */
function liveForLeague(live: Sample | undefined, id: string) {
  const row = live?.by_league?.[id]
  if (!row || !row.n) return null
  return { n: row.n, brier: row.brier, note: row.note }
}

/** Which layer's evidence is on screen. Two options, so tabs rather than a select. */
function LayerTabs({
  value,
  onChange,
  enabled,
}: {
  value: Layer
  onChange: (v: Layer) => void
  enabled: Record<Layer, boolean>
}) {
  const tabs: Array<{ key: Layer; label: string }> = [
    { key: 'leagues', label: 'Leagues' },
    { key: 'tournaments', label: 'Tournaments' },
  ]
  return (
    <div
      role="tablist"
      aria-label="Which layer to evaluate"
      className="inline-flex shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-0.5"
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={value === t.key}
          disabled={!enabled[t.key]}
          onClick={() => onChange(t.key)}
          className={cn(
            'min-h-[36px] rounded-md px-3 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors',
            value === t.key
              ? 'bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            !enabled[t.key] && 'cursor-not-allowed opacity-40',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** A labelled divider: everything below this measures more than one competition. */
function SectionRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {label}
      </h2>
      <span className="h-px flex-1 bg-[var(--border-color)]" aria-hidden="true" />
    </div>
  )
}

function PooledMatchRecord({
  evaluation,
  live,
}: {
  evaluation: EvalPayload | null
  live?: Sample
}) {
  const store = evaluation?.snapshot_store

  return (
    <div className="space-y-6">
      {/* The rule, as the layout: two records, side by side, never summed. */}
      <RecordsHero historical={evaluation?.historical} live={live} />

      {live?.n ? (
        <Panel
          title="Live published forecasts"
          right={
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              {live.n.toLocaleString()} scored
            </span>
          }
        >
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="Brier" value={live.brier?.toFixed(5) ?? '—'} size="lead" />
            <StatTile label="Log loss" value={live.log_loss?.toFixed(5) ?? '—'} />
            <StatTile label="ECE" value={live.ece?.toFixed(4) ?? '—'} />
            <StatTile
              label="Accuracy"
              value={live.accuracy != null ? `${(live.accuracy * 100).toFixed(1)}%` : '—'}
            />
          </dl>

          {live.baselines ? (
            <div className="mt-4 border-t border-[var(--border-color)] pt-4">
              <div className="space-y-2.5">
                {(() => {
                  const rows = [
                    { label: 'This model', v: live.brier ?? 0, tone: 'accent' as const },
                    {
                      label: 'A one-in-three guess',
                      v: live.baselines!.uniform,
                      tone: 'muted' as const,
                    },
                    {
                      label: "The sample's own base rate",
                      v: live.baselines!.sample_base_rate,
                      tone: 'muted' as const,
                    },
                  ].filter((r) => Number.isFinite(r.v) && r.v > 0)
                  const worst = Math.max(...rows.map((r) => r.v), 1e-9)
                  return rows.map((r) => (
                    <MetricRow
                      key={r.label}
                      label={r.label}
                      value={r.v.toFixed(5)}
                      fraction={r.v / worst}
                      tone={r.tone}
                    />
                  ))
                })()}
              </div>
            </div>
          ) : null}

          {live.n < MIN_FOR_CHART ? (
            <p className="mt-4 border-t border-[var(--border-color)] pt-3.5 text-[12px] leading-relaxed text-[var(--accent-warn)]">
              {live.n} matches is too few for a reliability chart. The numbers above are
              real; the shape of the error is not yet measurable.
            </p>
          ) : live.reliability?.length ? (
            <Reliability buckets={live.reliability} />
          ) : null}
        </Panel>
      ) : (
        <Panel title="Live published forecasts">
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
            Nothing has been scored yet — no fixture has both a published forecast and a
            result. That is a fact about the calendar rather than a failure, and it is not
            a loading state.
          </p>
        </Panel>
      )}

      {evaluation?.join ? <JoinPanel join={evaluation.join} /> : null}

      {store ? (
        <Panel
          title="What has been recorded"
          description="Every forecast is written down before kickoff and never rewritten. Without that, a forecast that moved would quietly become the forecast we claim to have made."
        >
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="Snapshots" value={store.rows.toLocaleString()} />
            <StatTile label="Fixtures" value={store.fixtures.toLocaleString()} />
            <StatTile label="Model versions" value={String(store.versions)} />
            <StatTile
              label="Scored so far"
              value={(live?.n ?? 0).toLocaleString()}
              tone={live?.n ? undefined : 'muted'}
            />
          </dl>
        </Panel>
      ) : null}

      <DocsRow
        docs={[
          { doc: 'evaluation', label: 'Why the two records stay apart' },
          { doc: 'artifacts', label: 'The files behind this page' },
        ]}
      />
    </div>
  )
}

function PooledTieRecord({
  ties,
  brackets,
}: {
  ties: TiesArtifact | null
  brackets: { summary?: BracketSummary; events?: BracketEventRow[] } | null
}) {
  if (!ties && !brackets?.summary) {
    return (
      <Panel title="Nothing pooled has been measured here">
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Run benchmark_knockout to publish the tie model&apos;s record.
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      {ties ? (
        <TournamentLadder
          ladder={ties.ladder}
          nTies={ties.n_ties_scored}
          seasons={ties.test_seasons}
          competitions={ties.method.competitions.length}
        />
      ) : null}
      {ties?.calibration?.length ? <TieCalibrationPanel bands={ties.calibration} /> : null}
      {/* Every tournament behind the trophy claim, printed rather than
          summarised: "one in three" invites the question "which three". */}
      {brackets?.summary ? (
        <BracketRecord summary={brackets.summary} events={brackets.events ?? []} />
      ) : null}
      {ties?.by_round ? <TieRoundsPanel rounds={ties.by_round} /> : null}
      {ties?.permutation_importance?.length ? (
        <TieFeaturesPanel rows={ties.permutation_importance} />
      ) : null}
      {ties?.method?.progression_check ? (
        <ProgressionPanel {...ties.method.progression_check} />
      ) : null}
      <DocsRow
        docs={[
          { doc: 'models', hash: '4-trophy--bracket-simulation', label: 'How the bracket simulation works' },
          { doc: 'artifacts', label: 'The files behind this page' },
        ]}
      />
    </div>
  )
}

function JoinPanel({ join }: { join: JoinReport }) {
  const unresolved = join.unresolved_count ?? 0
  const clubs = Object.entries(join.unresolved_clubs ?? {})

  return (
    <Panel
      title="Why the sample is this size"
      description="&ldquo;Not played yet&rdquo; and &ldquo;we no longer recognise this club&rdquo; both shrink the sample, and only one of them means something is broken."
    >
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Forecasts held" value={(join.snapshots ?? 0).toLocaleString()} />
        <StatTile label="Scored" value={(join.scored ?? 0).toLocaleString()} />
        <StatTile
          label="Not played yet"
          value={(join.awaiting_result ?? 0).toLocaleString()}
          tone="muted"
        />
        <StatTile
          label="Club not matched"
          value={unresolved.toLocaleString()}
          tone={unresolved ? 'accent' : 'muted'}
        />
      </dl>
      {clubs.length ? (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {clubs.map(([key, n]) => (
            <li
              key={key}
              className="rounded-md border border-[var(--border-color)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-tertiary)]"
            >
              {key} · {n}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          Every club in every published forecast matched a club in the results database.
        </p>
      )}
    </Panel>
  )
}

/**
 * Stated against observed, as a paired bar per band.
 *
 * Paired bars put the comparison in the shape: a calibrated band has two bars
 * the same length. A two-column table asks a reader to do that comparison
 * arithmetically, which is the one thing calibration is bad at in that form.
 */
function Reliability({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="mt-4 border-t border-[var(--border-color)] pt-4">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        What it said, against what happened
      </h3>
      <ul className="mt-3.5 space-y-3">
        {buckets.map((b) => (
          <li key={b.bin_low}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                {(b.bin_low * 100).toFixed(0)}–{(b.bin_high * 100).toFixed(0)}%
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {b.n.toLocaleString()} forecasts
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              <Paired label="Said" value={b.stated} tone="muted" />
              <Paired label="Happened" value={b.observed} tone="accent" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Paired({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'muted' | 'accent'
}) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-x-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
        <div
          className={cn(
            'h-full rounded-full',
            tone === 'accent' ? 'bg-[var(--accent-primary)]' : 'bg-[var(--text-tertiary)]',
          )}
          style={{ width: `${Math.max(2, Math.min(1, value) * 100)}%` }}
        />
      </div>
      <span className="text-right font-mono text-[11px] tabular-nums text-[var(--text-primary)]">
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  )
}
