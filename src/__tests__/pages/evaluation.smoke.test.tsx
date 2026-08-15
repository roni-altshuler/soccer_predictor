import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import EvaluationPage from '@/app/(app)/evaluation/page'

/**
 * The evaluation dashboard.
 *
 * Two properties make this page honest, and both are structural rather than
 * cosmetic:
 *
 *  1. **The two records are never merged.** Historical walk-forward and live
 *     published forecasts are two samples measuring two things, and the page
 *     must never sum them or draw a chart from a sample too small to have a
 *     shape.
 *  2. **Evidence is attributed to the competition it was measured on.** The
 *     page is organised per competition precisely because the pooled headline
 *     is an average over leagues that differ by six Brier points. What is
 *     genuinely pooled has to say so rather than appear under whichever
 *     competition happens to be selected.
 */

const HISTORICAL = { available: true, n: 43433, brier: 0.59303, ece: 0.0099 }

const PROJECTIONS = {
  available: true,
  leagues: [
    {
      competition_id: 'eng.1',
      measured: {
        n_scored: 8373,
        brier: 0.58266,
        log_loss: 0.97986,
        accuracy: 0.53505,
        uniform: 0.66667,
        base_rate: 0.64322,
        always_home: 1.08758,
      },
    },
    {
      competition_id: 'usa.1',
      measured: { n_scored: 2411, brier: 0.62101, uniform: 0.66667 },
    },
  ],
}

const KNOCKOUT = {
  available: true,
  ties: {
    n_ties_scored: 2141,
    test_seasons: [2013, 2026],
    ladder: [
      { key: 'coin_flip', label: 'Coin flip', accuracy: 0.5, brier: 0.25 },
      { key: 'higher_elo', label: 'Higher-rated side advances', accuracy: 0.643, brier: 0.2381 },
      { key: 'model', label: 'This model (random_forest)', accuracy: 0.649, brier: 0.2175 },
    ],
    calibration: [
      { stated_low: 70, stated_high: 80, n: 408, observed: 0.743, mean_stated: 0.743 },
    ],
    by_round: { final: { correct: 79, n: 120, accuracy: 0.6583 } },
    by_competition: { 'uefa.champions': { n: 264, accuracy: 0.6742, brier: 0.2098 } },
    permutation_importance: [{ feature: 'elo_diff', importance: 0.02073, std: 0.00398 }],
    method: {
      competitions: new Array(14).fill('x'),
      progression_check: { checked: 2442, confirmed: 2433, rate: 0.9963 },
    },
  },
  brackets: {
    summary: {
      n_tournaments: 85,
      log_loss: { model: 1.9686, elo_simulation: 2.1453, uniform: 2.5606 },
      top1_hit_rate: { model: 0.3176, highest_rated: 0.2235 },
      top3_hit_rate: { model: 0.6353 },
    },
    events: [
      {
        competition: 'uefa.champions',
        season: 2024,
        field: 16,
        model_p: 0.2,
        elo_p: 0.15,
        uniform_p: 0.0625,
        model_top1_hit: 1,
        elo_leader_hit: 0,
        model_top3_hit: 1,
      },
      {
        competition: 'uefa.champions',
        season: 2025,
        field: 16,
        model_p: 0.1,
        elo_p: 0.12,
        uniform_p: 0.0625,
        model_top1_hit: 0,
        elo_leader_hit: 1,
        model_top3_hit: 1,
      },
    ],
  },
}

/** Each route answers with its own artifact, the way the real app is served. */
function mockFetch({
  evaluation,
  projections = PROJECTIONS,
  knockout = KNOCKOUT,
}: {
  evaluation: unknown
  projections?: unknown
  knockout?: unknown
}) {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    const u = String(url)
    const body = u.includes('season/projections')
      ? projections
      : u.includes('tournaments/knockout')
        ? knockout
        : evaluation
    return Promise.resolve({ ok: true, json: async () => body })
  }) as unknown as typeof fetch
}

const EMPTY_LIVE = {
  available: true,
  historical: HISTORICAL,
  live: { n: 0 },
  snapshot_store: { rows: 2346, fixtures: 2346, versions: 1 },
}

afterEach(() => jest.resetAllMocks())

