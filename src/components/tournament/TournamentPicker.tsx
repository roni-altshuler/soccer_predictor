'use client'

import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Pick a tournament, see who the model thinks wins it.
 *
 * The same shape as the league pages — choose a competition, get its forecast
 * — with one thing the league pages do not have to worry about: a tournament
 * can be in three different states, and they are not interchangeable.
 *
 *   live            matches remain; the odds are a forecast of something
 *                   genuinely undecided
 *   completed       nothing left to predict, so what is shown is the call the
 *                   model made BEFORE the knockout stage, next to the result.
 *                   Shown as a record, never dressed up as a prediction.
 *   awaiting_draw   no bracket exists yet. There is no path to a trophy to
 *                   simulate, so there are NO odds — only a rating table,
 *                   labelled as a power ranking.
 *
 * That last state is the one worth protecting. It would be easy, and wrong, to
 * fill it with last edition's field and print confident-looking percentages.
 */

export interface TitleOdds {
  team_id: number
  team: string
  probability: number
  elo: number
}

export interface TournamentForecast {
  competition_id: string
  name: string
  region: string
  season: number
  status: 'live' | 'completed' | 'awaiting_draw' | 'insufficient_history'
  last_match?: string
  field?: number
  forecast_made_at_round?: string
  forecast_from?: string
  odds?: TitleOdds[]
  power_ranking?: { team_id: number; team: string; elo: number }[]
  actual_champion?: string
  actual_champion_id?: number
  probability_on_actual?: number
  called_it?: boolean
  reason?: string
}

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  live: { label: 'In progress', tone: 'text-[var(--accent-primary)]' },
  completed: { label: 'Finished', tone: 'text-[var(--text-tertiary)]' },
  awaiting_draw: { label: 'Draw not made', tone: 'text-[var(--accent-warn)]' },
  insufficient_history: { label: 'Not enough history', tone: 'text-[var(--text-tertiary)]' },
}

export function TournamentPicker({
  tournaments,
  className,
}: {
  tournaments: TournamentForecast[]
  className?: string
}) {
  const ordered = useMemo(() => {
    const rank = { live: 0, awaiting_draw: 1, completed: 2, insufficient_history: 3 }
    return [...tournaments].sort(
      (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name),
    )
  }, [tournaments])

  const [selected, setSelected] = useState<string>(ordered[0]?.competition_id ?? '')
  const active = ordered.find((t) => t.competition_id === selected) ?? ordered[0]

  if (!ordered.length) return null

  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5',
        className,
      )}
    >
      <header>
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Pick a tournament
        </h2>
        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
          Trained on every previous edition, asked about the next one. Where a tournament is
          still running these are live odds; where it has finished, they are the call the
          model made before the knockout stage began, shown next to what happened.
        </p>
      </header>

      <div className="mt-3.5 flex flex-wrap gap-1.5" role="tablist" aria-label="Tournaments">
        {ordered.map((t) => {
          const isActive = t.competition_id === active?.competition_id
          return (
            <button
              key={t.competition_id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSelected(t.competition_id)}
              className={cn(
                'rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors',
                isActive
                  ? 'border-[var(--accent-primary)] bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
              )}
            >
              {t.name}
            </button>
          )
        })}
      </div>

      {active ? <Forecast tournament={active} /> : null}
    </section>
  )
}

function Forecast({ tournament: t }: { tournament: TournamentForecast }) {
  const status = STATUS_COPY[t.status] ?? STATUS_COPY.completed

  return (
    <div className="mt-5 border-t border-[var(--border-color)] pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
          {t.name} <span className="text-[var(--text-tertiary)]">{t.season}</span>
        </h3>
        <span
          className={cn(
            'font-mono text-[10px] uppercase tracking-[0.1em]',
            status.tone,
          )}
        >
          {status.label}
          {t.field ? ` · field of ${t.field}` : ''}
        </span>
      </div>

      {t.status === 'awaiting_draw' ? (
        <>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            The bracket for this edition has not been drawn, so there is no path to a trophy
            to simulate and no title odds to give. What follows is a rating table — a power
            ranking, not a forecast.
          </p>
          {t.power_ranking?.length ? (
            <ol className="mt-3 space-y-1.5">
              {t.power_ranking.slice(0, 10).map((r, i) => (
                <li
                  key={r.team_id}
                  className="grid grid-cols-[1.5rem_1fr_auto] items-baseline gap-x-2 font-mono text-[12px] tabular-nums"
                >
                  <span className="text-[var(--text-tertiary)]">{i + 1}</span>
                  <span className="truncate font-sans text-[13px] text-[var(--text-secondary)]">
                    {r.team}
                  </span>
                  <span className="text-[var(--text-tertiary)]">{r.elo.toFixed(0)}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : t.odds?.length ? (
        <>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            {t.status === 'live'
              ? 'Simulated 20,000 times from the current state of the bracket. Ties already played are fixed; the rest are resimulated every run.'
              : `The forecast as it stood at the ${t.forecast_made_at_round ?? 'first knockout round'}${
                  t.forecast_from ? `, ${t.forecast_from}` : ''
                } — before any of it was played, and fitted only on earlier seasons.`}
          </p>

          <ol className="mt-3.5 space-y-2">
            {t.odds.slice(0, 12).map((o) => {
              const isChampion = t.actual_champion_id === o.team_id
              return (
                <li
                  key={o.team_id}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-x-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          'truncate text-[13px]',
                          isChampion
                            ? 'font-semibold text-[var(--text-primary)]'
                            : 'text-[var(--text-secondary)]',
                        )}
                      >
                        {o.team}
                      </span>
                      {isChampion ? (
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--accent-primary)]">
                          won it
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          isChampion
                            ? 'bg-[var(--accent-primary)]'
                            : 'bg-[var(--text-tertiary)]',
                        )}
                        style={{
                          width: `${Math.max(2, (o.probability / (t.odds?.[0]?.probability || 1)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span
                    className={cn(
                      'font-mono text-[13px] tabular-nums',
                      isChampion
                        ? 'text-[var(--accent-primary)]'
                        : 'text-[var(--text-secondary)]',
                    )}
                  >
                    {(o.probability * 100).toFixed(1)}%
                  </span>
                </li>
              )
            })}
          </ol>

          {t.status === 'completed' && t.actual_champion ? (
            <p className="mt-4 border-t border-[var(--border-color)] pt-3.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              {t.called_it ? (
                <>
                  Its favourite was{' '}
                  <span className="text-[var(--accent-primary)]">{t.actual_champion}</span>,
                  and {t.actual_champion} won it.
                </>
              ) : (
                <>
                  It made <span className="text-[var(--text-primary)]">{t.odds[0].team}</span>{' '}
                  the favourite.{' '}
                  <span className="text-[var(--text-primary)]">{t.actual_champion}</span> won
                  it, from{' '}
                  <span className="text-[var(--text-primary)]">
                    {((t.probability_on_actual ?? 0) * 100).toFixed(1)}%
                  </span>
                  .
                </>
              )}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          {t.reason ?? 'No forecast is available for this edition.'}
        </p>
      )}
    </div>
  )
}
