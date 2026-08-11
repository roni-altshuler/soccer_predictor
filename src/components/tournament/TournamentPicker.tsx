'use client'

import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Pick a tournament, see who the model thinks wins it.
 *
 * The same shape as the league pages — choose a competition, get its forecast
 * — with one thing the league pages do not have to worry about: a tournament
 * can be in four different states, and they are not interchangeable.
 *
 *   upcoming        the draw is made and NONE of it has been played. The only
 *                   state where these are odds on something undecided, and the
 *                   reason this page exists.
 *   in_progress     some ties are settled. Those are held at their real
 *                   winner and only the remainder is simulated.
 *   completed       nothing left to predict, so what is shown is the call the
 *                   model made BEFORE the knockout stage, next to the result.
 *                   Shown as a record, never dressed up as a prediction.
 *   awaiting_draw   no bracket exists yet. There is no path to a trophy to
 *                   simulate, so there are NO odds — only a rating table,
 *                   labelled as a power ranking.
 *
 * That last state is the one worth protecting. It would be easy, and wrong, to
 * fill it with last edition's field and print confident-looking percentages.
 *
 * The per-tie table shown for a live round is deliberately above the title
 * odds. Advancing a tie is the quantity this model is actually measured on
 * (64.8%, calibrated); a title is that compounded over four rounds plus an
 * assumption about how the later rounds get drawn.
 */

export interface TitleOdds {
  team_id: number
  team: string
  probability: number
  elo: number
}

export interface TieForecast {
  round: string
  team_a: string
  team_b: string
  team_a_id: number
  team_b_id: number
  p_team_a: number
  kickoff: string
  decided: string | null
}

export interface TournamentForecast {
  competition_id: string
  name: string
  region: string
  season: number
  status: 'upcoming' | 'in_progress' | 'completed' | 'awaiting_draw' | 'insufficient_history'
  last_match?: string
  field?: number
  current_round?: string
  draw_known_to?: string
  forecast_made_at_round?: string
  forecast_from?: string
  ties?: TieForecast[]
  odds?: TitleOdds[]
  power_ranking?: { team_id: number; team: string; elo: number }[]
  actual_champion?: string
  actual_champion_id?: number
  probability_on_actual?: number
  called_it?: boolean
  reason?: string
  next_fixture?: { season: number; starts: string; fixtures: number }
}

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  upcoming: { label: 'Starting now', tone: 'text-[var(--accent-primary)]' },
  in_progress: { label: 'In progress', tone: 'text-[var(--accent-primary)]' },
  completed: { label: 'Finished', tone: 'text-[var(--text-tertiary)]' },
  awaiting_draw: { label: 'Draw not made', tone: 'text-[var(--accent-warn)]' },
  insufficient_history: { label: 'Not enough history', tone: 'text-[var(--text-tertiary)]' },
}

const RANK = {
  upcoming: 0,
  in_progress: 1,
  awaiting_draw: 2,
  completed: 3,
  insufficient_history: 4,
} as const

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

