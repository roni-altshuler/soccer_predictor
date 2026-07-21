/**
 * MatchTheater component tests — the render-nothing paths (the honesty gates
 * seen from the outside) and the readout the surface publishes when the field
 * IS countable. The canvas 2D context is stubbed; no pixels are asserted.
 */
import { render, screen, waitFor } from '@testing-library/react'

import { MatchTheater } from '../MatchTheater'
import type { MatchDetails, MatchEvent } from '../../match/detail/types'

function makeMatch(overrides: Partial<MatchDetails> = {}): MatchDetails {
  return {
    id: 'test-match',
    home_team: 'Aston Villa',
    away_team: 'Liverpool',
    home_score: 1,
    away_score: 0,
    status: 'FT',
    date: '2026-04-01T19:00:00Z',
    league: 'Premier League',
    leagueId: 'eng.1',
    events: [{ type: 'goal', minute: 20, player: 'Scorer', team: 'home' } as MatchEvent],
    lineups: { home: [], away: [] },
    stats: {
      possession: [50, 50],
      shots: [0, 0],
      shotsOnTarget: [0, 0],
      corners: [0, 0],
      fouls: [0, 0],
    },
    h2h: { homeWins: 0, draws: 0, awayWins: 0, recentMatches: [] },
    ...overrides,
  }
}

function fullField() {
  const cells = []
  for (let diff = -3; diff <= 3; diff++) {
    for (let minute = 0; minute <= 90; minute += 5) {
      cells.push({ diff, minute, n: 1000, w: 100 + diff * 10 + minute / 5, d: 10, l: 400 })
    }
  }
  return { gender: 'M', matchesCovered: 35463, minSample: 50, cells }
}

/** A no-op 2D context — enough for the render loop to run without a canvas backend. */
function stubCanvas() {
  const noop = () => {}
  const ctx = {
    canvas: null,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    fillText: noop,
    strokeText: noop,
    setTransform: noop,
  } as unknown as CanvasRenderingContext2D
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => ctx as unknown as RenderingContext)
}

const originalFetch = global.fetch

afterEach(() => {
  jest.restoreAllMocks()
  global.fetch = originalFetch
})

function mockFetch(body: unknown, ok = true) {
  global.fetch = jest.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch
}

describe('MatchTheater — renders nothing', () => {
  it('for an unfinished match, and never asks for the field', async () => {
    mockFetch(fullField())
    const { container } = render(<MatchTheater match={makeMatch()} isFinished={false} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('when the field route is unavailable', async () => {
    mockFetch(null, false)
    const { container } = render(<MatchTheater match={makeMatch()} isFinished />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('when the events do not reproduce the final score', async () => {
    mockFetch(fullField())
    const match = makeMatch({ home_score: 3, away_score: 0 })
    const { container } = render(<MatchTheater match={match} isFinished />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('when the match had no goals', async () => {
    mockFetch(fullField())
    const match = makeMatch({ home_score: 0, away_score: 0, events: [] })
    const { container } = render(<MatchTheater match={match} isFinished />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('when a run of the path rests on a thin state', async () => {
    const field = fullField()
    // Thin the level state the match passed through before its goal.
    for (const cell of field.cells) {
      if (cell.diff === 0 && cell.minute === 10) cell.n = 40
    }
    mockFetch(field)
    const { container } = render(<MatchTheater match={makeMatch()} isFinished />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe('MatchTheater — countable field', () => {
  it('publishes the full-time readout with counted numbers only', async () => {
    stubCanvas()
    mockFetch(fullField())
    render(<MatchTheater match={makeMatch()} isFinished />)

    expect(await screen.findByText('Win chance landscape')).toBeInTheDocument()
    expect(screen.getByText('Full time')).toBeInTheDocument()
    // +1 at the 90 bucket → w/n = (100 + 10 + 18)/1000 = 12.8% → 13%.
    expect(screen.getByText('13%')).toBeInTheDocument()
    expect(screen.getByText('1–0')).toBeInTheDocument()
    expect(screen.getByText('1,000 matches counted here')).toBeInTheDocument()
    expect(screen.getByText(/Based on 35,463 matches/)).toBeInTheDocument()
  })

  it('describes the surface for screen readers without naming a method', async () => {
    stubCanvas()
    mockFetch(fullField())
    render(<MatchTheater match={makeMatch()} isFinished />)

    const img = await screen.findByRole('img')
    const label = img.getAttribute('aria-label') ?? ''
    expect(label).toContain('Aston Villa')
    expect(label).toContain('Liverpool')
    expect(label).toMatch(/win chance/i)
    expect(label).not.toMatch(/poisson|model|kernel|artifact|warehouse/i)
  })
})
