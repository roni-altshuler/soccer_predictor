'use client'

import { LeagueMark } from '@/components/primitives'
import { DocsRow } from '@/components/evidence/DocsLink'
import { MetricRow, Panel, StatTile } from '@/components/evidence/primitives'
import {
  baselineRows,
  type LeagueMeasured,
  type TrophyRecord,
} from '@/components/evidence/competitionRecords'
import { getLeagueAccent, isCovered } from '@/lib/leagueAccents'

/**
 * One competition's evidence.
 *
 * The page these live on answers "what did the model believe here, and how did
 * that belief score" — for one league, or one tournament, at a time. The
 * football itself is elsewhere: a reader who wants the table or the bracket is
 * on `/leagues` or `/tournaments`, and neither of those pages argues about
 * Brier any more.
 *
 * Two shapes, because the two layers are measured on different questions and
 * against different floors. A three-way match forecast is read against 1/3 and
 * a knockout tie against 1/2, so the components never share an axis.
 */

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

function CompetitionHeading({ id }: { id: string }) {
  const accent = getLeagueAccent(id)
  return (
    <span className="flex min-w-0 items-center gap-2">
      <LeagueMark league={id} size="sm" />
      <span className="truncate text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
        {accent.displayName}
      </span>
    </span>
  )
}

/**
 * What the model believed in one league, and what that was worth.
 *
 * The baselines are the point of the panel rather than a footnote to it. A
 * Brier of .583 means nothing on its own; .583 against a .667 blind guess and a
 * .643 base rate is the whole claim, and it is the same test the league had to
 * pass to appear on the site at all.
 */
