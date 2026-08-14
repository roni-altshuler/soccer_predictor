/**
 * Where every card and every connector on a bracket goes.
 *
 * The board was built out of nested flex boxes: each column a column of
 * `flex-1` cells, each connector a `h-1/2` div with two borders on it. That
 * gets a bracket *approximately* right and cannot be checked — the alignment
 * is an emergent property of the box model, so the only way to know a card sat
 * on the centre line between the two that feed it was to look at it, and the
 * connector was a rectangle with two edges hidden rather than a line drawn
 * between two points.
 *
 * This module computes the geometry instead, as arithmetic, in one place:
 *
 *   Y   a round's cards are spaced at `unit · 2^depth`, so every card sits at
 *       exactly the midpoint of the two it is fed by. That is the defining
 *       property of a bracket and it is now a property of a pure function.
 *   X   columns are laid out left to right (flow) or inwards from both edges
 *       with the final in the middle (mirrored).
 *   ⌐   connectors are SVG paths drawn between real card edges, with rounded
 *       corners, instead of borders on a spacer div.
 *
 * Everything is returned as plain numbers. The component positions absolutely
 * from them and draws one `<svg>` under the cards, which is also what makes
 * hover-highlighting a whole route possible: a path knows which two cards it
 * joins, so it can dim with them.
 */

export interface BracketMetrics {
  /** Card height. Two club rows plus an optional meta line. */
  cardH: number
  /** Vertical space between two cards of the FIRST round. */
  gap: number
  /** Card width in a side column. */
  colW: number
  /** Horizontal space between two columns — where the connector is drawn. */
  connW: number
  /** The final is wider: it is the card everyone looks for. */
  finalW: number
  /** Space reserved above the board for round headings. */
  headerH: number
  /** Corner radius on a connector elbow. */
  radius: number
}

export const METRICS: BracketMetrics = {
  cardH: 62,
  gap: 12,
  colW: 196,
  connW: 30,
  finalW: 212,
  headerH: 34,
  radius: 8,
}

export type Side = 'left' | 'right' | 'centre'

export interface PlacedCard {
  /** Index into the rounds array — 0 is the widest round. */
  round: number
  /** Slot within the round, as published by the artifact. */
  slot: number
  x: number
  y: number
  w: number
  h: number
  side: Side
  /** Card centre, which is what connectors join. */
  cx: number
  cy: number
}

export interface PlacedColumn {
  round: number
  x: number
  w: number
  side: Side
}

export interface PlacedLink {
  /** `${round}:${slot}` of the feeding card. */
  from: string
  /** `${round}:${slot}` of the card it feeds. */
  to: string
  d: string
}

export interface BoardLayout {
  width: number
  height: number
  cards: PlacedCard[]
  columns: PlacedColumn[]
  links: PlacedLink[]
}

export const cardKey = (round: number, slot: number) => `${round}:${slot}`

/** The slot a tie feeds into: the tie at slot `s` is fed by `2s` and `2s+1`. */
export const parentSlot = (slot: number) => Math.floor(slot / 2)

/**
 * The route from a card to the final: itself, then what it feeds, and so on.
 *
 * Used for hover highlighting. A bracket's whole reason for existing is that
 * it shows who could still meet whom, and tracing one team's remaining path is
 * how a reader actually asks that question.
 */
export function pathToFinal(round: number, slot: number, rounds: number): string[] {
  const keys: string[] = []
  let s = slot
  for (let r = round; r < rounds; r++) {
    keys.push(cardKey(r, s))
    s = parentSlot(s)
  }
  return keys
}

/** An elbow: out of one card, across, up or down, and into the next. */
function elbow(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
): string {
  const midX = (fromX + toX) / 2
  const dir = Math.sign(toX - fromX) || 1
  const vDir = Math.sign(toY - fromY)
  // A straight run needs no corners — and rounding one would bulge it.
  if (Math.abs(toY - fromY) < 0.5) return `M ${fromX} ${fromY} L ${toX} ${fromY}`

  const r = Math.min(radius, Math.abs(toY - fromY) / 2, Math.abs(midX - fromX))
  return [
    `M ${fromX} ${fromY}`,
    `L ${midX - r * dir} ${fromY}`,
    `Q ${midX} ${fromY} ${midX} ${fromY + r * vDir}`,
    `L ${midX} ${toY - r * vDir}`,
    `Q ${midX} ${toY} ${midX + r * dir} ${toY}`,
    `L ${toX} ${toY}`,
  ].join(' ')
}