describe('EvaluationPage — one competition at a time', () => {
  it('opens on a league and shows that league alone, against its own baselines', async () => {
    mockFetch({ evaluation: EMPTY_LIVE })
    render(<EvaluationPage />)

    // Twice on purpose: the headline tile, and the model's own bar in the
    // ladder it is being compared against.
    await waitFor(() => expect(screen.getAllByText('0.58266')).toHaveLength(2))
    // The Premier League's own walk-forward, not the pooled .59303 headline.
    expect(screen.getByText('8,373')).toBeInTheDocument()
    // And the three baselines it had to beat to appear on the site at all.
    expect(screen.getByText('0.66667')).toBeInTheDocument()
    expect(screen.getByText('0.64322')).toBeInTheDocument()
    expect(screen.getByText('1.08758')).toBeInTheDocument()
  })

  it('changes every number when the competition changes', async () => {
    // The failure this guards is a picker that moves a label and nothing else.
    mockFetch({ evaluation: EMPTY_LIVE })
    render(<EvaluationPage />)
    await waitFor(() => expect(screen.getAllByText('0.58266').length).toBeGreaterThan(0))

    await userEvent.click(screen.getByRole('button', { name: /change league/i }))
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /MLS/i }))

    await waitFor(() => expect(screen.getAllByText('0.62101').length).toBeGreaterThan(0))
    expect(screen.queryByText('0.58266')).not.toBeInTheDocument()
  })

  it('says a competition has no measured block rather than printing a zero', async () => {
    mockFetch({
      evaluation: EMPTY_LIVE,
      projections: { available: true, leagues: [{ competition_id: 'eng.1' }] },
    })
    render(<EvaluationPage />)

    await waitFor(() =>
      expect(screen.getByText(/No measured block has been published/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText('0.00000')).not.toBeInTheDocument()
  })

  it('switches to the knockout layer and scores that competition alone', async () => {
    mockFetch({ evaluation: EMPTY_LIVE })
    render(<EvaluationPage />)
    await waitFor(() => expect(screen.getAllByText('0.58266').length).toBeGreaterThan(0))

    await userEvent.click(screen.getByRole('tab', { name: /tournaments/i }))

    // Two Champions League editions, at 20% and 10% on the actual champion:
    // mean surprisal is (1.6094 + 2.3026) / 2 = 1.9560, and the model called
    // one of the two outright.
    // Twice: the headline tile and the model's own bar in the ladder below it.
    expect(screen.getAllByText('1.9560')).toHaveLength(2)
    // Scoped to its own tile: 50.0% is also the coin-flip floor in the pooled
    // ladder further down the page, and the two mean different things.
    expect(screen.getByText('Called it outright').parentElement).toHaveTextContent('50.0%')
    // Its own tie record, not the pooled 64.9%.
    expect(screen.getByText('67.4%')).toBeInTheDocument()
  })

  it('marks the pooled record as pooled instead of hanging it on one competition', async () => {
    mockFetch({ evaluation: EMPTY_LIVE })
    render(<EvaluationPage />)
    await waitFor(() => expect(screen.getAllByText('0.58266').length).toBeGreaterThan(0))

    expect(screen.getByText(/Across every league/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /tournaments/i }))
    await waitFor(() => expect(screen.getByText(/Across all 14 knockout competitions/i)).toBeInTheDocument())
  })
})

