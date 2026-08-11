import { render, screen, waitFor } from '@testing-library/react'

import TournamentsPage from '@/app/(app)/tournaments/page'

/**
 * Smoke tests for the tournament page.
 *
 * Two things are worth guarding beyond "it mounts":
 *
 *  1. The framing survives. The whole reason this page is separate from
 *     /accuracy is that a knockout tie has two outcomes and a league match has
 *     three, so a 64.8% here is not a better version of the 52.3% there. If
 *     that sentence ever gets edited away, the page starts overstating itself
 *     and nothing else would catch it.
 *  2. A missing artifact renders an honest empty state rather than crashing or
 *     — worse — rendering an empty table that reads as "no tournaments were
 *     predicted correctly".
 */

function mockFetch(payload: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  }) as unknown as typeof fetch
}

const ARTIFACT = {
  available: true,
  ties: {
    n_ties_scored: 2110,
    test_seasons: [2013, 2026],
    ladder: [
      { key: 'coin_flip', label: 'Coin flip', accuracy: 0.5, brier: 0.25 },
      { key: 'higher_elo', label: 'Higher-rated side advances', accuracy: 0.6412, brier: 0.2387 },
      { key: 'model', label: 'This model (random_forest)', accuracy: 0.6479, brier: 0.2179 },
    ],
    calibration: [
      { stated_low: 70, stated_high: 80, n: 408, observed: 0.743, mean_stated: 0.743 },
    ],
    by_round: { final: { correct: 79, n: 120, accuracy: 0.6583 } },
    best_model: 'random_forest',
    method: {
      competitions: new Array(14).fill('x'),
      progression_check: { checked: 2412, confirmed: 2403, rate: 0.9963 },
    },
  },
  brackets: {
    summary: {
      n_tournaments: 84,
      log_loss: { model: 1.9672, elo_simulation: 2.1454, uniform: 2.5498 },
      top1_hit_rate: { model: 0.321, highest_rated: 0.214 },
      top3_hit_rate: { model: 0.631 },
    },
    events: [
      {
        competition: 'fifa.world',
        season: 2022,
        field: 16,
        model_p: 0.155,
        elo_p: 0.12,
        uniform_p: 0.062,
        model_top1_hit: 0,
        elo_leader_hit: 0,
        model_top3_hit: 1,
      },
    ],
  },
}

afterEach(() => {
  jest.resetAllMocks()
})

describe('TournamentsPage', () => {
  it('renders the ladder and the bracket record', async () => {
    mockFetch(ARTIFACT)
    render(<TournamentsPage />)

    await waitFor(() => expect(screen.getByText(/Who advances/i)).toBeInTheDocument())
    expect(screen.getByText(/Who lifts the trophy/i)).toBeInTheDocument()
    expect(screen.getByText('32.1%')).toBeInTheDocument()
    expect(screen.getByText(/84 tournaments simulated/i)).toBeInTheDocument()
  })

  it('keeps the two-outcome framing that stops the numbers being misread', async () => {
    mockFetch(ARTIFACT)
    render(<TournamentsPage />)

    await waitFor(() => expect(screen.getByText(/Who advances/i)).toBeInTheDocument())
    // The claim: knockout is binary, league play is not, so these numbers are
    // not the 1X2 numbers improved.
    expect(screen.getByText(/a knockout\s+tie has two/i)).toBeInTheDocument()
    expect(screen.getByText(/not the 1X2 numbers made bigger/i)).toBeInTheDocument()
  })

  it('shows an honest empty state when the benchmarks have not been run', async () => {
    mockFetch({ available: false, reason: 'not run' })
    render(<TournamentsPage />)

    await waitFor(() =>
      expect(screen.getByText(/have not been run here/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Who lifts the trophy/i)).not.toBeInTheDocument()
  })
})
