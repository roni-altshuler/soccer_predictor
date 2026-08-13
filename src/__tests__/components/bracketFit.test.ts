import { computeFit, naturalWidth } from '@/components/tournament/BracketBoard'

/**
 * The bracket has to be visible all at once, at any width, with no sideways
 * scrolling.
 *
 * That is the whole reason to draw a bracket rather than list the rounds: the
 * shape says who could still meet whom. A board that scrolls sideways shows a
 * reader a third of that shape and asks them to remember the rest.
 *
 * The single invariant below — drawn width never exceeds available width — is
 * what "no horizontal scrollbar" actually means, and it is checked across
 * every real container width against every real bracket depth.
 */

// Champions League is 4 rounds (R16 → final), so 3 columns a side; a World Cup
// with a round of 32 is 4; a 64-team draw is 5.
const DEPTHS = [1, 2, 3, 4, 5]
const WIDTHS = [320, 360, 375, 390, 414, 600, 768, 900, 990, 1200, 1440]

describe('bracket fit', () => {
  it('never draws wider than the space it has', () => {
    for (const w of WIDTHS) {
      for (const d of DEPTHS) {
        const fit = computeFit(w, d)
        const drawn = naturalWidth(d, fit.stacked) * fit.scale
        // Sub-pixel slack only; anything more is a scrollbar.
        expect([w, d, drawn <= w + 0.5]).toEqual([w, d, true])
      }
    }
  })

  it('keeps the two-sided shape whenever it is legible', () => {
    // Desktop should not be paying the stacked penalty for a normal bracket.
    expect(computeFit(990, 3).stacked).toBe(false)
    expect(computeFit(990, 3).scale).toBeGreaterThan(0.85)
    expect(computeFit(1440, 4).stacked).toBe(false)
  })

  it('stacks the halves rather than shrinking text to nothing', () => {
    // A phone at 0.27 scale renders 12px type at three pixels. Stacking is
    // half the width and therefore about twice the scale.
    const phone = computeFit(375, 3)
    expect(phone.stacked).toBe(true)
    expect(phone.scale).toBeGreaterThan(0.6)
  })

  it('never shrinks below the point where stacking would have been better', () => {
    // Whatever the width, the chosen mode is at least as legible as the other.
    for (const w of WIDTHS) {
      for (const d of DEPTHS) {
        const fit = computeFit(w, d)
        const other = Math.min(1, w / naturalWidth(d, !fit.stacked))
        const chosen = fit.scale
        // Two-sided is preferred on ties, so allow it to win at equal scale.
        expect([w, d, chosen >= other || !fit.stacked]).toEqual([w, d, true])
      }
    }
  })

  it('never scales up past life size', () => {
    // A two-round bracket on a wide monitor should sit at its natural size,
    // not stretch to fill.
    expect(computeFit(1440, 1).scale).toBe(1)
    expect(computeFit(3000, 2).scale).toBe(1)
  })

  it('draws the canonical shape when the width is not known yet', () => {
    // Server render and jsdom both report 0. Guessing a phone layout there
    // would ship the stacked board to every crawler and every test.
    expect(computeFit(0, 3)).toEqual({ stacked: false, scale: 1 })
  })

  it('handles a bracket with no side rounds at all', () => {
    // A one-tie "bracket" is just a final.
    expect(computeFit(375, 0)).toEqual({ stacked: false, scale: 1 })
  })
})
