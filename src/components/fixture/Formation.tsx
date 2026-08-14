'use client'

import type { Lineup, LineupPlayer, TimelineEvent } from '@/lib/server/tieFixtures'
import { cn } from '@/lib/utils'

/**
 * Both starting elevens, in their real shapes, on one pitch.
 *
 * The formation is not decoration: `4-2-3-1` against `4-4-2` is most of what a
 * reader wants from a team sheet, and a flat list of eleven names cannot show
 * it. ESPN publishes the formation string and a `formationPlace` per player, so
 * the shape is READ rather than inferred — splitting `4-3-3` gives the rows and
 * `formationPlace` orders the players into them.
 *
 * **Players are shirt numbers, not faces.** Every provider that shows portraits
 * licences them; ESPN has a headshot for one player in forty-six. A number is
 * the thing on the actual shirt, it is complete, and it is what a reader uses
 * to find someone on a broadcast — so it is the identity here rather than a
 * grid of grey silhouettes pretending to be photographs.
 *
 * When the formation string and the eleven disagree — a sheet that says 4-4-2
 * and lists ten players — the pitch is abandoned for the list. A shape drawn
 * from numbers that do not add up is a wrong claim about how a team lined up.
 */

/** `4-2-3-1` → `[1, 4, 2, 3, 1]`: the keeper, then each outfield band. */
export function formationRows(formation: string | null, starters: number): number[] | null {
  if (!formation) return null
  const bands = formation.split('-').map((n) => Number(n.trim()))
  if (!bands.length || bands.some((n) => !Number.isInteger(n) || n < 1 || n > 6)) return null
  const rows = [1, ...bands]
  if (rows.reduce((a, b) => a + b, 0) !== starters) return null
  return rows
}

/** Deal the starters into the bands, in `formationPlace` order. */
export function dealRows(players: LineupPlayer[], rows: number[]): LineupPlayer[][] {
  const out: LineupPlayer[][] = []
  let i = 0
  for (const n of rows) {
    out.push(players.slice(i, i + n))
    i += n
  }
  return out
}

/**
 * What a pitch token calls a player.
 *
 * ESPN's own `shortName` ("V. Júnior", "A. Becker") when it has one, and the
 * full name otherwise. It is deliberately NOT derived: dropping the first token
 * gives "Júnior" for Vinícius Júnior, which is not what anyone calls him — the
 * rule that works for European surnames fails for Brazilian and Spanish ones,
 * and a name nobody recognises is worse than a long one.
 */
export function shortLabel(player: Pick<LineupPlayer, 'name' | 'short'>): string {
  return player.short?.trim() || player.name
}

/** What happened to one player, read off the timeline rather than guessed. */
export interface PlayerMarks {
  goals: number
  card: 'yellow' | 'red' | null
  offAt: string | null
  onAt: string | null
}

export function marksFor(name: string, events: TimelineEvent[] = []): PlayerMarks {
  const marks: PlayerMarks = { goals: 0, card: null, offAt: null, onAt: null }
  for (const e of events) {
    const [first, second] = e.players
    if (e.type === 'goal' || e.type === 'penalty-goal') {
      if (first === name) marks.goals += 1
    } else if (e.type === 'yellow-card' && first === name) {
      marks.card = marks.card ?? 'yellow'
    } else if ((e.type === 'red-card' || e.type === 'yellow-red-card') && first === name) {
      marks.card = 'red'
    } else if (e.type === 'substitution') {
      // ESPN files the substitution as "on, off" — the player coming on first.
      if (first === name) marks.onAt = e.minute
      if (second === name) marks.offAt = e.minute
    }
  }
  return marks
}

function Token({
  player,
  dense,
  events,
}: {
  player: LineupPlayer
  dense?: boolean
  events?: TimelineEvent[]
}) {
  const m = marksFor(player.name, events)
  const off = player.subbedOut || m.offAt !== null
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1" data-player={player.name}>
      <span className="relative">
        <span
          className={cn(
            'flex items-center justify-center rounded-full border font-mono tabular-nums',
            'border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)]',
            dense ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-[11px]',
            off && 'opacity-50',
          )}
          aria-hidden="true"
        >
          {player.jersey || '—'}
        </span>
        {m.goals ? (
          <span
            data-mark="goal"
            aria-hidden="true"
            className="absolute -right-1.5 -top-1 rounded-full bg-[var(--accent-primary)] px-1 font-mono text-[8px] leading-[13px] text-[var(--accent-on-primary)]"
          >
            {m.goals > 1 ? `●${m.goals}` : '●'}
          </span>
        ) : null}
        {m.card ? (
          <span
            data-mark={`${m.card}-card`}
            aria-hidden="true"
            className={cn(
              'absolute -left-1 -top-1 h-2.5 w-[7px] rounded-[1px]',
              m.card === 'red' ? 'bg-[var(--accent-loss)]' : 'bg-[var(--accent-warn)]',
            )}
          />
        ) : null}
        {m.offAt ? (
          <span
            data-mark="off"
            aria-hidden="true"
            className="absolute -bottom-1 -right-1.5 font-mono text-[8px] leading-none text-[var(--text-tertiary)]"
          >
            {m.offAt}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'max-w-full truncate text-center text-[9.5px] leading-tight',
          off ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]',
        )}
      >
        {shortLabel(player)}
      </span>
      <span className="sr-only">
        {player.jersey ? `Number ${player.jersey}, ` : ''}
        {player.name}
        {player.position ? `, ${player.position}` : ''}
        {m.goals ? `, ${m.goals} goal${m.goals > 1 ? 's' : ''}` : ''}
        {m.card ? `, ${m.card} card` : ''}
        {off ? `, substituted${m.offAt ? ` at ${m.offAt}` : ''}` : ''}
      </span>
    </div>
  )
}

