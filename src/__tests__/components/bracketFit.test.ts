import {
  GEOM,
  flowWidth,
  planBoard,
  splitScore,
  twoSidedWidth,
} from '@/components/tournament/BracketBoard'

/**
 * How the bracket decides what to draw.
 *
 * The rule this file exists to hold is **legibility first**. The previous
 * version guaranteed the whole board fitted the viewport and paid for it with a
 * transform — a Champions League bracket landed at 0.62 on a phone and 0.91 on
 * a desktop, so the thing a reader came for was rendered at two thirds size. A
 * bracket nobody can read is not an overview of anything.
 *
 * So the board is never silently shrunk. It picks the widest layout that fits,
 * pans when neither does, and scales only when a reader asks for the overview.
 */

// Champions League is 4 rounds (R16 → final), so 3 columns a side; a World Cup
// with a round of 32 is 4; a 64-team draw is 5.
const DEPTHS = [1, 2, 3, 4, 5]
const WIDTHS = [320, 360, 375, 390, 414, 600, 768, 900, 990, 1200, 1440, 1920]

describe('planBoard', () => {
  it('never shrinks the board unless the reader asks it to', () => {
    // The whole complaint about the old board in one assertion.
    for (const w of WIDTHS) {
      for (const d of DEPTHS) {
        expect([w, d, planBoard(w, d).scale]).toEqual([w, d, 1])
      }
    }
  })

  it('keeps the mirrored shape wherever it is legible at full size', () => {
    // Two side rounds is a quarter-final onwards: mirrored well inside a phone
    // era desktop, and the shape is what says who could still meet whom.
    expect(planBoard(twoSidedWidth(2), 2).layout).toBe('two-sided')
    expect(planBoard(1920, 3).layout).toBe('two-sided')
    expect(planBoard(1920, 3).fits).toBe(true)
  })

  it('falls to a single flow rather than to a smaller mirrored board', () => {
    // At 990px — the app's own content width — a 3-round bracket does not fit
    // mirrored. Flow shows identical content at full size and half the width.
    const plan = planBoard(990, 3)
    expect(plan.layout).toBe('flow')
    expect(plan.scale).toBe(1)
    expect(plan.fits).toBe(true)
    expect(plan.width).toBeLessThanOrEqual(990)
  })

  it('pans when even the flow will not fit, instead of scaling to nothing', () => {
    const phone = planBoard(375, 3)
    expect(phone.layout).toBe('flow')
    expect(phone.scale).toBe(1)
    expect(phone.fits).toBe(false)
  })

  it('honours a request to fit, and then genuinely fits', () => {
    for (const w of WIDTHS) {
      for (const d of DEPTHS) {
        const plan = planBoard(w, d, true)
        const drawn = plan.width * plan.scale
        // Sub-pixel slack only; anything more is a scrollbar.
        expect([w, d, drawn <= w + 0.5]).toEqual([w, d, true])
      }
    }
  })

  it('fits to the mirrored board, because the shape is the point of asking', () => {
    const plan = planBoard(375, 3, true)
    expect(plan.layout).toBe('two-sided')
    expect(plan.scale).toBeLessThan(1)
  })

  it('never scales up past life size', () => {
    expect(planBoard(3000, 2, true).scale).toBe(1)
    expect(planBoard(3000, 2, true).fits).toBe(true)
  })

  it('draws the canonical shape when the width is not known yet', () => {
    // Server render and jsdom both report 0. Guessing a phone layout there
    // would ship the panning board to every crawler and every test.
    const plan = planBoard(0, 3)
    expect(plan.layout).toBe('two-sided')
    expect(plan.scale).toBe(1)
  })

  it('handles a bracket with no side rounds at all', () => {
    // A one-tie "bracket" is just a final.
    expect(planBoard(375, 0).layout).toBe('two-sided')
    expect(planBoard(375, 0).scale).toBe(1)
  })

  it('keeps a card wide enough for a real club name', () => {
    // The reason the column width is not a free parameter. Two rows of
    // "Borussia Mönchengladbach" plus a crest and a score is what sets it, and
    // dropping below this is how the old board became unreadable.
    expect(GEOM.col).toBeGreaterThanOrEqual(180)
    expect(GEOM.card).toBeGreaterThanOrEqual(56)
  })

  it('makes the flow exactly the cheaper half of the mirrored board', () => {
    for (const d of DEPTHS) {
      expect(flowWidth(d)).toBeLessThan(twoSidedWidth(d))
      expect(twoSidedWidth(d) - flowWidth(d)).toBe(d * (GEOM.col + GEOM.conn))
    }
  })
})

describe('splitScore', () => {
  it('splits an aggregate into the two clubs it belongs to', () => {
    expect(splitScore('3-1')).toEqual(['3', '1', null])
  })

  it('keeps a shootout as its own line rather than dropping it', () => {
    // "1-1" alone reads as a drawn tie with a team advancing for no stated
    // reason, which is exactly what the card used to show.
    expect(splitScore('1-1 (4-2 pens)')).toEqual(['1', '1', '4-2 pens'])
  })

  it('accepts an en dash, because sources are not consistent about it', () => {
    expect(splitScore('2–0')).toEqual(['2', '0', null])
  })

  it('returns null for something it cannot parse, so the card prints it whole', () => {
    // Guessing at "w/o" or "awarded" would put a wrong number beside a club.
    expect(splitScore('awarded')).toBeNull()
    expect(splitScore(null)).toBeNull()
    expect(splitScore('')).toBeNull()
  })
})
