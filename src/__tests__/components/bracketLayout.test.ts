import {
  METRICS,
  cardKey,
  layoutFlow,
  layoutMirrored,
  parentSlot,
  pathToFinal,
  planBoard,
  splitScore,
} from '@/components/tournament/bracketLayout'

/**
 * The bracket, as arithmetic.
 *
 * The board used to be nested flex boxes: `flex-1` cells for alignment and a
 * `h-1/2` div with two borders for each connector. That gets a bracket
 * approximately right and cannot be checked — whether a card sat on the centre
 * line between the two feeding it was an emergent property of the box model,
 * verifiable only by looking at it.
 *
 * It is a pure function now, so the defining property of a bracket is a test:
 * **the card at slot s sits exactly halfway between the cards at 2s and 2s+1**.
 * Break that and the old board still drew a tidy shape in which the wrong two
 * teams appeared to have played each other.
 */

const UNIT = METRICS.cardH + METRICS.gap
const at = (layout: ReturnType<typeof layoutFlow>, round: number, slot: number) =>
  layout.cards.find((c) => c.round === round && c.slot === slot)!

describe('layoutFlow', () => {
  const layout = layoutFlow([8, 4, 2, 1])

  it('puts every card exactly halfway between the two that feed it', () => {
    for (let round = 0; round < 3; round++) {
      const width = [8, 4, 2][round]
      for (let slot = 0; slot < width / 2; slot++) {
        const parent = at(layout, round + 1, slot)
        const a = at(layout, round, slot * 2)
        const b = at(layout, round, slot * 2 + 1)
        expect([round, slot, parent.cy]).toEqual([round, slot, (a.cy + b.cy) / 2])
      }
    }
  })

  it('doubles the spacing at every round', () => {
    const spacing = (round: number, width: number) =>
      at(layout, round, 1).cy - at(layout, round, 0).cy === UNIT * 2 ** round && width > 1
    expect(spacing(0, 8)).toBe(true)
    expect(spacing(1, 4)).toBe(true)
    expect(spacing(2, 2)).toBe(true)
  })

  it('gives every column the same height, which is what makes it a bracket', () => {
    const extent = (round: number) => {
      const cards = layout.cards.filter((c) => c.round === round)
      const top = Math.min(...cards.map((c) => c.y))
      const bottom = Math.max(...cards.map((c) => c.y + c.h))
      return [top + bottom] // midpoint*2 — same for every round when centred
    }
    expect(extent(0)).toEqual(extent(1))
    expect(extent(1)).toEqual(extent(2))
    expect(extent(2)).toEqual(extent(3))
    expect(layout.height).toBe(8 * UNIT)
  })

  it('never overlaps two cards of the same round', () => {
    for (const round of [0, 1, 2]) {
      const cards = layout.cards
        .filter((c) => c.round === round)
        .sort((a, b) => a.y - b.y)
      for (let i = 1; i < cards.length; i++) {
        expect([round, i, cards[i].y >= cards[i - 1].y + cards[i - 1].h]).toEqual([round, i, true])
      }
    }
  })

  it('draws one connector per feeding card, and none out of the final', () => {
    // 8 + 4 + 2 cards feed something; the final feeds nothing.
    expect(layout.links).toHaveLength(14)
    expect(layout.links.some((l) => l.from === cardKey(3, 0))) .toBe(false)
  })

  it('starts each connector at a card edge, not somewhere inside it', () => {
    // The old connector was a spacer div with borders; a path that begins
    // inside a card renders as a line crossing the club names.
    const first = layout.links.find((l) => l.from === cardKey(0, 0))!
    const card = at(layout, 0, 0)
    const [, x, y] = /^M ([\d.]+) ([\d.]+)/.exec(first.d)!.map(Number) as unknown as number[]
    expect(x).toBe(card.x + card.w)
    expect(y).toBe(card.cy)
  })

  it('gives the final more room than a side round', () => {
    expect(at(layout, 3, 0).w).toBe(METRICS.finalW)
    expect(at(layout, 0, 0).w).toBe(METRICS.colW)
    expect(METRICS.finalW).toBeGreaterThan(METRICS.colW)
  })

  it('handles a bracket that is only a final', () => {
    const only = layoutFlow([1])
    expect(only.cards).toHaveLength(1)
    expect(only.links).toHaveLength(0)
    expect(only.height).toBe(UNIT)
  })
})

