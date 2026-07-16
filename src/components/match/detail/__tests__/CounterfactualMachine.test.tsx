/**
 * Counterfactual Machine — honest gating (nothing without a reconciling
 * timeline, nothing for a fork the kernel declines), the kickoff availability
 * probe, verdict deltas against the unforked baseline, and the braid. The
 * kernel client, story builder and river builder are all mocked; no network.
 */
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'

import { CounterfactualMachine, useForkAvailability } from '../CounterfactualMachine'
import { KICKOFF_STATE, fetchForkDistribution, type ForkDistribution } from '../engineClient'
import { buildMomentumRiver } from '../momentum'
import { buildMatchStory } from '../story'
import type { MatchDetails, MatchEvent } from '../types'

jest.mock('../engineClient', () => ({
  ...jest.requireActual('../engineClient'),
  fetchForkDistribution: jest.fn(),
}))
jest.mock('../momentum', () => ({
  ...jest.requireActual('../momentum'),
  buildMomentumRiver: jest.fn(),
}))
jest.mock('../story', () => ({
  ...jest.requireActual('../story'),
  buildMatchStory: jest.fn(),
}))

const mockFetchFork = fetchForkDistribution as jest.MockedFunction<typeof fetchForkDistribution>
const mockBuildRiver = buildMomentumRiver as jest.MockedFunction<typeof buildMomentumRiver>
const mockBuildStory = buildMatchStory as jest.MockedFunction<typeof buildMatchStory>

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMatch(overrides: Partial<MatchDetails> = {}): MatchDetails {
  return {
    id: 'test-match',
    home_team: 'PSG',
    away_team: 'Toulouse',
    home_score: 2,
    away_score: 1,
    status: 'FT',
    date: '2026-04-01T19:00:00Z',
    league: 'Ligue 1',
    leagueId: 'fra.1',
    events: [
      { type: 'goal', minute: 10, player: 'A', team: 'home' },
      { type: 'goal', minute: 45, addedTime: 2, player: 'B', team: 'away' },
      { type: 'goal', minute: 70, player: 'C', team: 'home' },
    ] as MatchEvent[],
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

const BASE_DIST: ForkDistribution = {
  pHome: 0.71,
  pDraw: 0.17,
  pAway: 0.12,
  expHomeGoals: 2.6,
  expAwayGoals: 1.3,
  topScorelines: [
    { home: 2, away: 1, p: 0.21 },
    { home: 3, away: 1, p: 0.14 },
    { home: 2, away: 2, p: 0.09 },
  ],
}

const FORK_DIST: ForkDistribution = {
  pHome: 0.33,
  pDraw: 0.28,
  pAway: 0.39,
  expHomeGoals: 1.4,
  expAwayGoals: 1.5,
  topScorelines: [
    { home: 1, away: 1, p: 0.18 },
    { home: 1, away: 2, p: 0.13 },
    { home: 2, away: 1, p: 0.1 },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBuildStory.mockResolvedValue({ acts: [], coverage: 'none' })
  mockBuildRiver.mockResolvedValue(null)
  mockFetchFork.mockResolvedValue(BASE_DIST)
})

// ---------------------------------------------------------------------------
// useForkAvailability — the kickoff probe that gates the tab itself
// ---------------------------------------------------------------------------

describe('useForkAvailability', () => {
  it('probes the kernel with the kickoff state and reports true', async () => {
    const { result } = renderHook(() => useForkAvailability('m1'))
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toBe(true))
    expect(mockFetchFork).toHaveBeenCalledWith('m1', KICKOFF_STATE)
  })

  it('reports false when the kernel declines the match at kickoff', async () => {
    mockFetchFork.mockResolvedValue(null)
    const { result } = renderHook(() => useForkAvailability('m1'))
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('stays null and never probes without a matchId', () => {
    const { result } = renderHook(() => useForkAvailability(null))
    expect(result.current).toBeNull()
    expect(mockFetchFork).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// CounterfactualMachine
// ---------------------------------------------------------------------------

describe('CounterfactualMachine', () => {
  it('renders nothing when the events do not reproduce the final score', () => {
    const match = makeMatch({ home_score: 5 })
    const { container } = render(<CounterfactualMachine match={match} debounceMs={0} />)
    expect(container.firstChild).toBeNull()
    expect(mockFetchFork).not.toHaveBeenCalled()
  })

  it('shows the real result, the modeled continuation and the honesty note', async () => {
    render(<CounterfactualMachine match={makeMatch()} debounceMs={0} />)

    expect(screen.getByText('What if?')).toBeInTheDocument()
    expect(screen.getByText('2–1')).toBeInTheDocument()
    expect(screen.getByText('Hypothetical — the real result stands.')).toBeInTheDocument()

    // Kernel result lands after the debounce.
    expect(await screen.findByText('PSG 71%')).toBeInTheDocument()
    expect(screen.getByText('Draw 17%')).toBeInTheDocument()
    expect(screen.getByText('Toulouse 12%')).toBeInTheDocument()
    expect(screen.getByText('2.6–1.3')).toBeInTheDocument()
    expect(screen.getByText('2-1')).toBeInTheDocument() // top scoreline chip
    expect(screen.getByText('21%')).toBeInTheDocument()

    // Unmodified fork === baseline → exactly one kernel call, and no deltas.
    await waitFor(() => expect(mockFetchFork).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/This fork moves/)).not.toBeInTheDocument()
  })

  it('renders nothing for a fork the kernel declines — no numbers, no skeleton', async () => {
    mockFetchFork.mockResolvedValue(null)
    render(<CounterfactualMachine match={makeMatch()} debounceMs={0} />)

    await waitFor(() => expect(mockFetchFork).toHaveBeenCalled())
    // The real result and the controls stay; the modeled panel does not exist.
    expect(screen.getByText('2–1')).toBeInTheDocument()
    expect(screen.queryByText(/modeled continuation/)).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('defaults the fork point to the story turning point when one exists', async () => {
    mockBuildStory.mockResolvedValue({
      acts: [
        {
          header: 'PSG ahead after 70 minutes',
          beats: [
            {
              minute: 70,
              type: 'goal',
              player: 'C',
              team: 'home',
              scoreAfter: { home: 2, away: 1 },
              deltaWinRate: 0.3,
            },
          ],
        },
      ],
      turningPoint: { actIndex: 0, beatIndex: 0 },
      coverage: 'full',
    })
    render(<CounterfactualMachine match={makeMatch()} debounceMs={0} />)

    expect(await screen.findByText(/Forked at 70' — modeled continuation/)).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Fork minute' })).toHaveValue('70')
  })

  it('disables events after the fork point — they have not happened yet', async () => {
    render(<CounterfactualMachine match={makeMatch()} debounceMs={0} />)
    const slider = screen.getByRole('slider', { name: 'Fork minute' })
    fireEvent.change(slider, { target: { value: '45' } })

    // 10' and 45+2 have happened by minute 45; 70' has not.
    expect(
      screen.getByRole('button', { name: "Remove the 10' goal by A" })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: "Remove the 45+2' goal by B" })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: "70' goal by C — happens after the fork" })
    ).toBeDisabled()
  })

  it('fetches fork AND baseline when modified, and shows the deltas', async () => {
    // The kernel answers by state: the untouched 2-goal state is the
    // baseline, the 1-goal state is the fork.
    mockFetchFork.mockImplementation(async (_id, state) =>
      state.homeGoals === 2 ? BASE_DIST : FORK_DIST
    )
    render(<CounterfactualMachine match={makeMatch()} debounceMs={0} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Fork minute' }), {
      target: { value: '90' },
    })
    fireEvent.click(await screen.findByRole('button', { name: "Remove the 10' goal by A" }))

    const sentence = await screen.findByText(/This fork moves/)
    const paragraph = sentence.closest('p')
    expect(paragraph?.textContent).toContain('71%')
    expect(paragraph?.textContent).toContain('33%')

    await waitFor(() => {
      const states = mockFetchFork.mock.calls.map(([, state]) => state)
      expect(states).toContainEqual(
        expect.objectContaining({ minute: 90, homeGoals: 1, awayGoals: 1 })
      )
      expect(states).toContainEqual(
        expect.objectContaining({ minute: 90, homeGoals: 2, awayGoals: 1 })
      )
    })
  })

  it('adds one hypothetical goal as pure state math', async () => {
    mockFetchFork.mockImplementation(async (_id, state) =>
      state.awayGoals === 2 ? FORK_DIST : BASE_DIST
    )
    render(<CounterfactualMachine match={makeMatch()} debounceMs={0} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Fork minute' }), {
      target: { value: '90' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: /Add a hypothetical Toulouse goal at minute 90/ })
    )

    await waitFor(() => {
      const states = mockFetchFork.mock.calls.map(([, state]) => state)
      expect(states).toContainEqual(
        expect.objectContaining({ minute: 90, homeGoals: 2, awayGoals: 2 })
      )
    })
    expect(await screen.findByText(/This fork moves/)).toBeInTheDocument()
  })

  it('renders the braid only when the momentum river exists', async () => {
    mockBuildRiver.mockResolvedValue({
      segments: [
        { x0: 0, x1: 95, key: 'M:0:0', pHome: 0.4, pDraw: 0.3, pAway: 0.3, n: 100, w: 40, d: 30, l: 30 },
      ],
      markers: [],
      domainMax: 95,
      minN: 100,
      matchesCovered: 1000,
    })
    render(<CounterfactualMachine match={makeMatch()} debounceMs={0} />)

    expect(
      await screen.findByRole('img', { name: /real win-probability path/ })
    ).toBeInTheDocument()
    expect(screen.getByText(/not a minute-by-minute path/)).toBeInTheDocument()
  })
})
