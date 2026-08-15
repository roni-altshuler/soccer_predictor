'use client'

import { CalendarDays, MapPin, UserRound } from 'lucide-react'
import { useState } from 'react'

import { Formation } from '@/components/fixture/Formation'
import { TeamCrest } from '@/components/primitives/TeamCrest'
import { normTeam } from '@/lib/normTeam'
import type { MatchCard, StatRow, TimelineEvent } from '@/lib/server/tieFixtures'
import { cn } from '@/lib/utils'

/**
 * One match, in full — the same card for a league fixture and a knockout tie.
 *
 * It is ONE component on purpose. A reader who has learned to read a Premier
 * League match should not have to learn a second layout for a Champions League
 * one, and two components drift the moment either is touched. `/season/fixture`
 * and `/tournaments/tie` both render this; the only thing that differs is the
 * panel of our own forecast passed in as `model`.
 *
 * The shape follows the one every scoreboard product converged on, because it
 * answers the questions in the order they are asked: what was the score, who
 * scored, when did it happen, who played, how did it look, have they met
 * before.
 *
 *   header      competition and round, then the ground, the date and the
 *               referee, then the score with the scorers under it
 *   timeline    a centre line with the minute in a bubble, home to the left
 *               and away to the right, half-time marked where it fell
 *   stats       possession as one split bar; everything else as a value on
 *               each side of its label, the leading side lit
 *   lineups     both elevens on a pitch, in the shape they lined up in
 *   h2h         the previous meetings and each side's last five
 *   commentary  every entry, newest first
 *
 * Nothing is computed here that the source did not publish. A statistic only
 * one side reported is dropped rather than paired against a zero, and a tab
 * exists only when there is something behind it.
 */

const GOAL_TYPES = new Set(['goal', 'penalty-goal', 'own-goal'])

const KIND: Record<string, { mark: string; tone: string; label: string }> = {
  goal: { mark: '●', tone: 'text-[var(--text-primary)]', label: 'Goal' },
  'own-goal': { mark: '●', tone: 'text-[var(--accent-loss)]', label: 'Own goal' },
  'penalty-goal': { mark: '◉', tone: 'text-[var(--text-primary)]', label: 'Penalty' },
  'penalty-missed': { mark: '✕', tone: 'text-[var(--text-tertiary)]', label: 'Penalty missed' },
  'yellow-card': { mark: '▮', tone: 'text-[var(--accent-warn)]', label: 'Yellow card' },
  'red-card': { mark: '▮', tone: 'text-[var(--accent-loss)]', label: 'Red card' },
  'yellow-red-card': { mark: '▮', tone: 'text-[var(--accent-loss)]', label: 'Second yellow' },
  substitution: { mark: '⇄', tone: 'text-[var(--accent-primary)]', label: 'Substitution' },
}

const fallbackKind = { mark: '·', tone: 'text-[var(--text-tertiary)]', label: '' }

/** "Haaland 79', 90'" — one line per scorer, in the order they scored. */
export function scorerLines(
  events: TimelineEvent[],
  teamId: string,
): Array<{ name: string; minutes: string }> {
  const order: string[] = []
  const byPlayer = new Map<string, string[]>()
  for (const e of events) {
    if (!GOAL_TYPES.has(e.type) || e.teamId !== teamId) continue
    const name = e.players[0] ?? ''
    if (!name) continue
    if (!byPlayer.has(name)) {
      byPlayer.set(name, [])
      order.push(name)
    }
    byPlayer
      .get(name)!
      .push(`${e.minute}${e.type === 'penalty-goal' ? ' (pen)' : e.type === 'own-goal' ? ' (og)' : ''}`)
  }
  return order.map((name) => ({ name, minutes: byPlayer.get(name)!.join(', ') }))
}

