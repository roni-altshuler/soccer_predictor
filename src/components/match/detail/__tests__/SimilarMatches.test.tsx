/**
 * Similar-matches rail: honest gating (render nothing without data, no
 * skeletons, no dead links) and the fact-derived descriptor templates.
 */

import { act, render, screen } from '@testing-library/react'

import {
  SimilarMatches,
  describeNeighbor,
  type SimilarNeighbor,
} from '@/components/match/detail/SimilarMatches'
import type { MatchDetails } from '@/components/match/detail/types'

function neighbor(overrides: Partial<SimilarNeighbor> = {}): SimilarNeighbor {
  return {
    id: 'espn_eng.1_100',
    home: 'Alpha FC',
    away: 'Beta United',
    score: '2-1',
    competitionId: 'eng.1',
    season: 2024,
    date: '2024-05-01',
    gender: 'M',
    facts: {
      leadChanges: 0,
      equalizers: 0,
      comebackDepth: 0,
      deciderMinute: 40,
      firstGoalMinute: 40,
      lastGoalMinute: 75,
      redsHome: 0,
      redsAway: 0,
    },
    href: '/matches/100?league=eng.1',
    ...overrides,
  }
}

function finishedMatch(overrides: Partial<MatchDetails> = {}): MatchDetails {
  return {
    id: '740957',
    home_team: 'Aston Villa',
    away_team: 'Liverpool',
    home_score: 4,
    away_score: 2,
    status: 'FT',
    date: '2026-05-15T19:00:00Z',
    league: 'Premier League',
    leagueId: 'eng.1',
    events: [],
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

describe('describeNeighbor', () => {
  it('describes a comeback with a late winner (max two descriptors)', () => {
    const n = neighbor({
      score: '3-2',
      facts: {
        leadChanges: 1,
        equalizers: 2,
        comebackDepth: 2,
        deciderMinute: 88,
        firstGoalMinute: 10,
        lastGoalMinute: 88,
        redsHome: 0,
        redsAway: 0,
      },
    })
    expect(describeNeighbor(n)).toEqual(['came back from 2 down', "winner in the 88'"])
  })

  it('describes a goalless match', () => {
    const n = neighbor({
      score: '0-0',
      facts: {
        leadChanges: 0,
        equalizers: 0,
        comebackDepth: 0,
        deciderMinute: -1,
        firstGoalMinute: -1,
        lastGoalMinute: -1,
        redsHome: 0,
        redsAway: 0,
      },
    })
    expect(describeNeighbor(n)).toEqual(['goalless'])
  })

  it('describes red cards and a late leveller in a draw', () => {
    const n = neighbor({
      score: '2-2',
      facts: {
        leadChanges: 0,
        equalizers: 2,
        comebackDepth: 1,
        deciderMinute: -1,
        firstGoalMinute: 12,
        lastGoalMinute: 90,
        redsHome: 1,
        redsAway: 0,
      },
    })
    expect(describeNeighbor(n)).toEqual(["leveller in the 90'", 'a red card'])
  })

  it('returns nothing for an unparsable score', () => {
    expect(describeNeighbor(neighbor({ score: 'abandoned' }))).toEqual([])
  })
})

describe('SimilarMatches', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  function mockFetch(payload: unknown, ok = true) {
    const mock = jest.fn().mockResolvedValue({ ok, json: async () => payload })
    global.fetch = mock as unknown as typeof fetch
    return mock
  }

  it('renders neighbour rows with links only when a page exists', async () => {
    mockFetch({
      neighbors: [
        neighbor({ id: 'espn_eng.1_100' }),
        neighbor({
          id: 'fd_x_y',
          home: 'Gamma City',
          away: 'Delta Rovers',
          score: '3-1',
          href: null,
        }),
      ],
    })

    await act(async () => {
      render(<SimilarMatches match={finishedMatch()} isFinished />)
    })

    expect(screen.getByText('Matches that unfolded like this one')).toBeInTheDocument()
    expect(screen.getByText('Alpha FC').closest('a')).toHaveAttribute(
      'href',
      '/matches/100?league=eng.1'
    )
    // The warehouse-only match renders unlinked — never a dead link.
    expect(screen.getByText('Gamma City').closest('a')).toBeNull()
  })

  it('renders nothing when the match is not in the index', async () => {
    mockFetch({ neighbors: [] })
    let container: HTMLElement
    await act(async () => {
      ;({ container } = render(<SimilarMatches match={finishedMatch()} isFinished />))
    })
    expect(container!.firstChild).toBeNull()
  })

  it('renders nothing (and never fetches) for unfinished matches', async () => {
    const mock = mockFetch({ neighbors: [neighbor()] })
    let container: HTMLElement
    await act(async () => {
      ;({ container } = render(
        <SimilarMatches match={finishedMatch({ home_score: null, away_score: null })} isFinished={false} />
      ))
    })
    expect(container!.firstChild).toBeNull()
    expect(mock).not.toHaveBeenCalled()
  })

  it('renders nothing when the request fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    let container: HTMLElement
    await act(async () => {
      ;({ container } = render(<SimilarMatches match={finishedMatch()} isFinished />))
    })
    expect(container!.firstChild).toBeNull()
  })

  it('threads the fixture context into the request', async () => {
    const mock = mockFetch({ neighbors: [] })
    await act(async () => {
      render(<SimilarMatches match={finishedMatch()} isFinished />)
    })
    const url = mock.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/similar/740957?')
    expect(url).toContain('league=eng.1')
    expect(url).toContain('home=Aston+Villa')
    expect(url).toContain('away=Liverpool')
  })
})
