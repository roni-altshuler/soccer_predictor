import { render, screen, waitFor } from '@testing-library/react'

import EvaluationPage from '@/app/(app)/evaluation/page'

/**
 * The evaluation dashboard.
 *
 * The property under test is the one that makes the page honest: historical
 * walk-forward and live published forecasts are two samples measuring two
 * things, and the page must never merge them, sum them, or draw a chart from
 * a sample too small to have a shape.
 */

const HISTORICAL = { available: true, n: 43433, brier: 0.59303, ece: 0.0099 }

function mockFetch(payload: unknown) {
  global.fetch = jest.fn().mockImplementation(() =>
    Promise.resolve({ ok: true, json: async () => payload }),
  ) as unknown as typeof fetch
}

afterEach(() => jest.resetAllMocks())

describe('EvaluationPage', () => {
  it('says nothing is scored yet without rendering a fake zero', async () => {
    mockFetch({
      available: true,
      historical: HISTORICAL,
      live: { n: 0 },
      snapshot_store: { rows: 2346, fixtures: 2346, versions: 1 },
    })
    render(<EvaluationPage />)

    await waitFor(() =>
      expect(screen.getAllByText(/Nothing has been scored yet/i).length).toBeGreaterThan(0),
    )
    expect(screen.getByText(/correct state before the season starts/i)).toBeInTheDocument()
    // The provenance record is real and should be shown even when the score is not.
    expect(screen.getAllByText('2,346').length).toBeGreaterThan(0)
  })

  it('refuses to draw a reliability chart from a tiny sample', async () => {
    mockFetch({
      available: true,
      historical: HISTORICAL,
      live: {
        n: 42,
        brier: 0.58,
        log_loss: 0.99,
        ece: 0.03,
        reliability: [{ bin_low: 0.3, bin_high: 0.4, n: 12, stated: 0.35, observed: 0.41 }],
      },
      snapshot_store: { rows: 2346, fixtures: 2346, versions: 1 },
    })
    render(<EvaluationPage />)

    await waitFor(() => expect(screen.getAllByText('42').length).toBeGreaterThan(0))
    expect(screen.getByText(/too few for a reliability chart/i)).toBeInTheDocument()
    expect(screen.queryByText(/It happened/i)).not.toBeInTheDocument()
  })

  it('shows the reliability table once the sample is large enough', async () => {
    mockFetch({
      available: true,
      historical: HISTORICAL,
      live: {
        n: 900,
        brier: 0.58,
        log_loss: 0.99,
        ece: 0.012,
        reliability: [
          { bin_low: 0.3, bin_high: 0.4, n: 320, stated: 0.35, observed: 0.36 },
          { bin_low: 0.4, bin_high: 0.5, n: 280, stated: 0.44, observed: 0.43 },
        ],
        by_league: { 'eng.1': { n: 300, brier: 0.57 }, 'esp.1': { n: 4, brier: null } },
      },
      snapshot_store: { rows: 5000, fixtures: 2346, versions: 2 },
    })
    render(<EvaluationPage />)

    await waitFor(() => expect(screen.getByText(/It happened/i)).toBeInTheDocument())
    expect(screen.getByText('36.0%')).toBeInTheDocument()
    // A league with 4 fixtures reports its size instead of a meaningless score.
    expect(screen.getByText('too few')).toBeInTheDocument()
  })

  it('never presents the historical sample as the live one', async () => {
    mockFetch({
      available: true,
      historical: HISTORICAL,
      live: { n: 0 },
      snapshot_store: { rows: 2346, fixtures: 2346, versions: 1 },
    })
    const { container } = render(<EvaluationPage />)

    await waitFor(() => expect(screen.getByText('43,433')).toBeInTheDocument())
    expect(container.textContent).toMatch(/never added together|never adds them|apart on purpose/i)
  })

  it('renders an honest empty state when no evaluation exists', async () => {
    mockFetch({ available: false, live: { n: 0 } })
    render(<EvaluationPage />)
    await waitFor(() =>
      expect(screen.getByText(/No evaluation has been generated here/i)).toBeInTheDocument(),
    )
  })
})
