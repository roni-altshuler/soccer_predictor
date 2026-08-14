import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AccuracyPage from '@/app/(app)/accuracy/page'

/**
 * The published record, per competition.
 *
 * This page reported one pooled hit rate over every league at once — an average
 * of leagues that differ by six points, and nobody's question. It is organised
 * per competition now, the same way `/evaluation` is, and these tests pin the
 * three properties that makes it worth doing:
 *
 *   1. picking a competition changes every number, not just a label
 *   2. a thin sample keeps its context and loses its verdict
 *   3. the knockout record is labelled a backtest, because that is what it is
 */

const FLAT = {
  winner_accuracy: 0.526,
  brier_score: 0.19,
  expected_calibration_error: 0.031,
  recent_accuracy: 0.54,
  recent_form: [],
  calibration_bins: [],
  total_predictions: 900,
  completed_predictions: 820,
  pending_predictions: 80,
  home_win_predicted: 400,
  home_win_correct: 220,
  draw_predicted: 40,
  draw_correct: 9,
  away_win_predicted: 380,
  away_win_correct: 190,
  exact_scoreline_rate: 0.11,
  exact_scoreline_count: 90,
  avg_goals_difference: 1.1,
  scope: { total: 1200, inScope: 820, outOfScopeLeague: 300, retiredModel: 80 },
}

const league = (over: Record<string, unknown>) => ({
  league: 'eng.1',
  total: 420,
  predictions: 420,
  pending: 0,
  accuracy: 0.548,
  weighted_accuracy: 0.55,
  correct: 230,
  scoreline_accuracy: 0.12,
  brier_score: 0.183,
  log_loss: 0.98,
  expected_calibration_error: 0.021,
  ...over,
})

const SUMMARY = {
  by_league: {
    'eng.1': league({}),
    'usa.1': league({ league: 'usa.1', total: 12, accuracy: 0.75, brier_score: 0.24 }),
  },
}

const TOURNAMENTS = {
  tournaments: [
    {
      competition_id: 'uefa.champions',
      season: 2025,
      actual_champion: 'Arsenal',
      probability_on_actual: 0.15,
      called_it: false,
      forecast_made_at_round: 'round-of-16',
    },
    {
      competition_id: 'uefa.champions',
      season: 2024,
      actual_champion: 'Real Madrid',
      probability_on_actual: 0.31,
      called_it: true,
      forecast_made_at_round: 'round-of-16',
    },
    {
      competition_id: 'fifa.world',
      season: 2022,
      actual_champion: 'Argentina',
      probability_on_actual: 0.09,
      called_it: false,
    },
    // Under way — no champion, so not a call and not in the picker.
    { competition_id: 'uefa.europa', season: 2026 },
  ],
}

function mockFetch({
  flat = FLAT,
  summary = SUMMARY,
  tournaments = TOURNAMENTS,
}: {
  flat?: unknown
  summary?: unknown
  tournaments?: unknown
} = {}) {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    const u = String(url)
    const body = u.includes('accuracy/summary')
      ? summary
      : u.includes('tournaments/predictions')
        ? tournaments
        : u.includes('tracking/recent')
          ? { count: 0, predictions: [] }
          : flat
    return Promise.resolve({ ok: true, json: async () => body })
  }) as unknown as typeof fetch
}

afterEach(() => jest.resetAllMocks())

