import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import HomePage from '@/app/(app)/page'

/**
 * Today — the scores list, and the record behind its percentages.
 *
 * Every fixture row on this page carries a 1X2 triple, and a claim a reader
 * cannot check is decoration. The evidence panel is deliberately not a tab and
 * not a link: a tab is a place things go to be unread. It renders below the
 * list, on the page that makes the claims.
 *
 * These tests pin the three properties that make that worth doing:
 *
 *   1. the panel is present, and the scores list still opens the page
 *   2. an unscored live record says so plainly rather than going blank
 *   3. a failed evidence fetch does not take the scores list down with it
 */

const MATCHES = {
  live: [],
  upcoming: [
    {
      id: '401879301',
      league: 'Premier League',
      leagueId: 'eng.1',
      home_team: 'Arsenal',
      away_team: 'Fulham',
      status: 'STATUS_SCHEDULED',
    },
  ],
  completed: [],
  source: 'espn',
}

const EVALUATION = {
  historical: {
    available: true,
    n: 43433,
    brier: 0.59303,
    ece: 0.0099,
  },
  live: { n: 0 },
}

function mockFetch({
  matches = MATCHES,
  evaluation = EVALUATION,
  evaluationFails = false,
}: {
  matches?: unknown
  evaluation?: unknown
  evaluationFails?: boolean
} = {}) {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    const u = String(url)
    if (u.includes('/api/v1/evaluation')) {
      if (evaluationFails) return Promise.reject(new Error('offline'))
      return Promise.resolve({ ok: true, json: async () => evaluation })
    }
    return Promise.resolve({ ok: true, json: async () => matches })
  }) as unknown as typeof fetch
}

afterEach(() => {
  // Unmount BEFORE resetting mocks. This page polls `/api/todays_matches` on a
  // 60s `setInterval`, and only the effect cleanup clears it — testing-library's
  // automatic cleanup runs after this hook, so without an explicit unmount the
  // interval outlives the suite and jest force-exits the worker.
  cleanup()
  jest.resetAllMocks()
  localStorage.clear()
})

describe('HomePage — the list, and the record behind it', () => {
  it('opens on the scores list and carries the evidence below it', async () => {
    mockFetch()
    render(<HomePage />)

    // The scores list is still the page.
    await waitFor(() => expect(screen.getByRole('link', { name: /Arsenal.*Fulham/ })).toBeInTheDocument())

    // ...and the claim it makes is checkable on the same page.
    expect(screen.getByText(/How accurate is this\?/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('43,433')).toBeInTheDocument())
    expect(screen.getByText('0.59303')).toBeInTheDocument()
  })

  it('says the live record is genuinely zero rather than pending', async () => {
    // The honest failure mode. A site that hides its live number until it
    // flatters is doing the same thing as one that fakes it.
    mockFetch()
    render(<HomePage />)

    await waitFor(() =>
      expect(screen.getByText(/Nothing scored yet/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/genuinely zero rather than pending/i)).toBeInTheDocument()
  })

  it('keeps the scores list when the evidence fetch fails', async () => {
    // Football is the product; the panel is the justification. Losing the
    // second must never cost the first.
    mockFetch({ evaluationFails: true })
    render(<HomePage />)

    await waitFor(() => expect(screen.getByRole('link', { name: /Arsenal.*Fulham/ })).toBeInTheDocument())
    expect(screen.getByText(/How accurate is this\?/i)).toBeInTheDocument()
    expect(screen.getByText('Live record not available.')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing scored yet/)).not.toBeInTheDocument()
  })

  it('follows a club from the matchday and immediately filters fixtures', async () => {
    mockFetch({ matches: { ...MATCHES, upcoming: [...MATCHES.upcoming, { id: '2', home_team: 'Barcelona', away_team: 'Valencia', league: 'La Liga', leagueId: 'esp.1', status: 'upcoming' }] } })
    render(<HomePage />)
    const user = userEvent.setup()
    await screen.findByRole('link', { name: /Arsenal.*Fulham/ })
    await user.click(screen.getByRole('button', { name: /Make it your matchday/ }))
    await user.click(screen.getByRole('button', { name: 'Follow Arsenal' }))
    await user.click(screen.getByRole('button', { name: /Following · 1/ }))
    expect(screen.queryByRole('link', { name: /Barcelona.*Valencia/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Arsenal.*Fulham/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unfollow Arsenal' }))
    expect(screen.getByRole('link', { name: /Barcelona.*Valencia/ })).toBeInTheDocument()
  })

  it('filters the list by competition and restores all competitions', async () => {
    mockFetch({ matches: { ...MATCHES, upcoming: [...MATCHES.upcoming, { id: '2', home_team: 'Barcelona', away_team: 'Valencia', league: 'La Liga', leagueId: 'esp.1', status: 'upcoming' }] } })
    render(<HomePage />)
    const user = userEvent.setup()
    await screen.findByRole('link', { name: /Arsenal.*Fulham/ })
    await user.click(screen.getByRole('button', { name: /^La Liga 1$/ }))
    expect(screen.queryByRole('link', { name: /Arsenal.*Fulham/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /All competitions/ }))
    expect(screen.getByRole('link', { name: /Arsenal.*Fulham/ })).toBeInTheDocument()
  })
})
