'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { TeamCrest } from '@/components/primitives/TeamCrest'
import { cn } from '@/lib/utils'

/**
 * The path to the trophy, drawn as a bracket.
 *
 * Two-sided, final in the middle, the way a printed bracket is drawn: the
 * halves of the draw run inwards from each edge and meet once. That shape is
 * the information — it says who could still meet whom, which a stack of round
 * lists cannot say at all.
 *
 * The geometry comes from `slot`, published per tie by `_bracket_slots`. The
 * rule is that the tie at slot `s` is fed by slots `2s` and `2s+1`, so a round
 * holding `n` slots splits `0..n/2-1` into the left half and the rest into the
 * right. Nothing here infers a pairing; if a slot is empty it draws an empty
 * box, which is what a bracket shows before a draw is made.
 *
 * Alignment is done with nested flex rather than absolute coordinates. Every
 * column is the same height and every cell in it is `flex-1`, so a round with
 * half as many boxes gets cells twice as tall and each box lands on the centre
 * line between the two it came from. The connector is then a `h-1/2` box
 * inside its own cell — spanning 25% to 75%, which is exactly the two centres
 * it has to join — so the drawing stays correct at any box size without a
 * single hard-coded pixel.
 *
 * Rounds outside the trophy tree (`slots: 0`) are entry rounds — the Europa
 * League play-off, the Libertadores group stages. They are ways INTO the
 * bracket, not rounds of it, and forcing them into the drawing doubles its
 * width and misaligns every pairing above them, so they are listed separately.
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
  /** Position in this round of the bracket. Null outside the trophy tree. */
  slot?: number | null
}

export interface BracketRound {
  slug: string
  /** The COUNTED depth — structure. Never printed. */
  label: string
  /** What a reader calls this round. Printed. */
  display: string
  /** Positions in this round. 0 means the round is not part of the tree. */
  slots?: number
  /** True when the round has not been drawn yet and holds no ties. */
  projected?: boolean
  ties: BracketTie[]
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

/**
 * Fitting a bracket into the width it has, without a sideways scrollbar.
 *
 * A bracket is intrinsically wide and the obvious answer — let it scroll — is
 * the one thing that stops a reader seeing the shape, which is the only reason
 * to draw a bracket rather than list the rounds. Three things together get the
 * whole board on screen at any width:
 *
 *  1. GEOMETRY IS KNOWN, NOT MEASURED. Every column is a fixed width, so the
 *     natural size of the board is arithmetic on the number of rounds. That
 *     avoids measuring a scaled element to decide how much to scale it, which
 *     oscillates.
 *  2. THE HALVES STACK WHEN THEY MUST. Two-sided is right when it fits: it is
 *     how a bracket is drawn and it shows both routes to the final at once.
 *     Below that it becomes two one-sided halves stacked vertically, each
 *     reading inwards to the final — which is roughly half the width, so it is
 *     worth about twice the scale.
 *  3. WHAT IS LEFT IS SCALED. A transform, so the layout still reserves the
 *     right height and nothing overlaps what follows.
 *
 * The measured numbers this is tuned against, at the app's 990px content width
 * and a 375px phone: a Champions League bracket is 1092px two-sided, so it
 * fits desktop at 0.91 and a phone at 0.27 — three-pixel text. Stacked and
 * compacted, the same bracket is 458px, which a phone takes at 0.82.
 */
const GEOM = {
  /** Two-sided, roomy: the desktop case. */
  wide: { col: 140, conn: 16, final: 156 },
  /** Stacked halves, compact: crest and meta line drop out below. */
  compact: { col: 104, conn: 10, final: 116 },
}

/** Below this the text is too small to be worth keeping the two-sided shape. */
const MIN_TWO_SIDED_SCALE = 0.62

export interface Fit {
  /** Two-sided with the final in the middle, or halves stacked vertically. */
  stacked: boolean
  scale: number
}

/**
 * Pure so the guarantee can be tested: whichever branch is taken, the drawn
 * width is never greater than the width available, so nothing scrolls
 * sideways. Exported for exactly that.
 */
export function computeFit(width: number, sideRounds: number): Fit {
  // Width 0 means it has not been measured — server render, or jsdom, which
  // implements no layout. Draw the canonical shape rather than guessing.
  if (!width || sideRounds < 1) return { stacked: false, scale: 1 }

  const w = GEOM.wide
  const twoSided = 2 * sideRounds * (w.col + w.conn) + w.final
  const twoScale = Math.min(1, width / twoSided)
  if (twoScale >= MIN_TWO_SIDED_SCALE) return { stacked: false, scale: twoScale }

  const c = GEOM.compact
  const half = sideRounds * (c.col + c.conn) + c.final
  return { stacked: true, scale: Math.min(1, width / half) }
}

/** The drawn width of a board, for the mode `computeFit` chose. */
export function naturalWidth(sideRounds: number, stacked: boolean): number {
  const g = stacked ? GEOM.compact : GEOM.wide
  return stacked
    ? sideRounds * (g.col + g.conn) + g.final
    : 2 * sideRounds * (g.col + g.conn) + g.final
}

function useFit(sideRounds: number): [React.RefObject<HTMLDivElement>, Fit] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // Layout effect so the first paint is already at the right scale rather than
  // flashing a full-size board and snapping.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useMemo<Fit>(() => computeFit(width, sideRounds), [width, sideRounds])