/**
 * The markings, drawn as hairlines on the flat surface `--pitch-bg` names.
 *
 * A green rectangle would be the obvious thing and it is the one thing this
 * design language does not do — colour carries meaning here, never decoration.
 * The lines are what make it read as a pitch; the colour never was.
 */
function PitchLines() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute inset-x-0 top-1/2 border-t border-[var(--border-color)]" />
      <span className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--border-color)]" />
      <span className="absolute left-1/2 top-0 h-14 w-2/5 -translate-x-1/2 border-x border-b border-[var(--border-color)]" />
      <span className="absolute bottom-0 left-1/2 h-14 w-2/5 -translate-x-1/2 border-x border-t border-[var(--border-color)]" />
    </div>
  )
}

function Half({
  lineup,
  invert,
  events,
}: {
  lineup: Lineup
  invert: boolean
  events?: TimelineEvent[]
}) {
  const rows = formationRows(lineup.formation, lineup.starters.length)
  if (!rows) return null
  const bands = dealRows(lineup.starters, rows)
  // The keeper is at the outside edge of each half; the attackers meet in the
  // middle. So the home side, drawn at the bottom, runs its bands upwards.
  const ordered = invert ? [...bands].reverse() : bands
  return (
    <div className="relative z-10 flex flex-1 flex-col justify-around gap-2 py-3">
      {ordered.map((band, i) => (
        <div key={i} className="flex items-start justify-around gap-1 px-1">
          {band.map((p) => (
            <Token key={`${p.id}-${p.jersey}`} player={p} dense={band.length > 4} events={events} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Bench({
  lineup,
  label,
  events,
}: {
  lineup: Lineup
  label: string
  events?: TimelineEvent[]
}) {
  if (!lineup.bench.length) return null
  return (
    <div>
      <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        {label} · bench
      </h4>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {lineup.bench.map((p) => {
          const m = marksFor(p.name, events)
          const on = p.subbedIn || m.onAt !== null
          return (
            <li
              key={`${p.id}-${p.jersey}`}
              data-player={p.name}
              className="flex min-w-0 items-center gap-2"
            >
              <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--text-tertiary)]">
                {p.jersey}
              </span>
              <span
                title={p.name}
                className={cn(
                  'min-w-0 flex-1 truncate text-[11.5px]',
                  on ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
                )}
              >
                {shortLabel(p)}
                {m.goals ? <span aria-hidden="true"> ●{m.goals > 1 ? m.goals : ''}</span> : null}
              </span>
              {on ? (
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--accent-primary)]">
                  {m.onAt ?? 'on'}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function Formation({
  lineups,
  homeName,
  awayName,
  events,
}: {
  lineups: Lineup[]
  homeName: string
  awayName: string
  /** The timeline, so a token can carry the goals, cards and substitutions
   *  that actually happened to that player rather than a static team sheet. */
  events?: TimelineEvent[]
}) {
  const home = lineups.find((l) => l.homeAway === 'home')
  const away = lineups.find((l) => l.homeAway === 'away')
  if (!home && !away) return null

  const drawable =
    home &&
    away &&
    formationRows(home.formation, home.starters.length) &&
    formationRows(away.formation, away.starters.length)

  return (
    <div className="space-y-5">
      {drawable ? (
        <div>
          {/* Each label sits against its own half. Side by side above the
              pitch, they read as left-hand and right-hand teams, which is not
              how the board is drawn. */}
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            {awayName} · {away!.formation}
          </p>
          <div className="relative mt-1.5 flex min-h-[28rem] flex-col overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--pitch-bg)]">
            <PitchLines />
            <Half lineup={away!} invert={false} events={events} />
            <Half lineup={home!} invert events={events} />
          </div>
          <p className="mt-1.5 truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            {homeName} · {home!.formation}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {[away, home].map((l) =>
            l ? (
              <div key={l.homeAway}>
                <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  {l.homeAway === 'home' ? homeName : awayName}
                  {l.formation ? ` · ${l.formation}` : ''}
                </h4>
                <ul className="mt-2 space-y-1.5">
                  {l.starters.map((p) => (
                    <li key={`${p.id}-${p.jersey}`} data-player={p.name} className="flex min-w-0 items-center gap-2">
                      <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--text-tertiary)]">
                        {p.jersey}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-secondary)]">
                        {p.name}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                        {p.position}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {away ? <Bench lineup={away} label={awayName} events={events} /> : null}
        {home ? <Bench lineup={home} label={homeName} events={events} /> : null}
      </div>
    </div>
  )
}