describe('EvaluationPage — the two records', () => {
  it('says nothing is scored yet without rendering a fake zero', async () => {
    mockFetch({ evaluation: EMPTY_LIVE })
    render(<EvaluationPage />)

    await waitFor(() =>
      expect(screen.getAllByText(/Nothing has been scored yet/i).length).toBeGreaterThan(0),
    )
    // The provenance record is real and is shown even when the score is not.
    expect(screen.getAllByText('2,346').length).toBeGreaterThan(0)
  })

  it('never presents the historical sample as the live one', async () => {
    mockFetch({ evaluation: EMPTY_LIVE })
    const { container } = render(<EvaluationPage />)

    await waitFor(() => expect(screen.getAllByText('43,433').length).toBeGreaterThan(0))
    expect(container.textContent).toMatch(/never added together/i)
  })

  it('refuses to draw a reliability chart from a tiny sample', async () => {
    mockFetch({
      evaluation: {
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
      },
    })
    render(<EvaluationPage />)

    await waitFor(() => expect(screen.getAllByText('42').length).toBeGreaterThan(0))
    expect(screen.getByText(/too few for a reliability chart/i)).toBeInTheDocument()
    expect(screen.queryByText(/what it said, against what happened/i)).not.toBeInTheDocument()
  })

  it('shows the reliability bars once the sample is large enough', async () => {
    mockFetch({
      evaluation: {
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
          by_league: { 'eng.1': { n: 300, brier: 0.57 }, 'usa.1': { n: 4, brier: null } },
        },
        snapshot_store: { rows: 5000, fixtures: 2346, versions: 2 },
      },
    })
    render(<EvaluationPage />)

    await waitFor(() =>
      expect(screen.getByText(/what it said, against what happened/i)).toBeInTheDocument(),
    )
    // Stated and observed are paired bars per band: a calibrated band is two
    // bars the same length, which the numbers alone made a reader work out.
    expect(screen.getByText('36.0%')).toBeInTheDocument()
    expect(screen.getAllByText(/^Said$/).length).toBeGreaterThan(0)
    // The selected league's own live record, scored.
    expect(screen.getByText('0.57000')).toBeInTheDocument()
  })

  it('reports a live sample too small to score as too small, not as a rate', async () => {
    mockFetch({
      evaluation: {
        available: true,
        historical: HISTORICAL,
        live: { n: 304, brier: 0.58, by_league: { 'usa.1': { n: 4, brier: null } } },
        snapshot_store: { rows: 5000, fixtures: 2346, versions: 2 },
      },
    })
    render(<EvaluationPage />)
    await waitFor(() => expect(screen.getAllByText('0.58266').length).toBeGreaterThan(0))

    await userEvent.click(screen.getByRole('button', { name: /change league/i }))
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: /MLS/i }))

    await waitFor(() => expect(screen.getByText(/too few to score/i)).toBeInTheDocument())
  })
})

describe('EvaluationPage — the join', () => {
  // A rehearsal against last season found the snapshot->result join silently
  // discarding 31% of fixtures because one source says "Gladbach" and the
  // other "Borussia Mönchengladbach". On the page that looked exactly like a
  // small sample. These make the difference visible.

  it('separates "not played yet" from "we could not match this club"', async () => {
    mockFetch({
      evaluation: {
        ...EMPTY_LIVE,
        join: {
          snapshots: 2346,
          scored: 0,
          awaiting_result: 2203,
          unresolved_count: 143,
          unresolved_clubs: { 'eng.1:Coventry City': 38, 'ger.1:Elversberg': 34 },
        },
      },
    })
    render(<EvaluationPage />)

    await waitFor(() =>
      expect(screen.getByText(/Why the sample is this size/i)).toBeInTheDocument(),
    )
    expect(screen.getByText('2,203')).toBeInTheDocument()
    expect(screen.getByText('143')).toBeInTheDocument()
    expect(screen.getByText(/eng.1:Coventry City · 38/)).toBeInTheDocument()
    expect(screen.getByText(/ger.1:Elversberg · 34/)).toBeInTheDocument()
  })

  it('says plainly when every club matched', async () => {
    mockFetch({
      evaluation: {
        ...EMPTY_LIVE,
        join: {
          snapshots: 380,
          scored: 0,
          awaiting_result: 380,
          unresolved_count: 0,
          unresolved_clubs: {},
        },
      },
    })
    render(<EvaluationPage />)
    await waitFor(() =>
      expect(
        screen.getByText(/Every club in every published forecast matched/i),
      ).toBeInTheDocument(),
    )
  })
})

describe('EvaluationPage — absence', () => {
  it('renders an honest empty state when nothing has been measured at all', async () => {
    mockFetch({
      evaluation: { available: false, live: { n: 0 } },
      projections: { available: false },
      knockout: { available: false },
    })
    render(<EvaluationPage />)

    await waitFor(() =>
      expect(screen.getByText(/No evaluation has been generated here/i)).toBeInTheDocument(),
    )
  })

  it('offers only the layer that has evidence', async () => {
    // With no knockout artifact the tournaments tab is not a live control that
    // leads to an empty page.
    mockFetch({ evaluation: EMPTY_LIVE, knockout: { available: false } })
    render(<EvaluationPage />)

    await waitFor(() => expect(screen.getAllByText('0.58266').length).toBeGreaterThan(0))
    expect(screen.getByRole('tab', { name: /tournaments/i })).toBeDisabled()
  })
})