  return [ref, fit]
}

/**
 * Scales its child to `scale` and reserves the height the scaled child needs.
 *
 * `transform` does not affect layout, so without the height correction the
 * board would leave a gap under it the size of the space it no longer uses.
 */
function Scaled({ scale, children }: { scale: number; children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    const el = inner.current
    if (!el) return
    const measure = () => setHeight(el.offsetHeight * scale)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scale])

  return (
    <div style={{ height }}>
      <div
        ref={inner}
        style={
          scale < 1
            ? { transform: `scale(${scale})`, transformOrigin: 'top left', width: `${100 / scale}%` }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  )
}

export function BracketBoard({
  rounds,
  competitionId,
  className,
}: {
  rounds: BracketRound[]
  competitionId: string
  className?: string
}) {
  // Widest round first, which is the order the bracket is drawn in. The
  // artifact already emits them chronologically, but sorting on the published
  // width means an edition whose rounds arrive out of order still draws.
  const tree = useMemo(
    () => rounds.filter((r) => (r.slots ?? 0) > 0).sort((a, b) => (b.slots ?? 0) - (a.slots ?? 0)),
    [rounds],
  )
  const entry = useMemo(() => rounds.filter((r) => !(r.slots ?? 0)), [rounds])

  const final = tree.find((r) => r.slots === 1) ?? null
  // Everything except the final, which is drawn once in the middle rather than
  // once per side.
  const sides = tree.filter((r) => (r.slots ?? 0) > 1)
  const [fitRef, fit] = useFit(sides.length)

  return (
    <section className={cn('mt-5', className)}>
      <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        The bracket
      </h4>
      <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
        Both halves of the draw, meeting once. A tie still to be decided carries
        the chance each side goes through; a settled one carries the score that
        settled it. An empty box is a place in the draw nobody has reached yet.
      </p>

      {tree.length ? (
        <div ref={fitRef} className="mt-4">
          <Scaled scale={fit.scale}>
            {fit.stacked ? (
              // Each half reads inwards to the final, stacked one above the
              // other. Half the width, so roughly twice the scale — which is
              // the difference between a phone showing three-pixel text and a
              // legible board.
              <div className="flex flex-col gap-5">
                <HalfBoard
                  rounds={sides}
                  side="left"
                  label="Top half"
                  competitionId={competitionId}
                  final={final}
                  compact
                />
                <HalfBoard
                  rounds={sides}
                  side="right"
                  label="Bottom half"
                  competitionId={competitionId}
                  final={null}
                  compact
                />
              </div>
            ) : (
              <div className="flex items-stretch">
                {sides.map((round, i) => (
                  <RoundGroup
                    key={`l-${round.slug}-${round.display}`}
                    round={round}
                    side="left"
                    competitionId={competitionId}
                    next={sides[i + 1] ?? final}
                  />
                ))}

                {final ? <FinalColumn round={final} competitionId={competitionId} /> : null}

                {[...sides].reverse().map((round, i, arr) => (
                  <RoundGroup
                    key={`r-${round.slug}-${round.display}`}
                    round={round}
                    side="right"
                    competitionId={competitionId}
                    next={arr[i - 1] ?? final}
                  />
                ))}
              </div>
            )}
          </Scaled>
        </div>
      ) : null}

      {entry.length ? <EntryRounds rounds={entry} competitionId={competitionId} /> : null}
    </section>
  )
}

