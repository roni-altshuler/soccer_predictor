'use client'

import { cn } from '@/lib/utils'

/**
 * The trophy claim, and every tournament behind it.
 *
 * Getting a tie right and getting the champion right are different
 * achievements: a side the model likes at 70% per round is only a 24%
 * champion. So this panel reports the simulation, not the picks — log loss on
 * the team that actually won, against two yardsticks a reader can hold.
 *
 * The per-tournament list is shown in full rather than summarised. A hit rate
 * of "one in three" invites the question "which three", and the answer is
 * short enough to print.
 */

export interface BracketEvent {
  competition: string
  season: number
  field: number
  model_p: number
  elo_p: number
  uniform_p: number
  model_top1_hit: number
  elo_leader_hit: number
  model_top3_hit: number
}

export interface BracketSummary {
  n_tournaments: number
  log_loss: { model: number; elo_simulation: number; uniform: number }
  top1_hit_rate: { model: number; highest_rated: number }
  top3_hit_rate: { model: number }
}

const COMPETITION_LABELS: Record<string, string> = {
  'uefa.champions': 'Champions League',
  'uefa.europa': 'Europa League',
  'uefa.conference': 'Conference League',
  'fifa.world': 'World Cup',
  'uefa.euro': 'Euros',
  'conmebol.america': 'Copa América',
  'conmebol.libertadores': 'Copa Libertadores',
  'conmebol.sudamericana': 'Copa Sudamericana',
  'caf.nations': 'Africa Cup of Nations',
  'afc.asian': 'AFC Asian Cup',
  'concacaf.gold': 'Gold Cup',
  'concacaf.champions': 'CONCACAF Champions Cup',
  'fifa.cwc': 'Club World Cup',
  'uefa.nations': 'Nations League',
}

const label = (id: string) => COMPETITION_LABELS[id] ?? id

export function BracketRecord({
  summary,
  events,
  className,
}: {
  summary: BracketSummary
  events: BracketEvent[]
  className?: string
}) {
  const hits = events.filter((e) => e.model_top1_hit === 1)
  const sorted = [...events].sort((a, b) => b.season - a.season)

  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5',
        className,
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Who lifts the trophy
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          {summary.n_tournaments} tournaments simulated
        </span>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Called the winner"
          value={`${(summary.top1_hit_rate.model * 100).toFixed(1)}%`}
          note={`vs ${(summary.top1_hit_rate.highest_rated * 100).toFixed(1)}% for the highest-rated team`}
          accent
        />
        <Stat
          label="Winner in its top 3"
          value={`${(summary.top3_hit_rate.model * 100).toFixed(1)}%`}
          note="of a field of 8 to 32"
        />
        <Stat
          label="Log loss on the champion"
          value={summary.log_loss.model.toFixed(3)}
          note={`vs ${summary.log_loss.elo_simulation.toFixed(3)} rating-only, ${summary.log_loss.uniform.toFixed(3)} blind`}
        />
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        Every tournament is simulated 20,000 times from the first knockout round, with the
        model refit on the seasons strictly before it — never on the tournament it is
        predicting. It named the eventual winner outright in{' '}
        <span className="text-[var(--text-primary)]">
          {hits.length} of {events.length}
        </span>
        .
      </p>

      <div className="mt-5 border-t border-[var(--border-color)] pt-4">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Every tournament, and what it said
        </h3>
        <div className="mt-3 max-h-[26rem] overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse font-mono text-[12px] tabular-nums">
            <thead className="sticky top-0 bg-[var(--card-bg)]">
              <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                <th className="pb-1.5 pr-3 font-medium">Tournament</th>
                <th className="pb-1.5 pr-3 text-right font-medium">Field</th>
                <th className="pb-1.5 pr-3 text-right font-medium">P(winner)</th>
                <th className="pb-1.5 text-right font-medium">Called it</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr
                  key={`${e.competition}-${e.season}`}
                  className="border-t border-[var(--border-color)]"
                >
                  <td className="py-1.5 pr-3 text-[var(--text-secondary)]">
                    {label(e.competition)}{' '}
                    <span className="text-[var(--text-tertiary)]">{e.season}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[var(--text-tertiary)]">
                    {e.field}
                  </td>
                  <td
                    className={cn(
                      'py-1.5 pr-3 text-right',
                      e.model_p >= e.uniform_p
                        ? 'text-[var(--text-primary)]'
                        : 'text-[var(--text-tertiary)]',
                    )}
                  >
                    {(e.model_p * 100).toFixed(1)}%
                  </td>
                  <td className="py-1.5 text-right">
                    {e.model_top1_hit === 1 ? (
                      <span className="text-[var(--accent-primary)]">yes</span>
                    ) : e.model_top3_hit === 1 ? (
                      <span className="text-[var(--accent-warn)]">top 3</span>
                    ) : (
                      <span className="text-[var(--text-tertiary)]">no</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          P(winner) is the probability the model gave the team that actually won, before the
          knockout stage started. UEFA drew the Champions League quarter-finals and
          semi-finals openly before 2023-24, so for those seasons the bracket is held fixed
          rather than redrawn — which understates the spread slightly.
        </p>
      </div>
    </section>
  )
}

function Stat({
  label: text,
  value,
  note,
  accent,
}: {
  label: string
  value: string
  note: string
  accent?: boolean
}) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-hover)] px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
        {text}
      </div>
      <div
        className={cn(
          'mt-1 font-mono text-[22px] tabular-nums',
          accent ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-tertiary)]">{note}</div>
    </div>
  )
}
