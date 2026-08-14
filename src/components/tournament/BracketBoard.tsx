'use client'

import { Maximize2, Minimize2, Trophy } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { TeamCrest } from '@/components/primitives/TeamCrest'
import {
  METRICS,
  cardKey,
  pathToFinal,
  planBoard,
  splitScore,
  type PlacedCard,
  type Plan,
} from '@/components/tournament/bracketLayout'
import { cn } from '@/lib/utils'

/**
 * The path to the trophy, drawn as a bracket.
 *
 * The board is **computed, not laid out** — every card position and every
 * connector comes from `bracketLayout.ts`, which is arithmetic and therefore
 * testable. The version this replaces built the shape out of nested flex boxes
 * with `h-1/2` bordered divs standing in for connectors: it got a bracket
 * approximately right, and whether a card sat on the centre line between the
 * two that feed it was verifiable only by looking at it.
 *
 * What that buys, beyond correctness:
 *
 *  1. **Real connectors.** One SVG under the cards, elbows with rounded
 *     corners drawn between actual card edges. They know which two cards they
 *     join, which is what makes (3) possible.
 *  2. **Named empty slots.** A place in the draw nobody has reached is not a
 *     blank box — it says *Winner of Arsenal / Real Madrid*, which is the
 *     thing a reader is actually working out when they look at one.
 *  3. **A route, on hover.** Point at any tie and the rest of the board dims to
 *     leave that team's remaining path to the final. "Who could still meet
 *     whom" is the only reason to draw a bracket rather than list rounds, and
 *     this is that question asked directly. Keyboard focus does the same.
 *  3b. **Every tie is a link.** Clicking one opens the fixture behind it —
 *     timeline, commentary, both team sheets in their real shapes, the match
 *     statistics and the head-to-head. Tracing is a pointer affordance and
 *     opening the match is the tap, which is the way every scoreboard product
 *     behaves and the thing a reader reaches for first.
 *  4. **Full size, always.** The board picks the widest layout that fits at
 *     scale 1 — mirrored, else a single left-to-right flow — and pans when
 *     neither does, with a round navigator above it. Scaling happens only when
 *     the reader presses *Fit on screen*.
 *
 * Rounds outside the trophy tree (`slots: 0`) are entry rounds — the Europa
 * League play-off, the Libertadores group stages. They are ways INTO the
 * bracket, not rounds of it, so they are listed rather than drawn.
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

export { planBoard, splitScore } from '@/components/tournament/bracketLayout'

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

/**
 * The name as a bracket card prints it.
 *
 * The structural tokens a club's legal name carries — `FC`, `CF`, `SC`, `AC`,
 * `Club`, `de` — are the same set `normTeam` already drops to match a crest,
 * and they are pure width on a card 150px wide. `FC Bayern München` reads as
 * `Bayern München`, `Real Madrid CF` as `Real Madrid`.
 *
 * It only ever removes tokens, never abbreviates: inventing `RMA` from `Real
 * Madrid` would be a code this project has no source for, and a wrong code is
 * read as a fact. Anything still too long is truncated by CSS with the full
 * name on the element, so nothing is lost.
 */
const STRUCTURAL = new Set([
  'fc', 'cf', 'afc', 'sc', 'ac', 'ss', 'ud', 'cd', 'rc', 'rcd', 'sv', 'tsv',
  'vfl', 'vfb', 'fsv', 'bsc', 'sd', 'club', 'calcio', 'futbol', 'football',
  'futebol', 'kv', 'rsc', 'kaa', 'sk',
])