/**
 * One half of the draw, read left to right, ending at the final.
 *
 * Used when the two-sided board will not fit. Both halves are still shown —
 * the whole bracket is on screen — but stacked rather than mirrored, which is
 * what buys back the width.
 */
function HalfBoard({
  rounds,
  side,
  label,
  competitionId,
  final,
  compact,
}: {
  rounds: BracketRound[]
  side: 'left' | 'right'
  label: string
  competitionId: string
  final: BracketRound | null
  compact?: boolean
}) {
  return (
    <div>
      <div className="pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className="flex items-stretch">
        {rounds.map((round, i) => (
          <RoundGroup
            key={`${side}-${round.slug}-${round.display}`}
            round={round}
            side="left"
            renderHalf={side}
            competitionId={competitionId}
            next={rounds[i + 1] ?? final}
            compact={compact}
          />
        ))}
        {final ? (
          <FinalColumn round={final} competitionId={competitionId} compact={compact} />
        ) : null}
      </div>
    </div>
  )
}

/** Column labels sit above the board, one per round, mirrored either side. */
function RoundGroup({
  round,
  side,
  renderHalf,
  competitionId,
  next,
  compact,
}: {
  round: BracketRound
  /** Which way the connector points — the drawing direction. */
  side: 'left' | 'right'
  /** Which half's slots to render. Defaults to the drawing direction. */
  renderHalf?: 'left' | 'right'
  competitionId: string
  next: BracketRound | null
  compact?: boolean
}) {
  const g = compact ? GEOM.compact : GEOM.wide
  const slots = round.slots ?? 0
  const half = slots / 2
  const bySlot = new Map(round.ties.filter((t) => t.slot != null).map((t) => [t.slot as number, t]))
  // Left half is the low slots, right half the high ones — the split the
  // feeder rule (2s, 2s+1) produces. Which half is DRAWN is separate from
  // which way the connectors point, so a stacked board can render the
  // right-hand half of the draw reading left-to-right.
  const which = renderHalf ?? side
  const range = Array.from({ length: half }, (_, i) => (which === 'left' ? i : half + i))
  const connector = (
    <Connector pairs={Math.max(1, (next?.slots ?? 2) / 2)} side={side} width={g.conn} />
  )

  const column = (
    <div className="flex shrink-0 flex-col" style={{ width: g.col }}>
      <ColumnHeading round={round} />
      <div className="flex flex-1 flex-col">
        {range.map((slot) => (
          <div key={slot} className="flex flex-1 items-center py-1">
            <Tie tie={bySlot.get(slot) ?? null} competitionId={competitionId} compact={compact} />
          </div>
        ))}
      </div>
    </div>
  )

  return side === 'left' ? (
    <>
      {column}
      {connector}
    </>
  ) : (
    <>
      {connector}
      {column}
    </>
  )
}

function FinalColumn({
  round,
  competitionId,
  compact,
}: {
  round: BracketRound
  competitionId: string
  compact?: boolean
}) {
  const tie = round.ties[0] ?? null
  const g = compact ? GEOM.compact : GEOM.wide
  return (
    <div className="flex shrink-0 flex-col" style={{ width: g.final }}>
      <ColumnHeading round={round} center />
      <div className="flex flex-1 items-center px-1.5">
        <Tie tie={tie} competitionId={competitionId} emphasis compact={compact} />
      </div>
    </div>
  )
}

function ColumnHeading({ round, center }: { round: BracketRound; center?: boolean }) {
  return (
    <div className={cn('pb-2', center && 'text-center')}>
      <div className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        {round.display}
      </div>
      {round.projected ? (
        <div className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          Not drawn
        </div>
      ) : null}
    </div>
  )
}

/**
 * The ⊐ joining two boxes to the one they feed.
 *
 * `h-1/2` centred inside a `flex-1` cell spans 25% to 75% of that cell, and
 * because the cell covers exactly the two boxes below it, those are their
 * centre lines. No pixel maths, and it survives any box height.
 */