export function TournamentPicker({
  tournaments,
  className,
}: {
  tournaments: TournamentForecast[]
  className?: string
}) {
  const ordered = useMemo(
    () =>
      [...tournaments].sort(
        (a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.name.localeCompare(b.name),
      ),
    [tournaments],
  )

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
          Trained on every previous edition, asked about the next one. A tournament that is
          still to be played gets odds; one that has finished shows the call the model made
          before a ball was kicked, next to what happened.
        </p>
      </header>

      <div className="mt-3.5 flex flex-wrap gap-1.5" role="tablist" aria-label="Tournaments">
        {ordered.map((t) => {
          const isActive = t.competition_id === active?.competition_id
          const isLive = t.status === 'upcoming' || t.status === 'in_progress'
          return (
            <button
              key={t.competition_id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setSelected(t.competition_id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors',
                isActive
                  ? 'border-[var(--accent-primary)] bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
              )}
            >
              {isLive ? (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]"
                />
              ) : null}
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
  const live = t.status === 'upcoming' || t.status === 'in_progress'

  return (
    <div className="mt-5 border-t border-[var(--border-color)] pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
          {t.name} <span className="text-[var(--text-tertiary)]">{t.season}</span>
        </h3>
        <span className={cn('font-mono text-[10px] uppercase tracking-[0.1em]', status.tone)}>
          {status.label}
          {t.field ? ` · ${t.field} left in` : ''}
        </span>
      </div>

      {t.status === 'awaiting_draw' ? (
        <>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            The bracket for this edition has not been drawn, so there is no path to a trophy
            to simulate and no title odds to give. What follows is a rating table — a power
            ranking, not a forecast.
          </p>
          <NextEdition tournament={t} />
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
          {live && t.ties?.length ? <TieTable tournament={t} /> : null}

          <h4
            className={cn(
              'font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]',
              live && t.ties?.length ? 'mt-6' : 'mt-4',
            )}
          >
            {live ? 'Who lifts it' : 'What it said beforehand'}
          </h4>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            {live ? (
              <>
                Each tie above run forward 20,000 times.{' '}
                <span className="text-[var(--text-tertiary)]">
                  Only the {t.draw_known_to ?? 'current round'} is drawn, so every later round
                  is paired by a fresh random draw — which spreads the odds slightly wider
                  than a seeded bracket would.
                </span>
              </>
            ) : (
              `The forecast as it stood at the ${t.forecast_made_at_round ?? 'first knockout round'}${
                t.forecast_from ? `, ${fmtDate(t.forecast_from)}` : ''
              } — before any of it was played, and fitted only on earlier seasons.`
            )}
          </p>

          <ol className="mt-3.5 space-y-2">
            {t.odds.slice(0, 12).map((o) => {
              const isChampion = t.actual_champion_id === o.team_id
              return (
                <li key={o.team_id} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3">
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
                          isChampion ? 'bg-[var(--accent-primary)]' : 'bg-[var(--text-tertiary)]',
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
                      isChampion ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]',
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
                  <span className="text-[var(--accent-primary)]">{t.actual_champion}</span>, and{' '}
                  {t.actual_champion} won it.
                </>
              ) : (
                <>
                  It made <span className="text-[var(--text-primary)]">{t.odds[0].team}</span> the
                  favourite. <span className="text-[var(--text-primary)]">{t.actual_champion}</span>{' '}
                  won it, from{' '}
                  <span className="text-[var(--text-primary)]">
                    {((t.probability_on_actual ?? 0) * 100).toFixed(1)}%
                  </span>
                  .
                </>
              )}
            </p>
          ) : null}

          {t.status === 'completed' ? <NextEdition tournament={t} /> : null}
        </>
      ) : (
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          {t.reason ?? 'No forecast is available for this edition.'}
        </p>
      )}
    </div>
  )
}

/**
 * The round that is actually about to be played. This is the number with the
 * least assumption behind it on the page — a drawn tie, a trained model, and a
 * measured 64.8% hit rate — so it goes first.
 */
function TieTable({ tournament: t }: { tournament: TournamentForecast }) {
  return (
    <>
      <h4 className="mt-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {t.current_round ?? 'This round'} — who goes through
      </h4>
      <ul className="mt-3 space-y-2.5">
        {t.ties?.map((tie) => {
          const favouredA = tie.p_team_a >= 0.5
          const pct = favouredA ? tie.p_team_a : 1 - tie.p_team_a
          return (
            <li key={`${tie.team_a_id}-${tie.team_b_id}`}>
              <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                <span>{fmtDate(tie.kickoff)}</span>
                {tie.decided ? <span>{tie.decided} went through</span> : null}
              </div>
              <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-x-2">
                <span
                  className={cn(
                    'truncate text-right text-[13px]',
                    favouredA ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
                  )}
                >
                  {tie.team_a}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-[var(--accent-primary)]">
                  {(pct * 100).toFixed(0)}%
                </span>
                <span
                  className={cn(
                    'truncate text-[13px]',
                    favouredA ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]',
                  )}
                >
                  {tie.team_b}
                </span>
              </div>
              <div className="mt-1.5 flex h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
                <div
                  className="h-full bg-[var(--accent-primary)]"
                  style={{ width: `${tie.p_team_a * 100}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function NextEdition({ tournament: t }: { tournament: TournamentForecast }) {
  if (!t.next_fixture || t.next_fixture.season <= t.season) return null
  return (
    <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
      Next up: {t.next_fixture.fixtures} fixtures of the {t.next_fixture.season} edition,
      beginning <span className="text-[var(--text-secondary)]">{fmtDate(t.next_fixture.starts)}</span>
      . Odds appear here once the knockout draw is made.
    </p>
  )
}