export function LeagueEvidence({
  id,
  measured,
  live,
}: {
  id: string
  measured: LeagueMeasured | null
  live: { n: number; brier: number | null; note?: string } | null
}) {
  const accent = getLeagueAccent(id)
  const rows = measured ? baselineRows(measured) : []
  const worst = Math.max(...rows.map((r) => r.value), 1e-9)

  return (
    <div className="space-y-6">
      <Panel
        title="What it believed"
        right={<CompetitionHeading id={id} />}
        description={`Walk-forward over ${accent.displayName} alone — never shown a match before predicting it.`}
      >
        {!measured || !Number.isFinite(measured.brier ?? NaN) ? (
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
            No measured block has been published for this competition. Nothing is
            estimated in its place.
          </p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile label="Brier" value={measured.brier!.toFixed(5)} size="lead" />
              <StatTile label="Log loss" value={measured.log_loss?.toFixed(5) ?? '—'} />
              <StatTile
                label="Picked the result"
                value={measured.accuracy != null ? pct(measured.accuracy) : '—'}
              />
              <StatTile
                label="Matches scored"
                value={(measured.n_scored ?? 0).toLocaleString()}
              />
            </dl>

            {rows.length > 1 ? (
              <div className="mt-4 border-t border-[var(--border-color)] pt-4">
                <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                  Same fixtures · lower is better
                </p>
                <div className="space-y-2.5">
                  {rows.map((r) => (
                    <MetricRow
                      key={r.label}
                      label={r.label}
                      value={r.value.toFixed(5)}
                      fraction={r.value / worst}
                      tone={r.isModel ? 'accent' : 'muted'}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              {isCovered(id) ? 'Also scored against the closing line' : 'No closing price here · never scored against the market'}
            </p>
          </>
        )}
      </Panel>

      <Panel
        title="What it has published here"
        right={
          live?.n ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              {live.n.toLocaleString()} scored
            </span>
          ) : null
        }
      >
        {live?.n && live.brier != null ? (
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <StatTile label="Brier" value={live.brier.toFixed(5)} size="lead" />
            <StatTile label="Forecasts scored" value={live.n.toLocaleString()} />
          </dl>
        ) : live?.n ? (
          // Scored, but the artifact declined to put a number on it. A rate
          // from four fixtures is noise, and printing it next to a
          // forty-thousand-match backtest would give it the same weight.
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
            {live.n.toLocaleString()} forecast{live.n === 1 ? '' : 's'} scored here — too few
            to score, so no rate is published for this competition yet.
          </p>
        ) : (
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
            Nothing scored here yet. The record above is retrospective — the two are never
            added together.
          </p>
        )}
      </Panel>

      <DocsRow
        docs={[
          { doc: 'models', hash: '1-match-outcome--dixon-coles', label: 'How the match model works' },
          { doc: 'scoring', label: 'What these numbers mean' },
        ]}
      />
    </div>
  )
}

export interface TieRecordRow {
  n: number
  accuracy: number
  brier?: number
}

/**
 * What the model believed in one knockout competition.
 *
 * The trophy record is per competition because `bracket_backtest.json` carries
 * one row per reconstructed tournament. The TIE record is only per competition
 * when the artifact was generated with `by_competition` — older ones have the
 * pooled figure and nothing else, so this renders that half only when it is
 * genuinely there.
 */
export function TournamentEvidence({
  id,
  trophy,
  tie,
}: {
  id: string
  trophy: TrophyRecord | null
  tie: TieRecordRow | null
}) {
  const accent = getLeagueAccent(id)
  const ladder = trophy
    ? [
        { label: 'This model', v: trophy.logLoss, tone: 'accent' as const },
        { label: 'An unfitted Elo simulation', v: trophy.eloLogLoss, tone: 'muted' as const },
        { label: 'Uniform over the field', v: trophy.uniformLogLoss, tone: 'muted' as const },
      ].filter((r) => Number.isFinite(r.v))
    : []
  const worst = Math.max(...ladder.map((r) => r.v), 1e-9)

  return (
    <div className="space-y-6">
      <Panel
        title="Who it made favourite, and who lifted it"
        right={<CompetitionHeading id={id} />}
        description={
          trophy
            ? `${trophy.editions} edition${trophy.editions === 1 ? '' : 's'} simulated to a champion, each by a model refit only on earlier seasons.`
            : undefined
        }
      >
        {!trophy ? (
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
            No edition of this competition has been backtested to a champion, so nothing
            is claimed about it.
          </p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile
                label="Log loss on the winner"
                value={trophy.logLoss.toFixed(4)}
                size="lead"
              />
              <StatTile label="Called it outright" value={pct(trophy.top1)} />
              <StatTile label="Had it in its top three" value={pct(trophy.top3)} />
              <StatTile label="Editions" value={String(trophy.editions)} />
            </dl>

            {ladder.length > 1 ? (
              <div className="mt-4 border-t border-[var(--border-color)] pt-4">
                <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                  Probability put on the eventual winner · lower is better
                </p>
                <div className="space-y-2.5">
                  {ladder.map((r) => (
                    <MetricRow
                      key={r.label}
                      label={r.label}
                      value={r.v.toFixed(4)}
                      fraction={r.v / worst}
                      tone={r.tone}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--border-color)] pt-4">
              <StatTile
                label="Backing the highest-rated side"
                value={pct(trophy.eloTop1)}
                tone="muted"
              />
              <StatTile
                label="Mean chance given to the winner"
                value={pct(trophy.meanP)}
                tone="muted"
              />
            </dl>
          </>
        )}
      </Panel>

      {tie && tie.n > 0 ? (
        <Panel
          title="Ties in this competition"
          right={
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              {tie.n.toLocaleString()} ties
            </span>
          }
          description="Who advances, one tie at a time. The floor is a coin flip."
        >
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatTile label="Picked the winner" value={pct(tie.accuracy)} size="lead" />
            <StatTile
              label="Brier"
              value={tie.brier != null ? tie.brier.toFixed(4) : '—'}
              sub="coin flip = .2500"
            />
            <StatTile label="Ties scored" value={tie.n.toLocaleString()} />
          </dl>
        </Panel>
      ) : null}

      <DocsRow
        docs={[
          { doc: 'models', hash: '3-knockout-tie--random-forest', label: 'How the tie model works' },
          { doc: 'tutorialBracket', label: 'How to read a bracket' },
        ]}
      />
    </div>
  )
}