interface ColumnPlan {
  round: number
  /** Slots this column draws, in order down the page. */
  slots: number[]
  x: number
  w: number
  side: Side
}

/**
 * Place cards down a column so that each sits on the centre line of the two
 * that feed it.
 *
 * The spacing of round `d` is `unit · 2^d` where `unit` is one card plus one
 * gap. Consequently the total height of every column is identical and equal to
 * the first round's — which is what makes a bracket look like a bracket rather
 * than like columns of different lengths.
 */
function placeColumn(plan: ColumnPlan, depth: number, metrics: BracketMetrics): PlacedCard[] {
  const unit = metrics.cardH + metrics.gap
  const spacing = unit * 2 ** depth
  return plan.slots.map((slot, i) => {
    const cy = (i + 0.5) * spacing
    return {
      round: plan.round,
      slot,
      x: plan.x,
      y: cy - metrics.cardH / 2,
      w: plan.w,
      h: metrics.cardH,
      side: plan.side,
      cx: plan.x + plan.w / 2,
      cy,
    }
  })
}

function link(from: PlacedCard, to: PlacedCard, metrics: BracketMetrics): PlacedLink {
  // Leave from the edge facing the card being fed, and arrive at the facing
  // edge of that one. Mirrored halves therefore draw inwards from both sides
  // with no special-casing beyond which edge is "out".
  const goingRight = to.cx > from.cx
  const fromX = goingRight ? from.x + from.w : from.x
  const toX = goingRight ? to.x : to.x + to.w
  return {
    from: cardKey(from.round, from.slot),
    to: cardKey(to.round, to.slot),
    d: elbow(fromX, from.cy, toX, to.cy, metrics.radius),
  }
}

function connect(cards: PlacedCard[], metrics: BracketMetrics): PlacedLink[] {
  const byKey = new Map(cards.map((c) => [cardKey(c.round, c.slot), c]))
  const links: PlacedLink[] = []
  for (const card of cards) {
    const parent = byKey.get(cardKey(card.round + 1, parentSlot(card.slot)))
    if (parent) links.push(link(card, parent, metrics))
  }
  return links
}

/**
 * Left to right, every round once, ending at the final.
 *
 * Half the width of the mirrored board and identical in content — the layout a
 * narrow screen gets, and the one a phone pans through.
 */
export function layoutFlow(
  roundSlots: number[],
  metrics: BracketMetrics = METRICS,
): BoardLayout {
  if (!roundSlots.length) return { width: 0, height: 0, cards: [], columns: [], links: [] }

  const unit = metrics.cardH + metrics.gap
  const plans: ColumnPlan[] = []
  let x = 0
  roundSlots.forEach((slots, round) => {
    const isFinal = round === roundSlots.length - 1 && slots === 1
    const w = isFinal ? metrics.finalW : metrics.colW
    plans.push({
      round,
      slots: Array.from({ length: slots }, (_, i) => i),
      x,
      w,
      side: isFinal ? 'centre' : 'left',
    })
    x += w + metrics.connW
  })

  const cards = plans.flatMap((plan, depth) => placeColumn(plan, depth, metrics))
  return {
    width: x - metrics.connW,
    height: roundSlots[0] * unit,
    cards,
    columns: plans.map(({ round, x: cx, w, side }) => ({ round, x: cx, w, side })),
    links: connect(cards, metrics),
  }
}

/**
 * Both halves of the draw running inwards, meeting once at the final.
 *
 * The shape a bracket is printed in, and the shape that carries the
 * information: the two routes to the final are the two things a reader is
 * comparing. Slots `0..n/2-1` are the top half and the rest the bottom, which
 * is exactly the split the feeder rule produces.
 */
