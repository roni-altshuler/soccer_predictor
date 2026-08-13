'use client'

import { useMemo, useState } from 'react'

import { CompetitionSelect } from '@/components/forecast/CompetitionSelect'
import { BracketBoard } from '@/components/tournament/BracketBoard'
import type { BracketRound } from '@/components/tournament/BracketBoard'
import { TournamentStandings } from '@/components/tournament/TournamentStandings'
import { tournamentRank } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

/**
 * Pick a tournament, then a season, and see the bracket and who wins it.
 *
 * The artifact used to carry one entry per competition. It now carries the
 * last eight EDITIONS of each, so this is two choices and not one — and
 * flattening them back into a single list is what broke the page: fourteen
 * competitions arrived as seventy-nine listbox rows, six of them reading
 * "UEFA Champions League" and differing only in the year, all sharing one
 * `competition_id`. React warned about the duplicate keys and picking the
 * 2021 edition selected the 2025 one, because the lookup matched on
 * competition alone. Competition picks the tournament; the season row picks
 * the edition within it.
 *
 * A tournament can be in five states, and they are not interchangeable:
 *
 *   upcoming           the draw is made and NONE of it has been played. The
 *                      only state where these are odds on something undecided,
 *                      and the reason this page exists.
 *   in_progress        some ties are settled. Those are held at their real
 *                      winner and only the remainder is simulated.
 *   completed          nothing left to predict, so what is shown is the call
 *                      the model made BEFORE the knockout stage, next to the
 *                      result. A record, never dressed up as a prediction.
 *   awaiting_draw      matches remain but the round is only part drawn, so
 *                      there is no path to a trophy to simulate and NO odds —
 *                      only a rating table, labelled as a power ranking.
 *   not_reconstructed  finished, and the bracket below is real, but it could
 *                      not be paired into a tree so no forecast was made.
 *
 * The last two used to be one status, and that was wrong in a way a reader
 * would catch: the 2020-21 Champions League is over — Chelsea won it on
 * 2021-05-29 and the bracket prints every round of it — and the page said
 * "Draw not made" above it.
 *
 * The bracket sits ABOVE the title odds deliberately. Advancing a tie is the
 * quantity this model is actually measured on (64.8%, calibrated); a title is
 * that compounded over four rounds plus an assumption about how the later
 * rounds get drawn.
 */

export interface TitleOdds {
  team_id: number
  team: string
  probability: number
  elo: number
}

export type TournamentStatus =
  | 'upcoming'
  | 'in_progress'
  | 'completed'
  | 'awaiting_draw'
  | 'awaiting_fixtures'
  | 'not_reconstructed'
  | 'insufficient_history'

export interface TournamentForecast {
  competition_id: string
  name: string
  region: string
  season: number
  /** The edition this competition opens on — live if there is one, else last. */
  is_current?: boolean
  status: TournamentStatus
  bracket?: BracketRound[]
  last_match?: string
  field?: number
  current_round?: string
  draw_known_to?: string
  forecast_made_at_round?: string
  forecast_from?: string
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
  awaiting_fixtures: { label: 'Next up', tone: 'text-[var(--accent-primary)]' },
  not_reconstructed: { label: 'Finished · not forecast', tone: 'text-[var(--text-tertiary)]' },
  insufficient_history: { label: 'Not enough history', tone: 'text-[var(--text-tertiary)]' },
}

const statusCopy = (s: string) => STATUS_COPY[s] ?? STATUS_COPY.completed

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

interface Competition {
  id: string
  name: string
  region: string
  /** Newest first — the order the season row is offered in. */
  editions: TournamentForecast[]
  current: TournamentForecast
}

/**
 * One entry per competition, each carrying its editions newest first.
 *
 * `is_current` is the artifact's own answer to "which edition is this
 * competition right now" and it is not simply the newest season: a
 * competition whose next edition already has a qualifying tie in the books
 * would otherwise open on a tournament that has barely started. Falling back
 * to the newest only when the flag is absent keeps an older artifact working.
 */
function groupByCompetition(tournaments: TournamentForecast[]): Competition[] {
  const byId = new Map<string, TournamentForecast[]>()
  for (const t of tournaments) {
    const list = byId.get(t.competition_id)
    if (list) list.push(t)
    else byId.set(t.competition_id, [t])
  }

  const comps: Competition[] = []
  for (const [id, list] of byId) {
    const editions = [...list].sort((a, b) => b.season - a.season)
    const current = editions.find((e) => e.is_current) ?? editions[0]
    comps.push({ id, name: current.name, region: current.region, editions, current })
  }

  // Ordered by the competition, NOT by what its current edition happens to be
  // doing. Sorting live-first reads well in the abstract and badly in practice:
  // most of the calendar has some minor competition mid-flight, so the
  // Champions League spent most of the year below the Sudamericana. A reader
  // opening this page came for a competition, and the live ones are still
  // marked with a dot — see TOURNAMENT_COMPETITION_IDS for the order itself.
  return comps.sort((a, b) => tournamentRank(a.id) - tournamentRank(b.id))
}

