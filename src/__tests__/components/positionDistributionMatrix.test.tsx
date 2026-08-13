import { render, screen, within } from '@testing-library/react'

import { SingleTeamDistribution } from '@/components/simulator/PositionDistributionMatrix'
import type { Standing } from '@/lib/api'

/**
 * The finishing-position grid, and whether a reader can actually see it.
 *
 * The cell ramp mixes `--accent-ai` (#c3d9f3) into `--card-bg` (#0d0d0d). At
 * the old 4% floor that produced rgb(20,21,22) against an empty cell's
 * rgb(21,21,21) — a contrast ratio of 1.00, which is not a low-contrast cell
 * but literally the same colour. Most of a 20x20 grid sits in the bottom
 * tenth of the scale, so most of the grid was black squares, and the number
 * only printed above 55% of the row maximum.
 *
 * What is pinned here is the part that is easy to undo by nudging a constant:
 * every real probability prints as TEXT, and the ink flips with the cell so
 * it never lands grey-on-mid-blue.
 */

const standing = (dist: Record<number, number>, name = 'Arsenal'): Standing =>
  ({ team_name: name, position_distribution: dist }) as unknown as Standing

const cells = () => screen.getAllByRole('cell')

/** `color-mix(in srgb, var(--accent-ai) 42%, var(--card-bg))` -> 42 */
const mixOf = (el: HTMLElement): number => {
  const m = /accent-ai\)\s*(\d+)%/.exec(el.style.background)
  return m ? Number(m[1]) : -1
}

describe('PositionDistributionMatrix', () => {
  it('prints the number in every cell that holds one', () => {
    // The house rule: a probability is text, and colour is the second
    // channel. Printing only the peak left 380 of 400 cells blank and made
    // hovering the only way to read the grid.
    render(<SingleTeamDistribution standing={standing({ 1: 0.5, 2: 0.3, 3: 0.2 })} numTeams={3} />)

    expect(cells().map((c) => c.textContent)).toEqual(['50', '30', '20'])
  })

  it('prints a sub-1% cell to one decimal rather than rounding it to nothing', () => {
    render(<SingleTeamDistribution standing={standing({ 1: 0.9, 2: 0.094, 3: 0.006 })} numTeams={3} />)
    expect(cells().map((c) => c.textContent)).toEqual(['90', '9.4', '0.6'])
  })

  it('leaves a cell the team never finished in empty', () => {
    // Zero and "very small" must not look the same. A printed 0 in eighteen
    // cells reads as data.
    render(<SingleTeamDistribution standing={standing({ 1: 1 })} numTeams={3} />)
    const [first, ...rest] = cells()
    expect(first.textContent).toBe('100')
    expect(rest.map((c) => c.textContent)).toEqual(['', ''])
  })

  it('never tints a real cell so faintly it matches an empty one', () => {
    // 0.1% of the row maximum is the floor case: it must still be visibly a
    // cell with something in it.
    render(<SingleTeamDistribution standing={standing({ 1: 0.999, 2: 0.001 })} numTeams={2} />)

    const faint = cells()[1]
    expect(mixOf(faint)).toBeGreaterThanOrEqual(20)
  })

  it('scales the fill with the probability', () => {
    render(
      <SingleTeamDistribution standing={standing({ 1: 0.6, 2: 0.3, 3: 0.1 })} numTeams={3} />,
    )
    const mixes = cells().map(mixOf)
    expect(mixes[0]).toBeGreaterThan(mixes[1])
    expect(mixes[1]).toBeGreaterThan(mixes[2])
    expect(mixes[0]).toBeLessThanOrEqual(88)
  })

  it('flips the ink with the cell so the number is never lost in it', () => {
    // Below the flip the cell is dark and the ink white; above it the cell is
    // light and the ink black. The worst case on this ramp is 4.55:1, which
    // clears AA for small text — a single fixed ink cannot.
    render(<SingleTeamDistribution standing={standing({ 1: 1, 2: 0.1 })} numTeams={2} />)

    const [bright, dim] = cells()
    expect(bright.style.color).toBe('var(--accent-on-primary)')
    expect(dim.style.color).toBe('var(--text-primary)')
  })

  it('outlines the modal finish in ink its own cell can carry', () => {
    // A fixed accent ring disappeared on exactly the cells most likely to be
    // the peak, because those are the brightest.
    render(<SingleTeamDistribution standing={standing({ 1: 0.7, 2: 0.3 })} numTeams={2} />)
    expect(cells()[0].style.boxShadow).toContain('var(--accent-on-primary)')
  })

  it('describes every cell for a screen reader, empty ones included', () => {
    render(<SingleTeamDistribution standing={standing({ 1: 0.8, 2: 0 })} numTeams={2} />)
    expect(cells()[0]).toHaveAttribute(
      'aria-label',
      'Arsenal — 1st in 80% of simulations',
    )
    expect(cells()[1]).toHaveAttribute('aria-label', 'Arsenal — 2nd in 0.0% of simulations')
  })

  it('labels the grid with the team it belongs to', () => {
    render(<SingleTeamDistribution standing={standing({ 1: 1 }, 'Inter')} numTeams={1} />)
    const grid = screen.getByRole('table')
    expect(grid).toHaveAttribute('aria-label', 'Inter finishing-position distribution')
    expect(within(grid).getByRole('columnheader')).toHaveTextContent('1')
  })
})
