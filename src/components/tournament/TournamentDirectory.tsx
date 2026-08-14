'use client'

import { ArrowRight } from 'lucide-react'
import { useMemo } from 'react'

import { LeagueMark } from '@/components/primitives'
import type { TournamentForecast } from '@/components/tournament/TournamentPicker'
import { getLeagueAccent, tournamentRank } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

/**
 * The tournaments directory — fourteen competitions, each as what it is doing.
 *
 * The page opened straight into a picker: one dropdown, one competition, and
 * no way to see that the other thirteen existed without opening it. That is a
 * control, not a home page. A reader arriving here wants to know what is on —
 * which competition is mid-flight, who is favourite for it, which one starts
 * next — and only then to go into one.
 *
 * So each competition is a card carrying the state of its current edition and
 * the number that state makes meaningful:
 *
 *   live / upcoming     the title odds, as bars — a 24/18/12 field and a
 *                       61/9/6 field read identically as a list of numbers
 *   awaiting_fixtures   when it starts and how many fixtures are published
 *   finished            who won it, and what the model had said beforehand
 *   undrawn / unpaired  the refusal, stated, with no number attached
 *
 * Ordered by competition rather than by what its edition happens to be doing.
 * Sorting live-first reads well in the abstract and badly across a calendar:
 * some minor competition is nearly always mid-flight, so the Champions League
 * would spend most of the year below it. Live editions carry a dot instead.
 */

const STATE: Record<string, { label: string; tone: string; live?: boolean }> = {
  upcoming: { label: 'Starting now', tone: 'text-[var(--accent-primary)]', live: true },
  in_progress: { label: 'In progress', tone: 'text-[var(--accent-primary)]', live: true },
  awaiting_fixtures: { label: 'Next up', tone: 'text-[var(--accent-primary)]' },
  awaiting_draw: { label: 'Draw not made', tone: 'text-[var(--accent-warn)]' },
  completed: { label: 'Finished', tone: 'text-[var(--text-tertiary)]' },
  not_reconstructed: { label: 'Finished', tone: 'text-[var(--text-tertiary)]' },
  insufficient_history: { label: 'Not enough history', tone: 'text-[var(--text-tertiary)]' },
}

const state = (s: string) => STATE[s] ?? STATE.completed

const pct = (v: number) => `${(v * 100).toFixed(0)}%`

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

interface Entry {
  id: string
  name: string
  current: TournamentForecast
  editions: number
}

function directory(tournaments: TournamentForecast[]): Entry[] {
  const byId = new Map<string, TournamentForecast[]>()
  for (const t of tournaments) {
    const list = byId.get(t.competition_id)
    if (list) list.push(t)
    else byId.set(t.competition_id, [t])
  }

  const out: Entry[] = []
  for (const [id, list] of byId) {
    const editions = [...list].sort((a, b) => b.season - a.season)
    // `is_current` is the artifact's own answer to "which edition is this
    // competition right now", and it is not simply the newest season.
    const current = editions.find((e) => e.is_current) ?? editions[0]
    out.push({ id, name: current.name, current, editions: editions.length })
  }
  return out.sort((a, b) => tournamentRank(a.id) - tournamentRank(b.id))
}

export function TournamentDirectory({
  tournaments,
  onOpen,
  className,
}: {
  tournaments: TournamentForecast[]
  onOpen: (competitionId: string) => void
  className?: string
}) {
  const entries = useMemo(() => directory(tournaments), [tournaments])
  const liveCount = entries.filter((e) => state(e.current.status).live).length

  if (!entries.length) return null

  return (
    <section className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Every competition
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          {entries.length} competitions
          {liveCount ? ` · ${liveCount} under way` : ''}
        </span>
      </div>

      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <li key={entry.id}>
            <CompetitionCard entry={entry} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function CompetitionCard({
  entry,
  onOpen,
}: {
  entry: Entry
  onOpen: (competitionId: string) => void
}) {
  const t = entry.current
  const s = state(t.status)
  const accent = getLeagueAccent(entry.id)

  return (
    <button
      type="button"
      onClick={() => onOpen(entry.id)}
      className="group flex h-full w-full flex-col rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent-primary)_35%,var(--border-color))]"
    >
      <div className="flex items-start gap-3">
        <LeagueMark league={entry.id} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-[var(--text-primary)]">
            {entry.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--text-tertiary)]">
            <span className="truncate">{t.region || accent.country}</span>
            <span className="font-mono tabular-nums">{t.season}</span>
          </div>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        {s.live ? (
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]"
          />
        ) : null}
        <span className={cn('font-mono text-[10px] uppercase tracking-[0.1em]', s.tone)}>
          {s.label}
        </span>
        {t.field ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            · {t.field} left in
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex-1">
        <CardBody tournament={t} />
      </div>

      {entry.editions > 1 ? (
        <div className="mt-3 border-t border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] pt-2.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          {entry.editions} editions on file
        </div>
      ) : null}
    </button>
  )
}

/**
 * What the card actually says, which depends entirely on the state.
 *
 * Every branch here is a different claim, and the one thing none of them does
 * is put a number where there is no forecast. A percentage on an undrawn
 * competition would be read as odds on it.
 */
function CardBody({ tournament: t }: { tournament: TournamentForecast }) {
  if (t.status === 'awaiting_fixtures') {
    return (
      <div>
        <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
          Fixtures published, draw not made.
        </p>
        {t.next_fixture ? (
          <p className="mt-1.5 font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">
            {t.next_fixture.fixtures} fixtures · from {fmtDate(t.next_fixture.starts)}
          </p>
        ) : null}
      </div>
    )
  }

  if (t.status === 'awaiting_draw' || t.status === 'not_reconstructed') {
    return (
      <p className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">
        {t.status === 'awaiting_draw'
          ? 'No full bracket to simulate, so no title odds are given.'
          : 'The result is on file; its rounds could not be paired into a tree.'}
      </p>
    )
  }

  const live = t.status === 'upcoming' || t.status === 'in_progress'

  // Finished: who won, and what the model had said about them beforehand.
  if (!live && t.actual_champion) {
    return (
      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          Won it
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
            {t.actual_champion}
          </span>
          {t.probability_on_actual != null ? (
            <span
              className={cn(
                'shrink-0 font-mono text-[12px] tabular-nums',
                t.called_it ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]',
              )}
            >
              {pct(t.probability_on_actual)}
            </span>
          ) : null}
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          {t.called_it ? 'the model made them favourite' : 'what the model gave them'}
        </div>
      </div>
    )
  }

  const odds = (t.odds ?? []).slice(0, 3)
  if (!odds.length) {
    return (
      <p className="text-[12px] leading-relaxed text-[var(--text-tertiary)]">
        No title odds published for this edition.
      </p>
    )
  }

  const leader = odds[0]
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        Who lifts it
      </div>
      <ul className="mt-2 space-y-1.5">
        {odds.map((o) => (
          <li key={o.team_id} className="grid grid-cols-[1fr_2.2rem] items-center gap-x-2">
            <div className="min-w-0">
              <div
                className={cn(
                  'truncate text-[12px]',
                  o === leader
                    ? 'font-semibold text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]',
                )}
              >
                {o.team}
              </div>
              <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(3, (o.probability / (leader?.probability || 1)) * 100)}%`,
                    background:
                      o === leader
                        ? 'var(--accent-primary)'
                        : 'color-mix(in srgb, var(--text-tertiary) 70%, transparent)',
                  }}
                />
              </div>
            </div>
            <span className="text-right font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
              {pct(o.probability)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
