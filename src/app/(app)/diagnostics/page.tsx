import { EmptyState } from '@/components/EmptyState'
import { getLeagueAccent } from '@/lib/leagueAccents'

import {
  type CompetitionCoverage,
  coveragePercent,
  groupByGender,
  loadCoverage,
  seasonLabel,
  seasonsNewestFirst,
} from './coverage'

/**
 * /diagnostics — the timeline-coverage report. For every competition and
 * season: how many completed matches have a minute-by-minute timeline that
 * was verified against the final score, and how many are still missing.
 *
 * Server component over the committed coverage artifact (no warehouse on
 * Vercel). Honesty first: a missing artifact renders an empty state, an
 * uncovered match is shown as missing — never estimated, never filled in.
 */

export const metadata = {
  title: 'Data Coverage | Pitchwise',
  description:
    'How much of the match history carries a verified minute-by-minute timeline, competition by competition and season by season.',
}

function displayName(comp: CompetitionCoverage): string {
  const accent = getLeagueAccent(comp.competition_id)
  if (accent.competitionId !== 'unknown') return accent.displayName
  return comp.name ?? comp.competition_id
}

/** Shared grid template so summary rows and the header line up. */
const GRID =
  'grid grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_4.5rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_4.5rem_5.5rem]'

function CoverageMeter({ ratio }: { ratio: number }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]">
        <span
          className="block h-full rounded-full bg-[var(--accent-primary)]"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--text-primary)]">
        {coveragePercent(ratio)}
      </span>
    </span>
  )
}

function HeaderRow() {
  return (
    <div
      className={`${GRID} border-b border-[var(--border-color)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]`}
      aria-hidden
    >
      <span>Competition</span>
      <span className="text-right">Matches</span>
      <span className="hidden text-right sm:block">Verified</span>
      <span className="hidden text-right sm:block" title="Goalless matches verified with an empty timeline">
        Goalless
      </span>
      <span className="text-right">Missing</span>
      <span className="hidden sm:block">Coverage</span>
    </div>
  )
}

function SeasonTable({ comp }: { comp: CompetitionCoverage }) {
  const seasons = seasonsNewestFirst(comp.seasons)
  if (seasons.length === 0) return null
  return (
    <div className="overflow-x-auto border-t border-[var(--border-color)] bg-[var(--background)]/40 px-3 py-2">
      <table className="w-full min-w-[26rem] text-[12px]">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            <th scope="col" className="py-1 pr-2 font-semibold">Season</th>
            <th scope="col" className="py-1 pr-2 text-right font-semibold">Matches</th>
            <th scope="col" className="py-1 pr-2 text-right font-semibold">Verified</th>
            <th scope="col" className="py-1 pr-2 text-right font-semibold" title="Goalless matches verified with an empty timeline">
              Goalless
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-semibold">Missing</th>
            <th scope="col" className="py-1 text-right font-semibold">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((s) => (
            <tr key={s.season} className="border-t border-[var(--border-color)]/50">
              <td className="py-1 pr-2 tabular-nums text-[var(--text-secondary)]">
                {seasonLabel(s.season)}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-secondary)]">
                {s.matches.toLocaleString()}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-secondary)]">
                {s.covered.toLocaleString()}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-tertiary)]">
                {s.verified_empty.toLocaleString()}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-tertiary)]">
                {s.uncovered.toLocaleString()}
              </td>
              <td className="py-1 text-right font-semibold tabular-nums text-[var(--text-primary)]">
                {coveragePercent(s.coverage)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CompetitionRow({ comp }: { comp: CompetitionCoverage }) {
  return (
    <details className="group">
      <summary
        className={`${GRID} min-h-[44px] cursor-pointer list-none px-3 py-2 transition-colors hover:bg-[var(--card-hover)] [&::-webkit-details-marker]:hidden`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="text-[10px] text-[var(--text-tertiary)] transition-transform group-open:rotate-90"
          >
            ▶
          </span>
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {displayName(comp)}
          </span>
        </span>
        <span className="text-right text-[13px] tabular-nums text-[var(--text-secondary)]">
          {comp.matches.toLocaleString()}
        </span>
        <span className="hidden text-right text-[13px] tabular-nums text-[var(--text-secondary)] sm:block">
          {comp.covered.toLocaleString()}
        </span>
        <span className="hidden text-right text-[13px] tabular-nums text-[var(--text-tertiary)] sm:block">
          {comp.verified_empty.toLocaleString()}
        </span>
        <span className="text-right text-[13px] tabular-nums text-[var(--text-tertiary)]">
          {comp.uncovered.toLocaleString()}
        </span>
        <span className="hidden sm:block">
          <CoverageMeter ratio={comp.coverage} />
        </span>
      </summary>
      <SeasonTable comp={comp} />
    </details>
  )
}

function CoverageGroup({ title, competitions }: { title: string; competitions: CompetitionCoverage[] }) {
  if (competitions.length === 0) return null
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
        <HeaderRow />
        <div className="divide-y divide-[var(--border-color)]/50">
          {competitions.map((comp) => (
            <CompetitionRow key={comp.competition_id} comp={comp} />
          ))}
        </div>
      </div>
    </section>
  )
}

export default function DiagnosticsPage() {
  const artifact = loadCoverage()

  if (!artifact || artifact.totals.matches === 0) {
    return (
      <div className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-4">
        <h1 className="px-1 text-xl font-bold text-[var(--text-primary)]">Data coverage</h1>
        <div className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
          <EmptyState
            title="No coverage report yet"
            description="The timeline-coverage summary hasn't been generated. Once it is, this page shows exactly which competitions and seasons carry verified minute-by-minute timelines."
          />
        </div>
      </div>
    )
  }

  const { totals } = artifact
  const { men, women } = groupByGender(artifact.competitions)
  const countedOn = new Date(artifact.generated_at)
  const countedOnLabel = Number.isNaN(countedOn.getTime())
    ? null
    : countedOn.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="mx-auto w-full max-w-4xl px-3 pb-12 pt-4 sm:px-4">
      {/* Data-first title — no hero */}
      <div className="mb-4 px-1">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Data coverage</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-[var(--text-secondary)]">
          Historical answers are only as good as the record behind them. This is that record:
          how many completed matches carry a minute-by-minute timeline verified against the
          final score — and how many don&apos;t yet.
        </p>
      </div>

      {/* Totals strip */}
      <div className="mb-5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-4xl font-bold tabular-nums tracking-tight text-[var(--text-primary)]">
            {coveragePercent(totals.coverage)}
          </span>
          <p className="text-sm tabular-nums text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">
              {totals.covered.toLocaleString()} of {totals.matches.toLocaleString()}
            </span>{' '}
            completed matches have a verified timeline
          </p>
        </div>
        <div className="mt-3">
          <CoverageMeter ratio={totals.coverage} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed tabular-nums text-[var(--text-tertiary)]">
          {totals.verified_empty.toLocaleString()} of the verified matches are goalless games
          whose timelines are genuinely empty — they count as covered.{' '}
          {totals.uncovered.toLocaleString()} matches remain without a timeline and are shown
          as missing, never estimated.
          {countedOnLabel ? <> Counted on {countedOnLabel}.</> : null}
        </p>
      </div>

      <div className="space-y-6">
        <CoverageGroup title="Men's competitions" competitions={men} />
        <CoverageGroup title="Women's competitions" competitions={women} />
      </div>

      <p className="mt-8 px-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        A timeline is verified only when its goal events reproduce the final score exactly;
        anything less is discarded and the match stays in the missing column. Expand a
        competition for the season-by-season record. Educational only.
      </p>
    </div>
  )
}
