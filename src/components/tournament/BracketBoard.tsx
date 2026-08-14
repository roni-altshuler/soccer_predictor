'use client'

import { Maximize2, Minimize2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { TeamCrest } from '@/components/primitives/TeamCrest'
import { cn } from '@/lib/utils'

/**
 * The path to the trophy, drawn as a bracket.
 *
 * **Legibility first.** The previous version guaranteed the whole board fitted
 * the viewport, and paid for it with a transform: a Champions League bracket
 * landed at 0.62 on a phone and 0.91 on a desktop, so the thing a reader
 * actually wanted — who plays whom — was rendered at two thirds size. A bracket
 * nobody can read is not an overview of anything.
 *
 * So the board is drawn at full size, the way FotMob draws one, and the width
 * problem is solved the way FotMob solves it:
 *
 *  1. **Two-sided when it fits.** Final in the middle, halves running inwards.
 *     That shape is the information — it says who could still meet whom.
 *  2. **Otherwise a single flow**, left to right, ending at the final. Half the
 *     width of the mirrored board and identical in content.
 *  3. **When even that overflows, it pans**, with scroll snapping per round, a
 *     round navigator above it, and the round headings pinned to the top of
 *     the scroller. Panning a legible board beats staring at a small one.
 *  4. **A fit toggle** for the overview. The scaled board is still available —
 *     it is now something a reader asks for rather than something imposed on
 *     them.
 *
 * The geometry comes from `slot`, published per tie by `_bracket_slots`: the
 * tie at slot `s` is fed by slots `2s` and `2s+1`, so a round holding `n` slots
 * splits `0..n/2-1` into the top half and the rest into the bottom. Nothing
 * here infers a pairing; an empty slot draws an empty card, which is what a
 * bracket shows before a draw is made.
 *
 * Alignment is nested flex rather than absolute coordinates. Every column is
 * the same height and every cell is `flex-1`, so a round with half as many
 * cards gets cells twice as tall and each card lands on the centre line between
 * the two that feed it. The connector is a `h-1/2` box inside its own cell —
 * spanning exactly 25% to 75%, the two centres it has to join — so the drawing
 * survives any card height without a hard-coded pixel.
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

/* -------------------------------------------------------------------------- */
/*  Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One card is two rows of a real club name at a real size, so the column width
 * is not a free parameter: it is what "Borussia Mönchengladbach 2" needs.
 */
export const GEOM = {
  col: 196,
  conn: 22,
  /** The final is given more room — it is the one card everyone looks for. */
  final: 212,
  card: 62,
  /** Vertical breathing room per card, kept out of the width arithmetic. */
  gap: 10,
  heading: 28,
}

export type Layout = 'two-sided' | 'flow'

export interface Plan {
  layout: Layout
  /** 1 unless the reader asked to fit an oversized board to the width. */
  scale: number
  /** Whether the chosen layout fits without panning. */
  fits: boolean
  /** Natural width of the chosen layout, before any scale. */
  width: number
}

/** Mirrored board: every side round twice, plus the final once. */
export function twoSidedWidth(sideRounds: number): number {
  return 2 * sideRounds * (GEOM.col + GEOM.conn) + GEOM.final
}

/** Single flow: every round once, left to right, ending at the final. */
export function flowWidth(sideRounds: number): number {
  return sideRounds * (GEOM.col + GEOM.conn) + GEOM.final
}

/**
 * Choose a layout for the width available.
 *
 * Pure, and exported, because the properties worth guaranteeing are properties
 * of this function: the board is never silently shrunk, the mirrored shape is
 * preferred wherever it is legible, and a reader who asks to fit an oversized
 * board gets something that genuinely fits.
 */
export function planBoard(width: number, sideRounds: number, fit = false): Plan {
  // Width 0 means it has not been measured — server render, or jsdom, which
  // implements no layout. Draw the canonical shape rather than guessing.
  if (!width || sideRounds < 1) {
    return { layout: 'two-sided', scale: 1, fits: true, width: twoSidedWidth(Math.max(0, sideRounds)) }
  }

  const two = twoSidedWidth(sideRounds)
  if (width >= two) return { layout: 'two-sided', scale: 1, fits: true, width: two }

  const flow = flowWidth(sideRounds)
  if (width >= flow) return { layout: 'flow', scale: 1, fits: true, width: flow }

  // Too narrow for either at full size. Pan by default; scale only on request,
  // and then scale the mirrored board, because the point of asking to fit is
  // to see the shape.
  if (fit) return { layout: 'two-sided', scale: width / two, fits: true, width: two }
  return { layout: 'flow', scale: 1, fits: false, width: flow }
}

/** Aggregate scores are published as "3-1", sometimes "1-1 (4-2 pens)". */
export function splitScore(score: string | null): [string, string, string | null] | null {
  if (!score) return null
  const m = /^\s*(\d+)\s*[-–]\s*(\d+)\s*(.*)$/.exec(score)
  if (!m) return null
  const extra = m[3].trim()
  return [m[1], m[2], extra ? extra.replace(/^\(|\)$/g, '') : null]
}

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // Layout effect so the first paint is already in the right mode rather than
  // flashing the wrong one and snapping.
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

  return [ref, width]
}