export function TournamentPicker({
  tournaments,
  className,
}: {
  tournaments: TournamentForecast[]
  className?: string
}) {
  const comps = useMemo(() => groupByCompetition(tournaments), [tournaments])

  const [selectedId, setSelectedId] = useState<string>(comps[0]?.id ?? '')
  // Null means "whichever edition is current", so switching competition lands
  // on the live one rather than on whatever year happened to be chosen last.
  const [season, setSeason] = useState<number | null>(null)

  const competition = comps.find((c) => c.id === selectedId) ?? comps[0]
  const edition =
    (season !== null ? competition?.editions.find((e) => e.season === season) : null) ??
    competition?.current

  const options = useMemo(
    () =>
      comps.map((c) => ({
        id: c.id,
        name: c.name,
        subtitle: `${c.current.season} · ${statusCopy(c.current.status).label}`,
        live: c.current.status === 'upcoming' || c.current.status === 'in_progress',
      })),
    [comps],
  )

  if (!comps.length || !competition || !edition) return null

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

      <CompetitionSelect
        className="mt-3.5"
        kind="Tournament"
        options={options}
        value={competition.id}
        onChange={(id) => {
          setSelectedId(id)
          setSeason(null)
        }}
      />

      <SeasonRow
        competition={competition}
        selected={edition.season}
        onSelect={(s) => setSeason(s)}
      />

      <Forecast tournament={edition} />
    </section>
  )
}

/**
 * The season explorer.
 *
 * Kept as a visible row rather than a second dropdown: there are at most eight
 * editions and which years exist is itself information — a World Cup every
 * four years and a Champions League every one look different at a glance, and
 * a second listbox would hide that behind a click.
 */
function SeasonRow({
  competition,
  selected,
  onSelect,
}: {
  competition: Competition
  selected: number
  onSelect: (season: number) => void
}) {
  if (competition.editions.length < 2) return null

  return (
    <div className="mt-3.5">
      <div
        role="group"
        aria-label={`${competition.name} season`}
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {competition.editions.map((e) => {
          const active = e.season === selected
          return (
            <button
              key={e.season}
              type="button"
              onClick={() => onSelect(e.season)}
              aria-pressed={active}
              className={cn(
                'shrink-0 rounded-md border px-2.5 py-1.5 font-mono text-[11px] tabular-nums transition-colors',
                active
                  ? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
                  : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
              )}
            >
              {e.season}
              {e.is_current ? (
                <span className="ml-1.5 uppercase tracking-[0.08em] text-[var(--accent-primary)]">
                  now
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Forecast({ tournament: t }: { tournament: TournamentForecast }) {
  const status = statusCopy(t.status)
  const live = t.status === 'upcoming' || t.status === 'in_progress'
  const noForecast = t.status === 'awaiting_draw' || t.status === 'not_reconstructed'

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
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          The bracket for this edition has not been drawn in full, so there is no path to a
          trophy to simulate and no title odds to give. What follows is a rating table — a
          power ranking, not a forecast.
        </p>
      ) : null}

      {t.status === 'awaiting_fixtures' ? (
        <>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
            This edition has not started. Its fixtures are published, but the knockout
            draw has not been made — and a bracket is a field of teams, so there is
            nothing here to forecast yet. No odds are shown rather than odds built on
            last season&apos;s entrants.
          </p>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[var(--text-tertiary)]">
            The bracket and the title odds appear here automatically on the first run
            after the draw lands. Nothing needs to be switched on.
          </p>
        </>
      ) : null}

      {t.status === 'not_reconstructed' ? (
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          This edition is finished and the bracket below is what happened. Its rounds could
          not be paired into a single tree, so no forecast was made for it and there are no
          title odds to show — a result, not a call.
        </p>
      ) : null}

      {t.status === 'insufficient_history' ? (
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          {t.reason ?? 'There was not enough earlier history to fit a model for this edition.'}{' '}
          The bracket below is the result; no forecast was made.
        </p>
      ) : null}

      {t.bracket?.length ? (
        <BracketBoard rounds={t.bracket} competitionId={t.competition_id} />
      ) : null}

      {noForecast && t.power_ranking?.length ? (
        <div className="mt-5">
          <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Power ranking
          </h4>
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
        </div>
      ) : null}

      {t.odds?.length ? (
        <>
          <h4 className="mt-6 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            {live ? 'Who lifts it' : 'What it said beforehand'}
          </h4>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            {live ? (
              <>
                Each undecided tie above run forward 8,000 times.{' '}
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
        </>
      ) : null}

      {!t.bracket?.length && !t.odds?.length && !t.power_ranking?.length ? (
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          {t.reason ?? 'No forecast is available for this edition.'}
        </p>
      ) : null}

      {/*
        The table that produced the bracket, shown with the competition it
        belongs to rather than at a destination of its own. Renders nothing
        when the edition has no group stage on record.
      */}
      <TournamentStandings competitionId={t.competition_id} season={t.season} />

      <NextEdition tournament={t} />
    </div>
  )
}

/**
 * What is known about the edition after this one.
 *
 * Three states, and the third is the one that used to be silent. A finished
 * competition with no published fixtures for its next edition said nothing at
 * all, so between one final and the next draw — three months, on the
 * competitions readers ask about most — the page showed last season's result
 * and left a reader to guess whether anything was coming.
 */
function NextEdition({ tournament: t }: { tournament: TournamentForecast }) {
  const finished =
    t.status === 'completed' ||
    t.status === 'not_reconstructed' ||
    t.status === 'insufficient_history'

  if (t.next_fixture && t.next_fixture.season > t.season) {
    return (
      <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
        Next up: {t.next_fixture.fixtures} fixtures of the {t.next_fixture.season} edition,
        beginning{' '}
        <span className="text-[var(--text-secondary)]">{fmtDate(t.next_fixture.starts)}</span>.
        Pick it from the seasons above; the bracket and odds appear there once the
        knockout draw is made.
      </p>
    )
  }

  // Only for an edition that is over. A live one has its own fixtures and
  // saying "nothing published" beside it would be false.
  if (!finished) return null

  return (
    <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
      No fixtures for the next edition have been published yet, so there is nothing to
      show for it — not even a start date. This page picks them up on the first run
      after the fixture list appears, and the bracket follows when the draw is made.
    </p>
  )
}