function ScoreHeader({
  card,
  competitionId,
  heading,
  eliminated,
}: {
  card: MatchCard
  competitionId?: string
  heading?: string | null
  eliminated?: string | null
}) {
  // Matched on the normalised name because the tie comes from our artifact and
  // the card comes from ESPN, and the two spell clubs differently.
  const outName = eliminated ? normTeam(eliminated) : null
  const isOut = (name: string) => outName !== null && normTeam(name) === outName
  const meta = [
    card.date
      ? {
          icon: CalendarDays,
          text: new Date(card.date).toLocaleString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC',
          }),
        }
      : null,
    card.venue
      ? { icon: MapPin, text: [card.venue.name, card.venue.city].filter(Boolean).join(', ') }
      : null,
    card.officials.length ? { icon: UserRound, text: card.officials[0] } : null,
  ].filter(Boolean) as Array<{ icon: typeof MapPin; text: string }>

  return (
    <header className="border-b border-[var(--border-color)] px-4 pb-4 pt-4 md:px-5">
      {heading ? (
        <p className="text-center font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          {heading}
        </p>
      ) : null}

      {meta.length ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1">
          {meta.map(({ icon: Icon, text }) => (
            <span
              key={text}
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]"
            >
              <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{text}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Home, score, away — placed by column rather than by source order, so
          the score cannot drift into the away side's cell. */}
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 md:gap-4">
        <div
          data-side="home"
          data-out={isOut(card.home.name) ? 'true' : undefined}
          className="col-start-1 flex min-w-0 items-center gap-2.5"
        >
          <TeamCrest
            team={card.home.name}
            competitionId={competitionId}
            size="lg"
            className={isOut(card.home.name) ? 'opacity-40' : undefined}
          />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight md:text-[18px]',
              isOut(card.home.name)
                ? 'text-[var(--text-tertiary)] line-through decoration-1'
                : 'text-[var(--text-primary)]',
            )}
          >
            {card.home.name}
          </span>
        </div>

        <div className="col-start-2 px-1 text-center">
          {/* A match with no score yet gets "vs", not "– - –". Two dashes
              where a scoreline belongs reads as data we failed to load
              rather than as a match that has not kicked off. */}
          {card.home.score === null && card.away.score === null ? (
            <div
              data-score="pending"
              className="font-mono text-[15px] uppercase leading-none tracking-[0.14em] text-[var(--text-tertiary)] md:text-[17px]"
            >
              vs
            </div>
          ) : (
            <div
              data-score="final"
              className="font-mono text-[26px] leading-none tabular-nums text-[var(--text-primary)] md:text-[32px]"
            >
              {card.home.score ?? '–'}
              <span className="mx-1.5 text-[var(--text-tertiary)]">-</span>
              {card.away.score ?? '–'}
            </div>
          )}
          <div className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            {card.statusDetail || (card.state === 'pre' ? 'Not started' : '')}
          </div>
        </div>

        <div
          data-side="away"
          data-out={isOut(card.away.name) ? 'true' : undefined}
          className="col-start-3 flex min-w-0 flex-row-reverse items-center gap-2.5"
        >
          <TeamCrest
            team={card.away.name}
            competitionId={competitionId}
            size="lg"
            className={isOut(card.away.name) ? 'opacity-40' : undefined}
          />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-right text-[15px] font-semibold leading-tight md:text-[18px]',
              isOut(card.away.name)
                ? 'text-[var(--text-tertiary)] line-through decoration-1'
                : 'text-[var(--text-primary)]',
            )}
          >
            {card.away.name}
          </span>
        </div>
      </div>

      {(['home', 'away'] as const).some((w) => scorerLines(card.events, card[w].id).length) ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {(['home', 'away'] as const).map((which) => (
            <ul
              key={which}
              data-scorers={which}
              className={cn('space-y-0.5', which === 'away' && 'text-right')}
            >
              {scorerLines(card.events, card[which].id).map((s) => (
                <li key={s.name} className="truncate text-[11.5px] text-[var(--text-secondary)]">
                  {s.name}{' '}
                  <span className="font-mono text-[var(--text-tertiary)]">{s.minutes}</span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      ) : null}
    </header>
  )
}

/**
 * The timeline, down a centre line.
 *
 * Home to the left and away to the right, so which side did what is read from
 * position rather than from a colour — the same reason every probability on
 * this site is rendered as text.
 */
function Timeline({ card }: { card: MatchCard }) {
  return (
    <ol className="relative space-y-3 py-1">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--border-color)]"
      />
      {card.events.map((e) => {
        const k = KIND[e.type] ?? fallbackKind
        const home = e.teamId === card.home.id
        return (
          <li key={e.id} data-event={e.type} className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {/* Both cells are pinned to row 1. Without that, an away event —
                which starts in column 3 — pushes the minute bubble onto a
                second row and the two drift apart vertically. */}
            <div
              className={cn(
                'row-start-1 min-w-0',
                home ? 'col-start-1 text-right' : 'col-start-3 text-left',
              )}
            >
              <p className="truncate text-[12px] leading-tight text-[var(--text-primary)]">
                <span className={cn('mr-1.5 text-[10px]', k.tone)} aria-hidden="true">
                  {k.mark}
                </span>
                <span className="sr-only">{k.label ? `${k.label}. ` : ''}</span>
                {e.players[0] || e.short}
              </p>
              {e.players[1] ? (
                <p className="truncate text-[10.5px] leading-tight text-[var(--text-tertiary)]">
                  {e.type === 'substitution' ? 'for ' : 'assist '}
                  {e.players[1]}
                </p>
              ) : null}
            </div>
            <span className="col-start-2 row-start-1 flex h-6 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] font-mono text-[10px] tabular-nums text-[var(--text-secondary)]">
              {e.minute}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Stats({ card }: { card: MatchCard }) {
  const [lead, rest] = [card.stats[0], card.stats.slice(1)]
  return (
    <div>
      {lead ? (
        <div data-stat={lead.name}>
          <p className="text-center text-[11px] text-[var(--text-tertiary)]">{lead.label}</p>
          <div className="mt-2 flex h-6 w-full overflow-hidden rounded-md">
            <span
              className="flex items-center justify-start bg-[var(--accent-primary)] pl-2 font-mono text-[11px] tabular-nums text-[var(--accent-on-primary)]"
              style={{ width: `${barSplit(lead)}%` }}
            >
              {lead.home}
            </span>
            <span
              className="flex flex-1 items-center justify-end bg-[var(--accent-info)] pr-2 font-mono text-[11px] tabular-nums text-[var(--accent-on-primary)]"
            >
              {lead.away}
            </span>
          </div>
        </div>
      ) : null}

      <ul className={cn('space-y-2.5', lead && 'mt-5')}>
        {rest.map((s) => {
          const h = s.homeValue
          const a = s.awayValue
          return (
            <li
              key={s.name}
              data-stat={s.name}
              className="grid grid-cols-[3.5rem_1fr_3.5rem] items-center gap-2"
            >
              <span
                className={cn(
                  'font-mono text-[12.5px] tabular-nums',
                  h !== null && a !== null && h > a
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)]',
                )}
              >
                {s.home}
              </span>
              <span className="truncate text-center text-[11px] text-[var(--text-tertiary)]">
                {s.label}
              </span>
              <span
                className={cn(
                  'text-right font-mono text-[12.5px] tabular-nums',
                  h !== null && a !== null && a > h
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)]',
                )}
              >
                {s.away}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Where the split bar breaks. Falls back to even when the pair is not numeric. */
export function barSplit(s: StatRow): number {
  const h = s.homeValue
  const a = s.awayValue
  if (h === null || a === null || h + a <= 0) return 50
  return Math.min(92, Math.max(8, (h / (h + a)) * 100))
}

function HeadToHead({ card }: { card: MatchCard }) {
  const names: Record<string, string> = {
    [card.home.id]: card.home.name,
    [card.away.id]: card.away.name,
  }
  return (
    <div className="space-y-6">
      {card.headToHead ? (
        <div>
          {card.headToHead.summary ? (
            <p className="text-center text-[12px] text-[var(--text-secondary)]">
              {card.headToHead.summary}
            </p>
          ) : null}
          <ul className="mt-3 space-y-2">
            {card.headToHead.meetings.map((m) => (
              <li key={m.id} data-meeting={m.id} className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2.5">
                <span
                  className={cn(
                    'min-w-0 truncate text-right text-[12px]',
                    m.home.winner ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
                  )}
                >
                  {m.home.name}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-[var(--text-primary)]">
                  {m.home.score ?? '–'}
                  <span className="mx-1 text-[var(--text-tertiary)]">-</span>
                  {m.away.score ?? '–'}
                </span>
                <span
                  className={cn(
                    'min-w-0 truncate text-[12px]',
                    m.away.winner ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
                  )}
                >
                  {m.away.name}
                </span>
                <span className="col-span-3 text-center font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
                  {[m.date, m.competition].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.form.some((f) => f.games.length) ? (
        <div className="grid gap-5 sm:grid-cols-2">
          {card.form
            .filter((f) => f.games.length)
            .map((f) => (
              <div key={f.teamId} data-form-team={f.teamId}>
                <h4 className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  {names[f.teamId] ?? 'Recent form'}
                </h4>
                <ul className="mt-2 space-y-1.5">
                  {f.games.map((g) => (
                    <li key={g.id} className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border font-mono text-[9px]',
                          g.result === 'W'
                            ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                            : g.result === 'L'
                              ? 'border-[var(--accent-loss)] text-[var(--accent-loss)]'
                              : 'border-[var(--accent-warn)] text-[var(--accent-warn)]',
                        )}
                      >
                        {g.result}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-secondary)]">
                        <span className="text-[var(--text-tertiary)]">{g.atVs} </span>
                        {g.opponent}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                        {g.score}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  )
}

function Commentary({ lines }: { lines: MatchCard['commentary'] }) {
  const [all, setAll] = useState(false)
  const shown = all ? lines : lines.slice(0, 14)
  return (
    <div>
      <ol className="space-y-2.5">
        {shown.map((c) => (
          <li key={c.sequence} className="flex items-baseline gap-2.5">
            <span className="w-9 shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">
              {c.minute}
            </span>
            <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              {c.text}
            </span>
          </li>
        ))}
      </ol>
      {lines.length > 14 ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-3 min-h-[32px] rounded-md border border-[var(--border-color)] px-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          {all ? 'Show less' : `All ${lines.length} entries`}
        </button>
      ) : null}
    </div>
  )
}

export function MatchDetail({
  card,
  competitionId,
  heading,
  model,
  eliminated,
  className,
}: {
  card: MatchCard
  competitionId?: string
  /** Competition and round, printed above the score. */
  heading?: string | null
  /** Our own forecast for this match, shown first. Optional by design: a
   *  competition we do not forecast still gets the whole card. */
  model?: React.ReactNode
  /** The club that went out of the tournament on this result, if any. Struck
   *  through, exactly as the bracket draws it. A league fixture never passes
   *  it, which is the only difference between the two pages' cards. */
  eliminated?: string | null
  className?: string
}) {
  // Every count is of CONTENT, never of the container that holds it. ESPN
  // files both team sheets as empty shells before kickoff, so counting
  // `lineups.length` opened a Lineups tab on every upcoming fixture and
  // rendered two club names above nothing at all.
  const tabs: Array<[string, number]> = [
    ['Timeline', card.events.length],
    ['Stats', card.stats.length],
    ['Lineups', card.lineups.filter((l) => l.starters.length).length],
    ['H2H', (card.headToHead?.meetings.length ?? 0) + card.form.filter((f) => f.games.length).length],
    ['Commentary', card.commentary.length],
  ]
  const available = tabs.filter(([, n]) => n > 0).map(([t]) => t)
  const [tab, setTab] = useState<string>('Timeline')
  const active = available.includes(tab) ? tab : available[0]

  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className,
      )}
    >
      <ScoreHeader
        card={card}
        competitionId={competitionId}
        heading={heading}
        eliminated={eliminated}
      />

      {model ? <div className="border-b border-[var(--border-color)] px-4 py-4 md:px-5">{model}</div> : null}

      {available.length ? (
        <>
          <div
            role="tablist"
            aria-label="Match detail"
            className="flex gap-4 overflow-x-auto border-b border-[var(--border-color)] px-4 [scrollbar-width:none] md:px-5 [&::-webkit-scrollbar]:hidden"
          >
            {available.map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={t === active}
                onClick={() => setTab(t)}
                className={cn(
                  'min-h-[38px] shrink-0 border-b-2 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors',
                  t === active
                    ? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                )}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="px-4 py-4 md:px-5 md:py-5">
            {active === 'Timeline' ? (
              <Timeline card={card} />
            ) : active === 'Stats' ? (
              <Stats card={card} />
            ) : active === 'Lineups' ? (
              <Formation
                lineups={card.lineups}
                homeName={card.home.name}
                awayName={card.away.name}
                events={card.events}
              />
            ) : active === 'H2H' ? (
              <HeadToHead card={card} />
            ) : (
              <Commentary lines={card.commentary} />
            )}
          </div>
        </>
      ) : (
        <p className="px-4 py-4 text-[12px] leading-relaxed text-[var(--text-tertiary)] md:px-5">
          {card.state === 'pre'
            ? 'Team sheets and commentary appear about an hour before kickoff.'
            : 'No timeline, stats or team sheets were published for this match.'}
        </p>
      )}
    </section>
  )
}
