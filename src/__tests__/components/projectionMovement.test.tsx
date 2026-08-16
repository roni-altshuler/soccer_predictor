import { render, screen } from '@testing-library/react'

import { ProjectionMovement } from '@/components/forecast/ProjectionMovement'
import { TodayTiles, seasonLabel } from '@/components/match/TodayTiles'
import type { Movement } from '@/lib/server/projectionHistory'

const movement = (over: Partial<Movement> = {}): Movement => ({
  competitionId: 'usa.1',
  season: 2026,
  from: '2026-08-15T07:57:18.351161+00:00',
  to: '2026-08-16T07:58:42.647451+00:00',
  matchesPlayed: 6,
  moves: [
    {
      team: 'Nashville SC', figure: 'p_title', from: 0.10, to: 0.26,
      delta: 0.1628, movedBy: 'own-result', playedFrom: 18, playedTo: 19,
    },
    {
      team: 'Vancouver', figure: 'p_title', from: 0.30, to: 0.32,
      delta: 0.0214, movedBy: 'other-results', playedFrom: 17, playedTo: 17,
    },
  ],
  ...over,
})

describe('ProjectionMovement', () => {
  it('draws nothing when there is no movement to report', () => {
    // `projectionMovement` returns null when no football was played between
    // the two snapshots. The component must not invent a shell around that.
    const { container } = render(<ProjectionMovement movement={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws nothing when a competition moved but nothing cleared the threshold', () => {
    const { container } = render(<ProjectionMovement movement={movement({ moves: [] })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('survives a payload that claims to be available but carries no moves', () => {
    // Not hypothetical. This prop crosses a `fetch`, so its TypeScript type is
    // a compile-time fiction — a payload answering `available: true` with no
    // `moves` threw "Cannot read properties of undefined" and took the whole
    // season page down with it, because an exception in render unmounts the
    // tree above the component that threw.
    const malformed = { available: true, generated_at: 'x' } as unknown as Movement
    const { container } = render(<ProjectionMovement movement={malformed} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('separates a club moved by its own result from one moved by others', () => {
    // THE test. One heading over both would credit Vancouver for a matchday
    // it did not play.
    render(<ProjectionMovement movement={movement()} />)
    expect(screen.getByText(/Moved by their own result/i)).toBeInTheDocument()
    expect(screen.getByText(/Moved by other results/i)).toBeInTheDocument()
    expect(document.querySelector('[data-move="Nashville SC"]')).toHaveAttribute(
      'data-moved-by', 'own-result')
    expect(document.querySelector('[data-move="Vancouver"]')).toHaveAttribute(
      'data-moved-by', 'other-results')
  })

  it('shows the previous value beside the new one, which is the point', () => {
    render(<ProjectionMovement movement={movement()} />)
    expect(screen.getByText('10.0% → 26.0%')).toBeInTheDocument()
    expect(screen.getByText('+16.3')).toBeInTheDocument()
  })

  it('says how much football moved it', () => {
    render(<ProjectionMovement movement={movement()} />)
    expect(document.querySelector('[data-projection-movement]')).toHaveAttribute(
      'data-matches-played', '6')
    expect(screen.getByText('6 matches played')).toBeInTheDocument()
  })

  it('colours a rising relegation chance as bad news, not good', () => {
    // Colour carries meaning in this design, so it has to track the meaning
    // rather than the arithmetic sign — up is bad for exactly one figure.
    render(<ProjectionMovement movement={movement({
      moves: [{
        team: 'Sunderland', figure: 'p_relegated', from: 0.20, to: 0.34,
        delta: 0.14, movedBy: 'own-result', playedFrom: 3, playedTo: 4,
      }],
    })} />)
    const cell = screen.getByText('+14.0')
    expect(cell.className).toContain('accent-loss')
  })

  it('always prints the retrain caveat', () => {
    render(<ProjectionMovement movement={movement()} />)
    expect(screen.getByText(/moved for reasons that have nothing to do with any team/i))
      .toBeInTheDocument()
  })
})

describe('TodayTiles', () => {
  it('counts the day rather than the pipeline', () => {
    // Rule 4: no prediction counts, no model/version chips, no refresh
    // timestamps. Every tile is a fact about football.
    render(<TodayTiles dateKey="2026-08-16" total={13} live={2} leagues={3} />)
    expect(screen.getByText('2026-27')).toBeInTheDocument()
    expect(screen.getByText('13')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders nothing on an empty day rather than a row of zeros', () => {
    const { container } = render(<TodayTiles dateKey="2026-08-16" total={0} live={0} leagues={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('seasonLabel', () => {
  it('splits the season at August, as European football does', () => {
    expect(seasonLabel('2026-08-16')).toBe('2026-27')
    expect(seasonLabel('2026-05-30')).toBe('2025-26')
    expect(seasonLabel('2026-12-26')).toBe('2026-27')
  })

  it('claims nothing from an unparseable date', () => {
    expect(seasonLabel('')).toBe('')
  })
})