/**
 * Scales its child and reserves the height the scaled child needs.
 *
 * `transform` does not affect layout, so without the height correction the
 * board leaves a gap under it the size of the space it no longer uses.
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

  if (scale >= 1) return <>{children}</>

  return (
    <div style={{ height }}>
      <div
        ref={inner}
        style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${100 / scale}%` }}
      >
        {children}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  The board                                                                  */
/* -------------------------------------------------------------------------- */

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
  // artifact emits them chronologically, but sorting on the published width
  // means an edition whose rounds arrive out of order still draws.
  const tree = useMemo(
    () => rounds.filter((r) => (r.slots ?? 0) > 0).sort((a, b) => (b.slots ?? 0) - (a.slots ?? 0)),
    [rounds],
  )
  const entry = useMemo(() => rounds.filter((r) => !(r.slots ?? 0)), [rounds])

  const final = tree.find((r) => r.slots === 1) ?? null
  const sides = tree.filter((r) => (r.slots ?? 0) > 1)

  const [fit, setFit] = useState(false)
  const [outerRef, width] = useWidth()
  const plan = useMemo(() => planBoard(width, sides.length, fit), [width, sides.length, fit])

  const scroller = useRef<HTMLDivElement>(null)
  const columns = useRef<(HTMLDivElement | null)[]>([])
  const [active, setActive] = useState(0)

  const visibleRounds = plan.layout === 'flow' ? [...sides, ...(final ? [final] : [])] : []

  /** Move the pan window to a round, the way a round navigator should. */
  const goTo = useCallback((i: number) => {
    const el = columns.current[i]
    const box = scroller.current
    if (!el || !box) return
    box.scrollTo({ left: Math.max(0, el.offsetLeft - 8), behavior: 'smooth' })
    setActive(i)
  }, [])

  // Keep the navigator honest while the reader pans by hand: the active chip
  // is whichever column starts nearest the left edge, not the last one clicked.
  useEffect(() => {
    const box = scroller.current
    if (!box || plan.fits) return
    const onScroll = () => {
      let nearest = 0
      let best = Infinity
      columns.current.forEach((el, i) => {
        if (!el) return
        const d = Math.abs(el.offsetLeft - box.scrollLeft - 8)
        if (d < best) {
          best = d
          nearest = i
        }
      })
      setActive(nearest)
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [plan.fits, plan.layout])

  const board =
    plan.layout === 'two-sided' ? (
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
    ) : (
      <div className="flex items-stretch">
        {sides.map((round, i) => (
          <RoundGroup
            key={`f-${round.slug}-${round.display}`}
            round={round}
            side="left"
            whole
            competitionId={competitionId}
            next={sides[i + 1] ?? final}
            columnRef={(el) => (columns.current[i] = el)}
          />
        ))}
        {final ? (
          <FinalColumn
            round={final}
            competitionId={competitionId}
            columnRef={(el) => (columns.current[sides.length] = el)}
          />
        ) : null}
      </div>
    )

  return (
    <section className={cn('mt-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          The bracket
        </h4>

        {tree.length && !plan.fits ? (
          <button
            type="button"
            onClick={() => setFit((v) => !v)}
            aria-pressed={fit}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            {fit ? (
              <Maximize2 className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Minimize2 className="h-3 w-3" aria-hidden="true" />
            )}
            {fit ? 'Full size' : 'Fit on screen'}
          </button>
        ) : null}
      </div>

      {tree.length ? (
        <div ref={outerRef} className="mt-3">
          {/* The round navigator. Only when the board pans — a control that
              scrolls something already fully visible is noise. */}
          {!plan.fits && visibleRounds.length > 1 ? (
            <div
              role="tablist"
              aria-label="Jump to a round"
              className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {visibleRounds.map((round, i) => (
                <button
                  key={`nav-${round.slug}-${round.display}`}
                  role="tab"
                  type="button"
                  aria-selected={i === active}
                  onClick={() => goTo(i)}
                  className={cn(
                    'min-h-[30px] shrink-0 rounded-full border px-3 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors',
                    i === active
                      ? 'border-[var(--accent-primary)] text-[var(--text-primary)]'
                      : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                  )}
                >
                  {round.display}
                </button>
              ))}
            </div>
          ) : null}

          <div
            ref={scroller}
            className={cn(
              plan.fits
                ? undefined
                : 'overflow-x-auto pb-2 [scrollbar-width:thin] [&>div]:snap-x [&>div]:snap-mandatory',
            )}
          >
            <Scaled scale={plan.scale}>{board}</Scaled>
          </div>
        </div>
      ) : null}

      {entry.length ? <EntryRounds rounds={entry} competitionId={competitionId} /> : null}
    </section>
  )
}

/**
 * One round, as a column of cards.
 *
 * `whole` renders every slot in the round — the single-flow layout. Without it
 * the column renders one half of the draw, which is what the mirrored board
 * needs: low slots on the left, high slots on the right, exactly the split the
 * feeder rule (2s, 2s+1) produces.
 */
function RoundGroup({
  round,
  side,
  whole,
  competitionId,
  next,
  columnRef,
}: {
  round: BracketRound
  /** Which way the connector points — the drawing direction. */
  side: 'left' | 'right'
  whole?: boolean
  competitionId: string
  next: BracketRound | null
  columnRef?: (el: HTMLDivElement | null) => void
}) {
  const slots = round.slots ?? 0
  const half = slots / 2
  const bySlot = new Map(round.ties.filter((t) => t.slot != null).map((t) => [t.slot as number, t]))
  const range = whole
    ? Array.from({ length: slots }, (_, i) => i)
    : Array.from({ length: half }, (_, i) => (side === 'left' ? i : half + i))

  const connectorPairs = whole ? next?.slots ?? 1 : Math.max(1, (next?.slots ?? 2) / 2)

  const column = (
    <div
      ref={columnRef}
      className="flex shrink-0 snap-start flex-col"
      style={{ width: GEOM.col }}
    >
      <ColumnHeading round={round} count={round.ties.length} />
      <div className="flex flex-1 flex-col">
        {range.map((slot) => (
          <div key={slot} className="flex flex-1 items-center" style={{ padding: `${GEOM.gap / 2}px 0` }}>
            <Tie tie={bySlot.get(slot) ?? null} competitionId={competitionId} />
          </div>
        ))}
      </div>
    </div>
  )

  const connector = <Connector pairs={connectorPairs} side={side} />

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
  columnRef,
}: {
  round: BracketRound
  competitionId: string
  columnRef?: (el: HTMLDivElement | null) => void
}) {
  const tie = round.ties[0] ?? null
  return (
    <div
      ref={columnRef}
      className="flex shrink-0 snap-start flex-col"
      style={{ width: GEOM.final }}
    >
      <ColumnHeading round={round} center />
      <div className="flex flex-1 items-center px-2">
        <Tie tie={tie} competitionId={competitionId} emphasis />
      </div>
    </div>
  )
}

/** Round headings sit above the board, pinned so they survive a vertical scroll. */
function ColumnHeading({
  round,
  center,
  count,
}: {
  round: BracketRound
  center?: boolean
  count?: number
}) {
  return (
    <div
      // The column's identity, for anything that needs to find a round without
      // reaching into styling classes — the round navigator's own tests, and
      // the smoke test that checks each round is drawn exactly where a bracket
      // puts it.
      data-round={round.display}
      className={cn(
        'sticky top-0 z-10 bg-[var(--background)] pb-2.5',
        center ? 'text-center' : 'pr-2',
      )}
      style={{ minHeight: GEOM.heading }}
    >
      <div className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        {round.display}
      </div>
      {round.projected ? (
        <div className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          Not drawn
        </div>
      ) : count ? (
        <div
          className={cn(
            'truncate font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]',
            center && 'sr-only',
          )}
        >
          {count} {count === 1 ? 'tie' : 'ties'}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The ⊐ joining two cards to the one they feed.
 *
 * `h-1/2` centred inside a `flex-1` cell spans 25% to 75% of that cell, and
 * because the cell covers exactly the two cards below it, those are their
 * centre lines. No pixel maths, and it survives any card height.
 */
function Connector({ pairs, side }: { pairs: number; side: 'left' | 'right' }) {
  return (
    <div className="flex shrink-0 flex-col" style={{ width: GEOM.conn }} aria-hidden>
      {/* Spacer matching the column heading, so the joins line up with cards. */}
      <div className="pb-2.5" style={{ minHeight: GEOM.heading }}>
        <div className="font-mono text-[11px] leading-normal">&nbsp;</div>
        <div className="font-mono text-[9px] leading-normal">&nbsp;</div>
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
 * One tie: two rows, one per club, crest and name on the left and the number
 * that decides it on the right.
 *
 * The number is the score for a settled tie and the chance to advance for an
 * undecided one — never both. A percentage next to a played tie reads as a
 * forecast of something already known.
 *
 * The winner is the only club at full contrast. That is the whole reading of a
 * bracket at a glance: scan down the bold names and you have the path.
 */
function Tie({
  tie,
  competitionId,
  emphasis,
}: {
  tie: BracketTie | null
  competitionId: string
  emphasis?: boolean
}) {
  if (!tie) {
    return (
      <div
        className="w-full rounded-lg border border-dashed border-[var(--border-color)]"
        style={{ height: GEOM.card }}
        aria-hidden
      />
    )
  }

  const goals = splitScore(tie.score)
  const sides = [
    { name: tie.team_a, id: tie.team_a_id, p: tie.p_team_a, goals: goals?.[0] ?? null },
    {
      name: tie.team_b,
      id: tie.team_b_id,
      p: tie.p_team_a === null ? null : 1 - tie.p_team_a,
      goals: goals?.[1] ?? null,
    },
  ]

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-lg border bg-[var(--card-bg)] transition-colors',
        emphasis
          ? 'border-[color-mix(in_srgb,var(--accent-primary)_55%,var(--border-color))]'
          : 'border-[var(--border-color)] hover:border-[color-mix(in_srgb,var(--accent-primary)_35%,var(--border-color))]',
      )}
      style={{ minHeight: GEOM.card }}
    >
      {sides.map((side, i) => {
        const won = tie.winner_id !== null && side.id === tie.winner_id
        const lost = tie.winner_id !== null && !won
        const favoured = side.p !== null && side.p >= 0.5
        return (
          <div
            key={`${side.id}-${side.name}`}
            // One row is one club's side of the tie: its crest, its name and
            // the number that settles it. Named so the row can be found as a
            // unit — the club's name alone also appears in the odds list below
            // the board.
            data-club={side.name}
            className={cn(
              'flex items-center gap-2 px-2.5 py-[7px]',
              i === 0 && 'border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]',
              won && 'bg-[color-mix(in_srgb,var(--accent-primary)_7%,transparent)]',
            )}
          >
            <TeamCrest team={side.name} competitionId={competitionId} size="sm" />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[12.5px]',
                won || favoured
                  ? 'font-semibold text-[var(--text-primary)]'
                  : lost
                    ? 'text-[var(--text-tertiary)]'
                    : 'text-[var(--text-secondary)]',
              )}
            >
              {side.name}
            </span>
            {side.goals !== null ? (
              <span
                className={cn(
                  'shrink-0 font-mono text-[12.5px] tabular-nums',
                  won ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
                )}
              >
                {side.goals}
              </span>
            ) : side.p !== null ? (
              <span
                className={cn(
                  'shrink-0 font-mono text-[11.5px] tabular-nums',
                  favoured ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]',
                )}
              >
                {(side.p * 100).toFixed(0)}%<span className="sr-only"> to advance</span>
              </span>
            ) : null}
          </div>
        )
      })}

      {/* One line of context, and only when it carries something the two rows
          cannot: a shootout, or the date of a tie still to be played. An
          unparseable score falls back to printing itself rather than vanishing. */}
      {goals?.[2] ? (
        <div className="border-t border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] px-2.5 py-[3px] text-right font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
          {goals[2]}
        </div>
      ) : tie.score && !goals ? (
        <div className="border-t border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] px-2.5 py-[3px] text-right font-mono text-[10px] tabular-nums text-[var(--text-secondary)]">
          {tie.score}
        </div>
      ) : tie.pending ? (
        <div className="border-t border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] px-2.5 py-[3px] text-right font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
          {fmtDate(tie.kickoff)}
          {tie.two_legged ? ' · two legs' : ''}
        </div>
      ) : null}
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
        Rounds played to reach the bracket above — a qualifying path is not a half of
        the draw.
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
