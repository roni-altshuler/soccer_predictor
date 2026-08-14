'use client'

import { LeagueMark } from '@/components/primitives'
import { FloorBars } from '@/components/evidence/FloorBars'
import { MetricRow, Panel, StatTile } from '@/components/evidence/primitives'
import type { CallRecord, EditionCall } from '@/components/evidence/tournamentCalls'
import { getLeagueAccent } from '@/lib/leagueAccents'
import type { LeagueAccuracySummary } from '@/lib/types/accuracy'
import { cn } from '@/lib/utils'

import { ALWAYS_HOME_RATE, MIN_LEAGUE_SAMPLE, RANDOM_WINNER_RATE } from './accuracyMetrics'

/**
 * One competition's published record.
 *
 * `/accuracy` reported a single pooled hit rate over every league at once,
 * which is an average of things that differ by six points and is nobody's
 * question — a reader wants the Premier League's record, or MLS's. It is
 * organised per competition now, the same way `/evaluation` is, and the two
 * pages take the same shape on purpose: one control, one competition, then
 * what is genuinely pooled under a heading that says so.
 *
 * The floors are the point of both panels. A 53% hit rate on three-way match
 * outcomes is above a blind guess (33%) and above backing the home side (43%);
 * a tournament favourite lifting it a third of the time is well above the
 * field. Neither number means anything without the floor beside it.
 */

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const pct0 = (v: number) => `${(v * 100).toFixed(0)}%`

function CompetitionHeading({ id }: { id: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <LeagueMark league={id} size="sm" />
      <span className="truncate text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
        {getLeagueAccent(id).displayName}
      </span>
    </span>
  )
}

export function LeagueAccuracy({ id, row }: { id: string; row: LeagueAccuracySummary | null }) {
  if (!row || row.total === 0) {
    return (
      <Panel title="Published picks" right={<CompetitionHeading id={id} />}>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
          No pick in this competition has been settled yet. Nothing is estimated in its
          place.
        </p>
      </Panel>
    )
  }

  const thin = row.total < MIN_LEAGUE_SAMPLE

  return (
    <div className="space-y-6">
      <Panel
        title="Published picks"
        right={<CompetitionHeading id={id} />}
        description={`Every pick this site published in ${getLeagueAccent(id).displayName}, scored against the final result.`}
      >
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Called the result" value={pct(row.accuracy)} size="lead" />
          <StatTile label="Settled picks" value={row.total.toLocaleString()} />
          <StatTile
            label="Brier"
            value={Number.isFinite(row.brier_score) ? row.brier_score.toFixed(4) : '—'}
          />
          <StatTile
            label="Calibration gap"
            value={
              Number.isFinite(row.expected_calibration_error)
                ? row.expected_calibration_error.toFixed(4)
                : '—'
            }
          />
        </dl>

        {/* Hit rate against the two floors anyone would actually use. Drawn
            from the same numbers the rest of the surface uses, so a reader who
            has seen one page has seen them all. */}
        <div className="mt-4 border-t border-[var(--border-color)] pt-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Called the result · higher is better
          </p>
          <div className="space-y-2.5">
            <MetricRow
              label="This model"
              value={pct(row.accuracy)}
              fraction={row.accuracy}
              tone="accent"
            />
            <MetricRow
              label="Backing the home side every time"
              value={pct(ALWAYS_HOME_RATE)}
              fraction={ALWAYS_HOME_RATE}
              tone="muted"
            />
            <MetricRow
              label="A blind one-in-three guess"
              value={pct(RANDOM_WINNER_RATE)}
              fraction={RANDOM_WINNER_RATE}
              tone="muted"
            />
          </div>
        </div>

        {thin ? (
          <p className="mt-4 border-t border-[var(--border-color)] pt-3.5 text-[12px] leading-relaxed text-[var(--accent-warn)]">
            {row.total} settled picks is below the sample this page will draw a verdict
            from. The rate above is real; it is not yet evidence of anything.
          </p>
        ) : null}
      </Panel>

      {row.scoreline_accuracy > 0 ? (
        <Panel
          title="Exact scorelines"
          description="The hardest thing on the site to get right — one result in about eight is the most likely exact score there is."
        >
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <StatTile label="Exact score called" value={pct(row.scoreline_accuracy)} />
            <StatTile
              label="Log loss"
              value={Number.isFinite(row.log_loss) ? row.log_loss.toFixed(4) : '—'}
            />
          </dl>
        </Panel>
      ) : null}
    </div>
  )
}

/**
 * A knockout competition's call record.
 *
 * Labelled a backtest wherever it appears, because it is one: the forecast for
 * a 2021 edition was reconstructed by a model refit on the seasons before it.
 * It is honest and it is not something a reader could have acted on, and this
 * site does not let those two blur.
 */
export function TournamentAccuracy({
  id,
  record,
  calls,
}: {
  id: string
  record: CallRecord | null
  calls: EditionCall[]
}) {
  if (!record) {
    return (
      <Panel title="Calls at the knockout stage" right={<CompetitionHeading id={id} />}>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
          No settled edition of this competition carries a forecast, so there is no record
          to show.
        </p>
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      <Panel
        title="Calls at the knockout stage"
        right={<CompetitionHeading id={id} />}
        description="The forecast as it stood at the first knockout round, against who lifted it. Refit on earlier seasons only — a backtest, not something published in advance."
      >
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Called it outright" value={pct0(record.calledRate)} size="lead" />
          <StatTile label="Editions" value={String(record.editions)} />
          <StatTile label="Mean chance on the winner" value={pct0(record.meanP)} />
          <StatTile label="Log loss" value={record.logLoss.toFixed(3)} />
        </dl>

        <div className="mt-4 border-t border-[var(--border-color)] pt-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            What it gave the eventual champion
          </p>
          <FloorBars
            digits={3}
            rows={calls.map((c) => ({
              label: `${c.season} · ${c.champion}`,
              value: c.p,
              subject: c.calledIt,
              note: c.calledIt ? 'favourite' : undefined,
            }))}
          />
          <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Longer is better here — this is probability, not error
          </p>
        </div>
      </Panel>
    </div>
  )
}

/** The pooled call record, across every knockout competition at once. */
export function PooledCallRecord({
  record,
  competitions,
}: {
  record: CallRecord | null
  competitions: number
}) {
  if (!record) return null

  return (
    <Panel
      title="Every competition at once"
      description="Pooled across the knockout layer. A competition's own record is above, because these differ enormously by field size."
    >
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Called it outright" value={pct0(record.calledRate)} size="lead" />
        <StatTile label="Editions" value={String(record.editions)} />
        <StatTile label="Competitions" value={String(competitions)} />
        <StatTile label="Mean chance on the winner" value={pct0(record.meanP)} />
      </dl>
      {record.best && record.worst ? (
        <div className="mt-4 grid gap-3 border-t border-[var(--border-color)] pt-4 sm:grid-cols-2">
          <Extreme label="Most confident correct call" call={record.best} />
          <Extreme label="Biggest surprise" call={record.worst} />
        </div>
      ) : null}
    </Panel>
  )
}

function Extreme({ label, call }: { label: string; call: EditionCall }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px] text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">{call.champion}</span>{' '}
          {call.season}
        </span>
        <span
          className={cn(
            'shrink-0 font-mono text-[12px] tabular-nums',
            call.calledIt ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]',
          )}
        >
          {pct0(call.p)}
        </span>
      </div>
      <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {getLeagueAccent(call.competitionId).displayName}
      </div>
    </div>
  )
}
