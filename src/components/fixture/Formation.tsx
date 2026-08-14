'use client'

import type { Lineup, LineupPlayer } from '@/lib/server/tieFixtures'
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

/** "Vinícius Júnior" → "Vinícius Júnior"; "Trent Alexander-Arnold" → "Alexander-Arnold". */
export function shortLabel(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : name
}

function Token({ player, dense }: { player: LineupPlayer; dense?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1" data-player={player.name}>
      <span
        className={cn(
          'flex items-center justify-center rounded-full border font-mono tabular-nums',
          'border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)]',
          dense ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-[11px]',
          player.subbedOut && 'opacity-50',
        )}
        aria-hidden="true"
      >
        {player.jersey || '—'}
      </span>
      <span
        className={cn(
          'max-w-full truncate text-center text-[9.5px] leading-tight',
          player.subbedOut ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-secondary)]',
        )}
      >
        {shortLabel(player.name)}
      </span>
      <span className="sr-only">
        {player.jersey ? `Number ${player.jersey}, ` : ''}
        {player.name}
        {player.position ? `, ${player.position}` : ''}
        {player.subbedOut ? ', substituted' : ''}
      </span>
    </div>
  )
}

function Half({ lineup, invert }: { lineup: Lineup; invert: boolean }) {
  const rows = formationRows(lineup.formation, lineup.starters.length)
  if (!rows) return null
  const bands = dealRows(lineup.starters, rows)
  // The keeper is at the outside edge of each half; the attackers meet in the
  // middle. So the home side, drawn at the bottom, runs its bands upwards.
  const ordered = invert ? [...bands].reverse() : bands
  return (
    <div className="flex flex-1 flex-col justify-around gap-2 py-2">
      {ordered.map((band, i) => (
        <div key={i} className="flex items-start justify-around gap-1 px-1">
          {band.map((p) => (
            <Token key={`${p.id}-${p.jersey}`} player={p} dense={band.length > 4} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Bench({ lineup, label }: { lineup: Lineup; label: string }) {
  if (!lineup.bench.length) return null
  return (
    <div>
      <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        {label} · bench
      </h4>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {lineup.bench.map((p) => (
          <li
            key={`${p.id}-${p.jersey}`}
            data-player={p.name}
            className="flex min-w-0 items-center gap-2"
          >
            <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--text-tertiary)]">
              {p.jersey}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[11.5px]',
                p.subbedIn ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
              )}
            >
              {p.name}
            </span>
            {p.subbedIn ? (
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--accent-primary)]">
                on
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Formation({
  lineups,
  homeName,
  awayName,
}: {
  lineups: Lineup[]
  homeName: string
  awayName: string
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
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              {awayName} · {away!.formation}
            </span>
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              {home!.formation} · {homeName}
            </span>
          </div>
          <div className="mt-2 flex min-h-[26rem] flex-col rounded-lg border border-[var(--border-color)] bg-[var(--pitch-bg)]">
            <Half lineup={away!} invert={false} />
            <div className="mx-3 border-t border-dashed border-[var(--border-color)]" />
            <Half lineup={home!} invert />
          </div>
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
        {away ? <Bench lineup={away} label={awayName} /> : null}
        {home ? <Bench lineup={home} label={homeName} /> : null}
      </div>
    </div>
  )
}