export function layoutMirrored(
  roundSlots: number[],
  metrics: BracketMetrics = METRICS,
): BoardLayout {
  if (!roundSlots.length) return { width: 0, height: 0, cards: [], columns: [], links: [] }
  // A bracket with no side rounds is a final on its own, and mirroring one
  // card either side of itself is not a thing.
  if (roundSlots.length === 1) return layoutFlow(roundSlots, metrics)

  const unit = metrics.cardH + metrics.gap
  const sides = roundSlots.slice(0, -1)
  const finalRound = roundSlots.length - 1
  const height = (roundSlots[0] / 2) * unit

  const leftPlans: ColumnPlan[] = []
  let x = 0
  sides.forEach((slots, round) => {
    leftPlans.push({
      round,
      slots: Array.from({ length: slots / 2 }, (_, i) => i),
      x,
      w: metrics.colW,
      side: 'left',
    })
    x += metrics.colW + metrics.connW
  })

  const finalX = x
  x += metrics.finalW + metrics.connW

  const rightPlans: ColumnPlan[] = []
  // Reversed: the deepest side round sits nearest the final on both sides.
  for (let i = sides.length - 1; i >= 0; i--) {
    const slots = sides[i]
    rightPlans.push({
      round: i,
      slots: Array.from({ length: slots / 2 }, (_, j) => slots / 2 + j),
      x,
      w: metrics.colW,
      side: 'right',
    })
    x += metrics.colW + metrics.connW
  }

  const cards = [
    ...leftPlans.flatMap((plan, depth) => placeColumn(plan, depth, metrics)),
    ...rightPlans.flatMap((plan) => placeColumn(plan, plan.round, metrics)),
    {
      round: finalRound,
      slot: 0,
      x: finalX,
      y: height / 2 - metrics.cardH / 2,
      w: metrics.finalW,
      h: metrics.cardH,
      side: 'centre' as Side,
      cx: finalX + metrics.finalW / 2,
      cy: height / 2,
    },
  ]

  return {
    width: x - metrics.connW,
    height,
    cards,
    columns: [
      ...leftPlans.map(({ round, x: cx, w, side }) => ({ round, x: cx, w, side })),
      { round: finalRound, x: finalX, w: metrics.finalW, side: 'centre' as Side },
      ...rightPlans.map(({ round, x: cx, w, side }) => ({ round, x: cx, w, side })),
    ],
    links: connect(cards, metrics),
  }
}

export type LayoutMode = 'mirrored' | 'flow'

export interface Plan {
  mode: LayoutMode
  /** 1 unless the reader asked to fit an oversized board to the width. */
  scale: number
  /** Whether the chosen layout fits the width without panning. */
  fits: boolean
  layout: BoardLayout
}

/**
 * Choose a layout for the width available.
 *
 * **Legibility first.** The board is never silently shrunk: it picks the
 * widest layout that fits at full size, pans when neither does, and scales
 * only when a reader asks for the overview. The version this replaced fitted
 * the viewport by transform — 0.62 on a phone, 0.91 on a desktop — so the one
 * thing a reader came for was rendered at two thirds size.
 */
export function planBoard(
  width: number,
  roundSlots: number[],
  fit = false,
  metrics: BracketMetrics = METRICS,
): Plan {
  const mirrored = layoutMirrored(roundSlots, metrics)
  const flow = layoutFlow(roundSlots, metrics)

  // Width 0 means it has not been measured — server render, or jsdom, which
  // implements no layout. Draw the canonical shape rather than guessing.
  if (!width) return { mode: 'mirrored', scale: 1, fits: true, layout: mirrored }

  if (fit) {
    return {
      mode: 'mirrored',
      scale: Math.min(1, width / Math.max(1, mirrored.width)),
      fits: true,
      layout: mirrored,
    }
  }

  if (width >= mirrored.width) return { mode: 'mirrored', scale: 1, fits: true, layout: mirrored }
  if (width >= flow.width) return { mode: 'flow', scale: 1, fits: true, layout: flow }
  return { mode: 'flow', scale: 1, fits: false, layout: flow }
}

/** Aggregate scores are published as "3-1", sometimes "1-1 (4-2 pens)". */
export function splitScore(score: string | null): [string, string, string | null] | null {
  if (!score) return null
  const m = /^\s*(\d+)\s*[-–]\s*(\d+)\s*(.*)$/.exec(score)
  if (!m) return null
  const extra = m[3].trim()
  return [m[1], m[2], extra ? extra.replace(/^\(|\)$/g, '') : null]
}