describe('AccuracyPage — per competition', () => {
  it('opens on a league and reports that league alone', async () => {
    mockFetch()
    render(<AccuracyPage />)

    await waitFor(() => expect(screen.getAllByText('54.8%')).toHaveLength(2))
    expect(screen.getByText('420')).toBeInTheDocument()
    expect(screen.getByText('0.1830')).toBeInTheDocument()
  })

  it('changes every number when the competition changes', async () => {
    mockFetch()
    render(<AccuracyPage />)
    await waitFor(() => expect(screen.getAllByText('54.8%').length).toBeGreaterThan(0))

    await userEvent.click(screen.getByRole('button', { name: /change league/i }))
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /MLS/i }))

    expect(screen.getAllByText('75.0%').length).toBeGreaterThan(0)
    expect(screen.queryByText('54.8%')).not.toBeInTheDocument()
  })

  it('keeps the context and drops the verdict on a thin sample', async () => {
    // MLS has twelve settled picks. The rate is real and it is not evidence.
    mockFetch()
    render(<AccuracyPage />)
    await waitFor(() => expect(screen.getAllByText('54.8%').length).toBeGreaterThan(0))

    await userEvent.click(screen.getByRole('button', { name: /change league/i }))
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /MLS/i }))

    expect(screen.getByText(/not yet evidence of anything/i)).toBeInTheDocument()
  })

  it('shows every league against the floors that make its rate readable', async () => {
    mockFetch()
    render(<AccuracyPage />)
    await waitFor(() => expect(screen.getAllByText('54.8%').length).toBeGreaterThan(0))

    expect(screen.getByText(/Backing the home side every time/i)).toBeInTheDocument()
    expect(screen.getByText(/blind one-in-three guess/i)).toBeInTheDocument()
  })

  it('switches to the knockout layer and scores that competition alone', async () => {
    mockFetch()
    render(<AccuracyPage />)
    await waitFor(() => expect(screen.getAllByText('54.8%').length).toBeGreaterThan(0))

    await userEvent.click(screen.getByRole('tab', { name: /tournaments/i }))

    // Two Champions League editions, one called outright.
    expect(screen.getByText(/Calls at the knockout stage/i)).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText(/2025 · Arsenal/)).toBeInTheDocument()
  })

  it('labels the knockout record a backtest rather than a published one', async () => {
    // The forecast for a 2021 edition was reconstructed by a model refit on
    // earlier seasons. Honest, and not something a reader could have acted on
    // — this page must not let those two blur.
    mockFetch()
    render(<AccuracyPage />)
    await waitFor(() => expect(screen.getAllByText('54.8%').length).toBeGreaterThan(0))
    await userEvent.click(screen.getByRole('tab', { name: /tournaments/i }))

    expect(screen.getByText(/a backtest, not something published in advance/i)).toBeInTheDocument()
  })

  it('offers only competitions with a settled edition behind them', async () => {
    mockFetch()
    render(<AccuracyPage />)
    await waitFor(() => expect(screen.getAllByText('54.8%').length).toBeGreaterThan(0))
    await userEvent.click(screen.getByRole('tab', { name: /tournaments/i }))

    await userEvent.click(screen.getByRole('button', { name: /change tournament/i }))
    const names = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent ?? '')
    expect(names.some((n) => /Champions League/.test(n))).toBe(true)
    expect(names.some((n) => /World Cup/.test(n))).toBe(true)
    // The Europa League edition under way carries no champion to score.
    expect(names.some((n) => /Europa/.test(n))).toBe(false)
  })

  it('marks the pooled record as pooled rather than hanging it on one competition', async () => {
    mockFetch()
    render(<AccuracyPage />)
    await waitFor(() => expect(screen.getAllByText('54.8%').length).toBeGreaterThan(0))
    expect(screen.getByText(/Across every league/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /tournaments/i }))
    expect(screen.getByText(/Across all 2 knockout competitions/i)).toBeInTheDocument()
  })

  it('disables the knockout layer when no edition has been settled', async () => {
    mockFetch({ tournaments: { tournaments: [] } })
    render(<AccuracyPage />)
    await waitFor(() => expect(screen.getAllByText('54.8%').length).toBeGreaterThan(0))
    expect(screen.getByRole('tab', { name: /tournaments/i })).toBeDisabled()
  })

  it('says a league has nothing settled rather than printing a zero', async () => {
    mockFetch({ summary: { by_league: {} }, flat: { ...FLAT, completed_predictions: 0 } })
    render(<AccuracyPage />)

    await waitFor(() =>
      expect(screen.getByText(/Nothing tracked here yet|No results in yet/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText('0.0000')).not.toBeInTheDocument()
  })
})
