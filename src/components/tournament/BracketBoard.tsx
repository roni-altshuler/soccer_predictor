'use client'

import { TeamCrest } from '@/components/primitives/TeamCrest'
import { cn } from '@/lib/utils'

/**
 * The path to the trophy, round by round.
 *
 * This is the thing the artifact carried and the page did not draw. Before
 * it, a reader saw who the favourite was and never saw the route: the odds
 * list said Bayern 24.8% and nothing on the page said Bayern had to get past
 * Galatasaray, then Real Madrid, then whoever came out of the other half.
 *
 * Laid out as rounds stacked in order rather than as columns with connecting
 * lines, and that is a data decision, not a styling one. `_bracket` emits each
 * round sorted by `(date, team_a)` — chronological, NOT bracket position — and
 * deliberately publishes no `feeders`, because `bracket_tree` can only pair a
 * round onto the previous one where the result is already known. Drawing
 * connectors would therefore invent a pairing for exactly the half of the
 * bracket a reader is still following. Stacked rounds claim only what the data
 * says: these ties, in this round, in this order.
 *
 * It also happens to be the layout that survives 320px, which a seven-round
 * column bracket does not.
 *
 * One component renders a finished edition and a live one, because the rounds
 * carry their own state: a played tie has a `score` and a `winner`, an
 * undecided one has `p_team_a`. Nothing here needs to know which kind of
 * tournament it was handed.
 */

export interface BracketTie {
  team_a: string
  team_b: string
  team_a_id: number
  team_b_id: number
  /** Aggregate over both legs, with the shootout appended. Null if unplayed. */
  score: string | null
  winner: string | null
  winner_id: number | null
  /** Probability team_a advances. Only ever set on an undecided tie. */
  p_team_a: number | null
  kickoff: string
  two_legged: boolean
  pending: boolean
}

export interface BracketRound {
  slug: string
  /** The COUNTED depth — structure. Never printed. */
  label: string
  /** What a reader calls this round. Printed. */
  display: string
  ties: BracketTie[]
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

export function BracketBoard({
  rounds,
  competitionId,
  className,
}: {
  rounds: BracketRound[]
  competitionId: string
  className?: string
}) {
  if (!rounds.length) return null

  return (
    <section className={cn('mt-5', className)}>
      <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        The bracket
      </h4>
      <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
        Every round in the order it was played. A tie still to be decided carries the
        chance each side goes through; a settled one carries the score that settled it.
      </p>

      <div className="mt-4 space-y-5">
        {rounds.map((round) => {
          const live = round.ties.some((t) => t.pending)
          return (
            <div key={`${round.slug}-${round.display}`}>
              <div className="flex items-baseline gap-2">
                <h5 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                  {round.display}
                </h5>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  {round.ties.length} {round.ties.length === 1 ? 'tie' : 'ties'}
                </span>
                {live ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--accent-primary)]">
                    to play
                  </span>
                ) : null}
              </div>

              <ul className="mt-2 space-y-2">
                {round.ties.map((tie) => (
                  <Tie
                    key={`${tie.team_a_id}-${tie.team_b_id}-${tie.kickoff}`}
                    tie={tie}
                    competitionId={competitionId}
                  />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * One tie, two rows — one per club, because a knockout tie has exactly two
 * outcomes and both of them are worth stating. The earlier single-line layout
 * put a percentage between two club names and left the reader to work out
 * which club it belonged to.
 */
function Tie({ tie, competitionId }: { tie: BracketTie; competitionId: string }) {
  const priced = tie.pending && tie.p_team_a !== null
  const sides = [
    { name: tie.team_a, id: tie.team_a_id, p: tie.p_team_a },
    { name: tie.team_b, id: tie.team_b_id, p: tie.p_team_a === null ? null : 1 - tie.p_team_a },
  ]

  return (
    <li className="rounded-lg border border-[var(--border-color)] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        <span>{fmtDate(tie.kickoff)}</span>
        <span className="flex items-baseline gap-2">
          {tie.two_legged ? <span>Two legs</span> : null}
          {tie.score ? (
            <span className="text-[var(--text-secondary)]">{tie.score}</span>
          ) : priced ? null : (
            <span>To be played</span>
          )}
        </span>
      </div>

      <div className="mt-2 space-y-1.5">
        {sides.map((side) => {
          // A settled tie is read off the winner. An undecided one is read off
          // the probability. Never both — a tie that has been played has no
          // percentage in the artifact, by construction.
          const won = tie.winner_id !== null && side.id === tie.winner_id
          const favoured = side.p !== null && side.p >= 0.5
          const lead = won || favoured

          return (
            <div key={`${side.id}-${side.name}`} className="flex items-center gap-2.5">
              <TeamCrest team={side.name} competitionId={competitionId} size="sm" />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px]',
                  lead
                    ? 'font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)]',
                )}
              >
                {side.name}
              </span>
              {side.p !== null ? (
                <span
                  className={cn(
                    'shrink-0 font-mono text-[12px] tabular-nums',
                    favoured ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]',
                  )}
                >
                  {(side.p * 100).toFixed(0)}%<span className="sr-only"> to advance</span>
                </span>
              ) : won ? (
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--accent-primary)]">
                  Through
                </span>
              ) : null}
            </div>
          )
        })}
      </div>

      {priced && tie.p_team_a !== null ? (
        <div
          aria-hidden
          className="mt-2 flex h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]"
        >
          <div
            className="h-full bg-[var(--accent-primary)]"
            style={{ width: `${tie.p_team_a * 100}%` }}
          />
          <div
            className="h-full"
            style={{
              width: `${(1 - tie.p_team_a) * 100}%`,
              background: 'color-mix(in srgb, var(--accent-primary) 30%, transparent)',
            }}
          />
        </div>
      ) : null}
    </li>
  )
}