function Connector({
  pairs,
  side,
  width,
}: {
  pairs: number
  side: 'left' | 'right'
  width: number
}) {
  return (
    <div className="flex shrink-0 flex-col" style={{ width }} aria-hidden>
      {/* Spacer matching the column heading, so the joins line up with boxes. */}
      <div className="pb-2">
        <div className="font-mono text-[10px] leading-normal">&nbsp;</div>
      </div>
      <div className="flex flex-1 flex-col">
        {Array.from({ length: Math.max(1, Math.round(pairs)) }, (_, i) => (
          <div key={i} className="flex flex-1 items-center">
            <div
              className={cn(
                'h-1/2 w-full border-y border-[var(--border-color)]',
                side === 'left' ? 'border-r' : 'border-l',
              )}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One tie, two rows — one per club, because a knockout tie has exactly two
 * outcomes and both are worth stating. An empty slot is a box with nothing in
 * it, which is a true statement about a place in the draw nobody has reached.
 */
function Tie({
  tie,
  competitionId,
  emphasis,
  compact,
}: {
  tie: BracketTie | null
  competitionId: string
  emphasis?: boolean
  /** Drop the crest and the meta line — the width the stacked board buys. */
  compact?: boolean
}) {
  if (!tie) {
    return (
      <div
        className={cn(
          'w-full rounded-md border border-dashed border-[var(--border-color)] px-2 py-1.5',
          compact ? 'h-[34px]' : 'h-[46px]',
        )}
        aria-hidden
      />
    )
  }

  const priced = tie.pending && tie.p_team_a !== null
  const sides = [
    { name: tie.team_a, id: tie.team_a_id, p: tie.p_team_a },
    { name: tie.team_b, id: tie.team_b_id, p: tie.p_team_a === null ? null : 1 - tie.p_team_a },
  ]

  return (
    <div
      className={cn(
        'w-full rounded-md border bg-[var(--card-bg)] px-2 py-1.5',
        emphasis ? 'border-[var(--accent-primary)]' : 'border-[var(--border-color)]',
      )}
    >
      {sides.map((side) => {
        // A settled tie is read off the winner, an undecided one off the
        // probability. Never both — a played tie carries no percentage.
        const won = tie.winner_id !== null && side.id === tie.winner_id
        const favoured = side.p !== null && side.p >= 0.5
        const lead = won || favoured
        return (
          <div key={`${side.id}-${side.name}`} className="flex items-center gap-1.5 py-[1px]">
            {compact ? null : (
              <TeamCrest team={side.name} competitionId={competitionId} size="sm" />
            )}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[11px] md:text-[12px]',
                lead ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
              )}
            >
              {side.name}
            </span>
            {side.p !== null ? (
              <span
                className={cn(
                  'shrink-0 font-mono text-[10px] tabular-nums md:text-[11px]',
                  favoured ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]',
                )}
              >
                {(side.p * 100).toFixed(0)}%<span className="sr-only"> to advance</span>
              </span>
            ) : null}
          </div>
        )
      })}

      {/* The meta line is the first thing to go when space is short: the score
          is already implied by which club is bold, and the date is the least
          load-bearing thing in the box. */}
      {compact ? (
        tie.score ? (
          <div className="mt-0.5 text-right font-mono text-[9px] tabular-nums text-[var(--text-secondary)]">
            {tie.score}
          </div>
        ) : null
      ) : (
        <div className="mt-0.5 flex items-baseline justify-between gap-1 font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
          <span className="truncate">{fmtDate(tie.kickoff)}</span>
          {tie.score ? (
            <span className="shrink-0 text-[var(--text-secondary)]">{tie.score}</span>
          ) : priced ? null : (
            <span className="shrink-0">To play</span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Rounds that feed the bracket without being part of it. Listed rather than
 * drawn: they do not halve into the round above them, so they have no slot and
 * no position on the board.
 */
function EntryRounds({
  rounds,
  competitionId,
}: {
  rounds: BracketRound[]
  competitionId: string
}) {
  return (
    <div className="mt-6">
      <h5 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
        Getting there
      </h5>
      <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Rounds played to reach the bracket above. They do not sit in it — a
        qualifying path is not a half of the draw.
      </p>
      <div className="mt-3 space-y-4">
        {rounds.map((round) => (
          <div key={`${round.slug}-${round.display}`}>
            <div className="flex items-baseline gap-2">
              <h6 className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                {round.display}
              </h6>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {round.ties.length} {round.ties.length === 1 ? 'tie' : 'ties'}
              </span>
            </div>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {round.ties.map((tie) => (
                <li key={`${tie.team_a_id}-${tie.team_b_id}-${tie.kickoff}`}>
                  <Tie tie={tie} competitionId={competitionId} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
