'use client'

import { cn } from '@/lib/utils'
import type { Movement, Move } from '@/lib/server/projectionHistory'

/**
 * What moved since the last forecast — and, precisely, what moved it.
 *
 * A projection that only ever shows today's number asks to be taken on trust.
 * This shows the previous one beside it, which is the difference between a
 * claim and a record.
 *
 * The care here is all in attribution. A club's title chance can move because
 * it won, because a rival lost, or because the model retrained overnight — and
 * only the first is a story about that club. The third is not shown at all
 * (`projectionMovement` returns null when no football was played between the
 * two snapshots), and the first two are separated by eye, because a table that
 * mixed them would quietly credit a club for a Saturday it spent at home.
 */

const LABEL: Record<Move['figure'], string> = {
  p_title: 'Title',
  p_top_cut: 'Top cut',
  p_relegated: 'Relegation',
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const signed = (v: number) => `${v > 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(1)}`

/**
 * Direction is coloured, but a rise is not always good news: `p_relegated`
 * going up is the bad direction. Colour carries meaning in this design, so it
 * has to track the meaning rather than the arithmetic sign.
 */
function tone(move: Move): string {
  const good = move.figure === 'p_relegated' ? move.delta < 0 : move.delta > 0
  return good ? 'text-[var(--accent-primary)]' : 'text-[var(--accent-loss)]'
}

function Row({ move }: { move: Move }) {
  return (
    <li
      className="flex items-baseline gap-3 py-1.5"
      data-move={move.team}
      data-moved-by={move.movedBy}
    >
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">
        {move.team}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
        {LABEL[move.figure]}
      </span>
      <span className="tabular font-mono text-[11px] text-[var(--text-tertiary)]">
        {pct(move.from)} → {pct(move.to)}
      </span>
      <span className={cn('tabular w-14 text-right font-mono text-[12px] font-semibold', tone(move))}>
        {signed(move.delta)}
      </span>
    </li>
  )
}

export function ProjectionMovement({
  movement,
  className,
}: {
  movement: Movement | null
  className?: string
}) {
  // No two forecasts, or no football between them. A retrain is not news.
  //
  // `moves` is checked with `Array.isArray`, not just for truthiness, because
  // this prop arrives over a `fetch` and a TypeScript type is a compile-time
  // fiction across a network boundary. A payload that answered `available:
  // true` with no `moves` took the whole season page down with
  // "Cannot read properties of undefined (reading 'length')" — the page, not
  // the panel, because an exception in render unmounts the tree above it.
  if (!movement || !Array.isArray(movement.moves) || movement.moves.length === 0) {
    return null
  }

  const own = movement.moves.filter((m) => m.movedBy === 'own-result')
  const others = movement.moves.filter((m) => m.movedBy === 'other-results')

  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5',
        className,
      )}
      aria-labelledby="movement-heading"
      data-projection-movement
      data-matches-played={movement.matchesPlayed}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="movement-heading"
          className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
        >
          What moved since the last forecast
        </h2>
        <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
          {movement.matchesPlayed} {movement.matchesPlayed === 1 ? 'match' : 'matches'} played
        </span>
      </div>

      {own.length > 0 && (
        <>
          <h3 className="mt-3.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Moved by their own result
          </h3>
          <ul className="mt-1 divide-y divide-[var(--border-color)]">
            {own.map((m) => (
              <Row key={`${m.team}-${m.figure}`} move={m} />
            ))}
          </ul>
        </>
      )}

      {others.length > 0 && (
        <>
          <h3 className="mt-4 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Moved by other results
          </h3>
          <ul className="mt-1 divide-y divide-[var(--border-color)]">
            {others.map((m) => (
              <Row key={`${m.team}-${m.figure}`} move={m} />
            ))}
          </ul>
        </>
      )}

      <p className="mt-3.5 border-t border-[var(--border-color)] pt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Measured against the forecast published{' '}
        {new Date(movement.from).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
        })}
        . The model retrains nightly, so this is only shown when matches were
        actually played in between — a projection that moves on a quiet day
        moved for reasons that have nothing to do with any team.
      </p>
    </section>
  )
}