describe('layoutMirrored', () => {
  const layout = layoutMirrored([8, 4, 2, 1])

  it('splits the draw into the two halves the feeder rule produces', () => {
    const round0 = layout.cards.filter((c) => c.round === 0)
    expect(round0.filter((c) => c.side === 'left').map((c) => c.slot)).toEqual([0, 1, 2, 3])
    expect(round0.filter((c) => c.side === 'right').map((c) => c.slot)).toEqual([4, 5, 6, 7])
  })

  it('keeps the midpoint rule on both sides', () => {
    for (const slot of [0, 1, 2, 3]) {
      const parent = layout.cards.find((c) => c.round === 1 && c.slot === parentSlot(slot))!
      const sibling = layout.cards.find(
        (c) => c.round === 0 && c.slot === (slot % 2 === 0 ? slot + 1 : slot - 1),
      )!
      const self = layout.cards.find((c) => c.round === 0 && c.slot === slot)!
      expect([slot, parent.cy]).toEqual([slot, (self.cy + sibling.cy) / 2])
    }
  })

  it('puts the final in the middle, once', () => {
    const finals = layout.cards.filter((c) => c.round === 3)
    expect(finals).toHaveLength(1)
    expect(finals[0].side).toBe('centre')
    expect(finals[0].cy).toBe(layout.height / 2)
    // Horizontally central to within a card width: the two halves are the same
    // shape, so anything else means one side was built wrong.
    expect(Math.abs(finals[0].cx - layout.width / 2)).toBeLessThan(1)
  })

  it('runs the right-hand half inwards, deepest round nearest the final', () => {
    const right = layout.columns.filter((c) => c.side === 'right')
    // Reading left to right on the page, the rounds count back down to the
    // widest at the outer edge.
    expect(right.map((c) => c.round)).toEqual([2, 1, 0])
  })

  it('is exactly half as tall and roughly twice as wide as the flow', () => {
    const flow = layoutFlow([8, 4, 2, 1])
    expect(layout.height).toBe(flow.height / 2)
    expect(layout.width).toBeGreaterThan(flow.width)
  })

  it('draws connectors on the right half pointing inwards', () => {
    const rightLink = layout.links.find((l) => l.from === cardKey(0, 4))!
    const from = layout.cards.find((c) => c.round === 0 && c.slot === 4)!
    const [, x] = /^M ([\d.]+)/.exec(rightLink.d)!.map(Number) as unknown as number[]
    // Leaves the LEFT edge of a right-hand card, because that is the edge
    // facing the final.
    expect(x).toBe(from.x)
  })

  it('falls back to a flow when there is nothing to mirror', () => {
    expect(layoutMirrored([1]).cards).toHaveLength(1)
  })
})

describe('pathToFinal', () => {
  it('traces a card through every round it would have to win', () => {
    // Slot 5 of the round of 16 feeds slot 2, then slot 1, then the final.
    expect(pathToFinal(0, 5, 4)).toEqual(['0:5', '1:2', '2:1', '3:0'])
  })

  it('is just the final, from the final', () => {
    expect(pathToFinal(3, 0, 4)).toEqual(['3:0'])
  })
})

describe('planBoard', () => {
  const DEPTHS: number[][] = [
    [2, 1],
    [4, 2, 1],
    [8, 4, 2, 1],
    [16, 8, 4, 2, 1],
    [32, 16, 8, 4, 2, 1],
  ]
  const WIDTHS = [320, 360, 375, 390, 414, 600, 768, 900, 990, 1200, 1440, 1920]

  it('never shrinks the board unless the reader asks it to', () => {
    // The whole complaint about the old board, in one assertion.
    for (const w of WIDTHS) {
      for (const d of DEPTHS) {
        expect([w, d.length, planBoard(w, d).scale]).toEqual([w, d.length, 1])
      }
    }
  })

  it('keeps the mirrored shape wherever it fits at full size', () => {
    expect(planBoard(1920, [4, 2, 1]).mode).toBe('mirrored')
    expect(planBoard(1920, [4, 2, 1]).fits).toBe(true)
  })

  it('falls to the flow rather than to a smaller mirrored board', () => {
    const plan = planBoard(990, [8, 4, 2, 1])
    expect(plan.mode).toBe('flow')
    expect(plan.scale).toBe(1)
    expect(plan.fits).toBe(true)
    expect(plan.layout.width).toBeLessThanOrEqual(990)
  })

  it('pans when even the flow will not fit, instead of scaling to nothing', () => {
    const phone = planBoard(375, [8, 4, 2, 1])
    expect(phone.mode).toBe('flow')
    expect(phone.scale).toBe(1)
    expect(phone.fits).toBe(false)
  })

  it('honours a request to fit, and then genuinely fits', () => {
    for (const w of WIDTHS) {
      for (const d of DEPTHS) {
        const plan = planBoard(w, d, true)
        expect([w, d.length, plan.layout.width * plan.scale <= w + 0.5]).toEqual([
          w,
          d.length,
          true,
        ])
      }
    }
  })

  it('fits to the mirrored board, because the shape is the point of asking', () => {
    expect(planBoard(375, [8, 4, 2, 1], true).mode).toBe('mirrored')
    expect(planBoard(375, [8, 4, 2, 1], true).scale).toBeLessThan(1)
  })

  it('never scales up past life size', () => {
    expect(planBoard(3000, [4, 2, 1], true).scale).toBe(1)
  })

  it('draws the canonical shape when the width is not known yet', () => {
    // Server render and jsdom both report 0.
    expect(planBoard(0, [8, 4, 2, 1]).mode).toBe('mirrored')
    expect(planBoard(0, [8, 4, 2, 1]).scale).toBe(1)
  })

  it('keeps a card wide enough for a real club name', () => {
    // Two rows of "Borussia Mönchengladbach" plus a crest and a score is what
    // sets the column width; dropping below this is how a board becomes
    // unreadable.
    expect(METRICS.colW).toBeGreaterThanOrEqual(180)
    expect(METRICS.cardH).toBeGreaterThanOrEqual(56)
  })
})

describe('splitScore', () => {
  it('splits an aggregate onto the two clubs it belongs to', () => {
    expect(splitScore('3-1')).toEqual(['3', '1', null])
  })

  it('keeps a shootout as its own line rather than dropping it', () => {
    expect(splitScore('1-1 (4-2 pens)')).toEqual(['1', '1', '4-2 pens'])
  })

  it('accepts an en dash, because sources are not consistent about it', () => {
    expect(splitScore('2–0')).toEqual(['2', '0', null])
  })

  it('returns null for something it cannot parse, so the card prints it whole', () => {
    expect(splitScore('awarded')).toBeNull()
    expect(splitScore(null)).toBeNull()
    expect(splitScore('')).toBeNull()
  })
})