export function bracketLabel(name: string): string {
  const kept = name
    .trim()
    .split(/\s+/)
    .filter((t) => !STRUCTURAL.has(t.toLowerCase().replace(/[.]/g, '')))
  return kept.length ? kept.join(' ') : name
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
 * The address of one tie: the edition, the round, and the two clubs in it.
 *
 * The artifact publishes no match id, so the tie is addressed by the things it
 * does publish. A round cannot hold the same pairing twice, which is what makes
 * this unique — and it survives a bracket being regenerated, where a slot index
 * would silently start pointing at a different tie.
 */
export function tieHref(
  competitionId: string,
  season: number | undefined,
  roundSlug: string,
  tie: BracketTie,
): string | null {
  if (season === undefined) return null
  return `/tournaments/tie/${competitionId}/${season}/${roundSlug}/${tie.team_a_id}v${tie.team_b_id}`
}

/** Height reserved above the final for the trophy block. */
const CHAMPION_H = 62

function Champion({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <Trophy className="h-5 w-5 text-[var(--accent-primary)]" aria-hidden="true" />
      <span className="max-w-full truncate text-[13px] font-semibold text-[var(--text-primary)]">
        {name}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        Champion
      </span>
    </div>
  )
}

export function BracketBoard({
  rounds,
  competitionId,
  season,
  className,
}: {
  rounds: BracketRound[]
  competitionId: string
  /** The edition. Without it a tie has no address and the cards are not links. */
  season?: number
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

  const roundSlots = useMemo(() => tree.map((r) => r.slots ?? 0), [tree])
  const bySlot = useMemo(() => {
    const map = new Map<string, BracketTie>()
    tree.forEach((round, i) => {
      for (const tie of round.ties) {
        if (tie.slot != null) map.set(cardKey(i, tie.slot), tie)
      }
    })
    return map
  }, [tree])

  const [fit, setFit] = useState(false)
  const [outerRef, width] = useWidth()
  const plan: Plan = useMemo(
    () => planBoard(width, roundSlots, fit),
    [width, roundSlots, fit],
  )

  // Hover and keyboard focus trace a route. Tapping used to pin one; it opens
  // the match now, which is what a tap on a fixture means everywhere else and
  // the thing a reader on a phone is reaching for.
  const [active, setActive] = useState<string | null>(null)
  const route = useMemo(() => {
    if (!active) return null
    const [r, s] = active.split(':').map(Number)
    return new Set(pathToFinal(r, s, roundSlots.length))
  }, [active, roundSlots.length])

  const scroller = useRef<HTMLDivElement>(null)
  const columnEls = useRef<(HTMLDivElement | null)[]>([])
  const [activeRound, setActiveRound] = useState(0)

  const goTo = useCallback((i: number) => {
    const el = columnEls.current[i]
    const box = scroller.current
    if (!el || !box) return
    box.scrollTo({ left: Math.max(0, el.offsetLeft - 8), behavior: 'smooth' })
    setActiveRound(i)
  }, [])

  // Keep the navigator honest while the reader pans by hand.
  useEffect(() => {
    const box = scroller.current
    if (!box || plan.fits) return
    const onScroll = () => {
      let nearest = 0
      let best = Infinity
      columnEls.current.forEach((el, i) => {
        if (!el) return
        const d = Math.abs(el.offsetLeft - box.scrollLeft - 8)
        if (d < best) {
          best = d
          nearest = i
        }
      })
      setActiveRound(nearest)
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [plan.fits, plan.mode])

  const finalRound = tree[tree.length - 1] ?? null
  const finalTie = finalRound?.slots === 1 ? finalRound.ties[0] ?? null : null
  // Named only when the winner is one of the two clubs that played the final.
  // The `?:` this replaces fell through to team_b for any unrecognised
  // `winner_id`, which crowns a team that did not win.
  const champion =
    !finalTie || finalTie.winner_id === null
      ? null
      : finalTie.winner_id === finalTie.team_a_id
        ? finalTie.team_a
        : finalTie.winner_id === finalTie.team_b_id
          ? finalTie.team_b
          : null

  if (!tree.length) {
    return entry.length ? (
      <section className={cn('mt-5', className)}>
        <EntryRounds rounds={entry} competitionId={competitionId} season={season} />
      </section>
    ) : null
  }

  const { layout } = plan
  const finalCard = layout.cards.find((c) => c.round === roundSlots.length - 1) ?? null

  return (
    <section className={cn('mt-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          The bracket
        </h4>

        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)] sm:inline">
            Point at a tie to trace its route
          </span>
          {!plan.fits ? (
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
      </div>

      <div ref={outerRef} className="mt-3">
        {/* The round navigator. Only when the board pans — a control that
            scrolls something already fully visible is noise. */}
        {!plan.fits && tree.length > 1 ? (
          <div
            role="tablist"
            aria-label="Jump to a round"
            className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {tree.map((round, i) => (
              <button
                key={`nav-${round.slug}-${round.display}`}
                role="tab"
                type="button"
                aria-selected={i === activeRound}
                onClick={() => goTo(i)}
                className={cn(
                  'min-h-[30px] shrink-0 rounded-full border px-3 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors',
                  i === activeRound
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
          className={cn(plan.fits ? undefined : 'overflow-x-auto pb-2 [scrollbar-width:thin]')}
          onMouseLeave={() => setActive(null)}
        >
          <div
            // Centred when it is narrower than the space it has: a board
            // pinned left with a third of the card empty beside it reads as
            // something that failed to load.
            className={plan.fits ? 'mx-auto' : undefined}
            style={{
              width: layout.width * plan.scale,
              height: (layout.height + METRICS.headerH) * plan.scale,
            }}
          >
            <div
              className="relative"
              style={{
                width: layout.width,
                height: layout.height + METRICS.headerH,
                transform: plan.scale < 1 ? `scale(${plan.scale})` : undefined,
                transformOrigin: 'top left',
              }}
            >
              {/* Column headings, one per drawn column. In the mirrored board a
                  round appears twice, so both get one. */}
              {layout.columns.map((col, i) => {
                const round = tree[col.round]
                if (!round) return null
                return (
                  <div
                    key={`head-${col.round}-${col.side}-${i}`}
                    ref={(el) => {
                      // Only the left-to-right columns anchor the navigator;
                      // in the flow layout that is all of them.
                      if (col.side !== 'right') columnEls.current[col.round] = el
                    }}
                    data-round={round.display}
                    className="absolute top-0"
                    style={{ left: col.x, width: col.w, height: METRICS.headerH }}
                  >
                    <div className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                      {round.display}
                    </div>
                    <div className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                      {round.projected
                        ? 'Not drawn'
                        : `${round.ties.length} ${round.ties.length === 1 ? 'tie' : 'ties'}`}
                    </div>
                  </div>
                )
              })}

              {/* Connectors, under the cards. Dimmed unless they are part of
                  the route being traced. */}
              <svg
                className="pointer-events-none absolute left-0"
                style={{ top: METRICS.headerH }}
                width={layout.width}
                height={layout.height}
                aria-hidden="true"
              >
                {layout.links.map((l) => {
                  const on = !route || (route.has(l.from) && route.has(l.to))
                  return (
                    <path
                      key={`${l.from}->${l.to}`}
                      d={l.d}
                      fill="none"
                      strokeWidth={on && route ? 1.5 : 1}
                      className="transition-[stroke,stroke-width] duration-150"
                      stroke={
                        on && route
                          ? 'var(--accent-primary)'
                          : route
                            ? 'color-mix(in srgb, var(--border-color) 45%, transparent)'
                            : 'var(--border-color)'
                      }
                    />
                  )
                })}
              </svg>

              {layout.cards.map((card) => {
                const key = cardKey(card.round, card.slot)
                const tie = bySlot.get(key) ?? null
                const dimmed = Boolean(route && !route.has(key))
                return (
                  <div
                    key={key}
                    className={cn(
                      'absolute transition-opacity duration-150',
                      dimmed && 'opacity-30',
                    )}
                    style={{
                      left: card.x,
                      top: card.y + METRICS.headerH,
                      width: card.w,
                      height: card.h,
                    }}
                    onMouseEnter={() => setActive(key)}
                    onFocus={() => setActive(key)}
                    onBlur={() => setActive(null)}
                  >
                    <TieCard
                      tie={tie}
                      competitionId={competitionId}
                      emphasis={card.side === 'centre'}
                      href={
                        tie ? tieHref(competitionId, season, tree[card.round].slug, tie) : null
                      }
                      placeholder={placeholderFor(card, bySlot)}
                    />
                  </div>
                )
              })}

              {/* The trophy sits in the middle of the board, above the final —
                  the place a printed bracket puts it, and the thing a reader
                  looks for first on a finished edition. It drops below the
                  board only when the final card is too near the top for it to
                  fit, which happens on a two-round bracket. */}
              {champion && finalCard && finalCard.y >= CHAMPION_H ? (
                <div
                  className="absolute"
                  style={{
                    left: finalCard.x,
                    top: finalCard.y + METRICS.headerH - CHAMPION_H,
                    width: finalCard.w,
                  }}
                >
                  <Champion name={champion} />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {champion && !(finalCard && finalCard.y >= CHAMPION_H) ? (
        <div className="mt-3">
          <Champion name={champion} />
        </div>
      ) : null}

      {entry.length ? <EntryRounds rounds={entry} competitionId={competitionId} season={season} /> : null}
    </section>
  )
}

/**
 * What an empty slot should say.
 *
 * A place in the draw nobody has reached is not nothing: it is the winner of
 * two known ties, and that is precisely what a reader is working out when they
 * look at an empty box. Where a feeder is itself undecided the box names both
 * clubs; where it is settled but the next round is not drawn, it names the club
 * that came through.
 */
function placeholderFor(
  card: PlacedCard,
  bySlot: Map<string, BracketTie>,
): [string, string] | null {
  if (card.round === 0) return null
  const feeders: string[] = []
  for (const slot of [card.slot * 2, card.slot * 2 + 1]) {
    const tie = bySlot.get(cardKey(card.round - 1, slot))
    if (!tie) return null
    if (tie.winner) feeders.push(bracketLabel(tie.winner))
    else feeders.push(`Winner of ${bracketLabel(tie.team_a)} / ${bracketLabel(tie.team_b)}`)
  }
  return [feeders[0], feeders[1]]
}

/**
 * One tie: two rows, one per club, crest and name on the left and the number
 * that settles it on the right.
 *
 * The number is the score for a settled tie and the chance to advance for an
 * undecided one — never both. A percentage next to a played tie reads as a
 * forecast of something already known.
 *
 * The winner is the only club at full contrast, and **the club that went out is
 * struck through**. That is the whole reading of a bracket at a glance: scan
 * down the names that are neither faded nor crossed and you have the path.
 *
 * A club is struck on the tie it LOST, not on every card it ever appeared on.
 * Striking it retrospectively would cross out a team on a card whose result it
 * won — the printed convention, and the honest one, is that the mark belongs to
 * the match that eliminated it.
 */
function TieCard({
  tie,
  competitionId,
  emphasis,
  href,
  placeholder,
}: {
  tie: BracketTie | null
  competitionId: string
  emphasis?: boolean
  /** Where this tie opens. Null when the edition is not addressable. */
  href?: string | null
  placeholder?: [string, string] | null
}) {
  if (!tie) {
    return (
      <div className="flex h-full w-full flex-col justify-center gap-[3px] overflow-hidden rounded-lg border border-dashed border-[var(--border-color)] px-2.5">
        {(placeholder ?? ['To be decided', '']).map((line, i) =>
          line ? (
            <span
              key={i}
              className="truncate text-[11.5px] leading-tight text-[var(--text-tertiary)]"
            >
              {line}
            </span>
          ) : null,
        )}
      </div>
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
  const meta = goals?.[2]
    ? goals[2]
    : tie.score && !goals
      ? tie.score
      : tie.pending
        ? `${fmtDate(tie.kickoff)}${tie.two_legged ? ' · two legs' : ''}`
        : null

  // Only a winner that is actually one of the two clubs settles the tie. A
  // `winner_id` matching neither side is a resolver fault, and reading it
  // literally would strike BOTH names — announcing that two teams went out of a
  // tie one of them won.
  const settled =
    tie.winner_id !== null &&
    (tie.winner_id === tie.team_a_id || tie.winner_id === tie.team_b_id)

  const shell = cn(
    'flex h-full w-full flex-col justify-center overflow-hidden rounded-lg border bg-[var(--card-bg)] text-left transition-colors',
    emphasis
      ? 'border-[color-mix(in_srgb,var(--accent-primary)_55%,var(--border-color))]'
      : 'border-[var(--border-color)] hover:border-[color-mix(in_srgb,var(--accent-primary)_45%,var(--border-color))]',
  )

  const Shell = href
    ? ({ children }: { children: React.ReactNode }) => (
        <Link
          href={href}
          aria-label={`${tie.team_a} against ${tie.team_b} — match detail`}
          className={cn(
            shell,
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]',
          )}
        >
          {children}
        </Link>
      )
    : ({ children }: { children: React.ReactNode }) => <div className={shell}>{children}</div>

  return (
    <Shell>
      {sides.map((side, i) => {
        const won = settled && side.id === tie.winner_id
        const out = settled && !won
        const favoured = side.p !== null && side.p >= 0.5
        return (
          <div
            key={`${side.id}-${side.name}`}
            data-club={side.name}
            data-out={out ? 'true' : undefined}
            className={cn(
              'flex items-center gap-1.5 px-2 py-[3px]',
              i === 0 && 'border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]',
              won && 'bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]',
            )}
          >
            <TeamCrest
              team={side.name}
              competitionId={competitionId}
              size="xs"
              className={out ? 'opacity-40' : undefined}
            />
            <span
              title={side.name}
              className={cn(
                'min-w-0 flex-1 truncate text-[11.5px]',
                // Elimination is read before anything else, so it is checked
                // first: a club that went out is never also bolded as favoured.
                out
                  ? 'text-[var(--text-tertiary)] line-through decoration-1'
                  : won || favoured
                    ? 'font-semibold text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]',
              )}
            >
              {bracketLabel(side.name)}
            </span>
            {side.goals !== null ? (
              <span
                className={cn(
                  'shrink-0 font-mono text-[11.5px] tabular-nums',
                  won ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
                )}
              >
                {side.goals}
              </span>
            ) : side.p !== null ? (
              <span
                className={cn(
                  'shrink-0 font-mono text-[10.5px] tabular-nums',
                  favoured ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]',
                )}
              >
                {(side.p * 100).toFixed(0)}%<span className="sr-only"> to advance</span>
              </span>
            ) : null}
          </div>
        )
      })}

      {meta ? (
        <div className="truncate border-t border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] px-2.5 py-[2px] text-right font-mono text-[9px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
          {meta}
        </div>
      ) : null}
    </Shell>
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
  season,
}: {
  rounds: BracketRound[]
  competitionId: string
  season?: number
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
                <li
                  key={`${tie.team_a_id}-${tie.team_b_id}-${tie.kickoff}`}
                  style={{ height: METRICS.cardH }}
                >
                  <TieCard
                    tie={tie}
                    competitionId={competitionId}
                    href={tieHref(competitionId, season, round.slug, tie)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
