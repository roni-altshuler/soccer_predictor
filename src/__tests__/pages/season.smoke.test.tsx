import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import SeasonPage from '@/app/(app)/season/page'

/**
 * The flagship forecasting surface.
 *
 * What is guarded here, and why each would otherwise be lost silently:
 *
 *  1. **Both races.** Title and relegation. Relegation is the half that gets
 *     dropped in a redesign and is what most readers of a mid-table club came
 *     for.
 *  2. **The evidence stays on the page**, and is not one of the tabs. These
 *     percentages are unfalsifiable without it, it comes from a different
 *     endpoint than the forecast, and a tab is a place things go to be unread.
 *  3. **Historical and live are never merged.** A live n of zero must read as
 *     zero, not as the 43,433-match backtest.
 *  4. **League switching actually switches** — a picker that looks right but
 *     renders the first league forever is a convincing bug.
 *  5. **Every tab is reachable and carries its own content.** Tabs that all
 *     render the overview would look completely correct.
 *  6. **Missing artifacts render an honest empty state**, never an empty table
 *     that reads as "nobody will be relegated".
 */

const METHOD = {
  model_version: '2026.08.1+27734fb2',
  trained_through: '2026-08-10',
  excluded_after_measurement: ['referee', 'rest', 'head-to-head', 'venue'],
}

const PROJECTIONS = {
  available: true,
  generated_at: '2026-08-11T15:07:00+00:00',
  method: METHOD,
  leagues: [
    {
      competition_id: 'eng.1',
      name: 'Premier League',
      country: 'England',
      season: 2026,
      fixtures_remaining: 380,
      teams: 20,
      relegation_places: 3,
      top_cut: 4,
      top_cut_label: 'Top 4',
      measured: { n_scored: 8373, brier: 0.58266, accuracy: 0.5,
                  uniform: 0.66667, base_rate: 0.64322, always_home: 1.08758 },
      table: [
        { team: 'Manchester City', p_title: 0.386, p_top_cut: 0.815, p_top4: 0.815, p_relegated: 0.0,
          p_playoff: null, exp_points: 78.8, exp_position: 2.9, played: 0, points: 0 },
        { team: 'Arsenal', p_title: 0.279, p_top_cut: 0.757, p_top4: 0.757, p_relegated: 0.001,
          p_playoff: null, exp_points: 76.2, exp_position: 3.4, played: 0, points: 0 },
        { team: 'Ipswich Town', p_title: 0.0, p_top_cut: 0.001, p_top4: 0.001, p_relegated: 0.712,
          p_playoff: null, exp_points: 28.0, exp_position: 18.0, played: 0, points: 0 },
      ],
    },
    {
      competition_id: 'ger.1',
      name: 'Bundesliga',
      country: 'Germany',
      season: 2026,
      fixtures_remaining: 306,
      teams: 18,
      relegation_places: 2,
      top_cut: 4,
      top_cut_label: 'Top 4',
      measured: { n_scored: 6478, brier: 0.60268, accuracy: 0.5,
                  uniform: 0.66667, base_rate: 0.64758, always_home: 1.10732 },
      table: [
        { team: 'Bayern Munich', p_title: 0.713, p_top_cut: 0.96, p_top4: 0.96, p_relegated: 0.0,
          p_playoff: null, exp_points: 79.0, exp_position: 1.4, played: 0, points: 0 },
      ],
    },
    {
      competition_id: 'eng.2',
      name: 'EFL Championship',
      country: 'England',
      season: 2026,
      fixtures_remaining: 552,
      teams: 24,
      relegation_places: 3,
      top_cut: 2,
      top_cut_label: 'Promoted',
      measured: { n_scored: 5176, brier: 0.63810, accuracy: 0.45,
                  uniform: 0.66667, base_rate: 0.65167, always_home: 1.13508 },
      table: [
        { team: 'Burnley', p_title: 0.559, p_top_cut: 0.741, p_top4: 0.902, p_relegated: 0.0,
          p_playoff: null, exp_points: 88.0, exp_position: 1.7, played: 0, points: 0 },
      ],
    },
  ],
}

const FIXTURES = {
  available: true,
  method: METHOD,
  fixtures: [
    {
      fixture_uid: 'abc123',
      competition_id: 'eng.1',
      season: 2026,
      date: '2026-08-21',
      kickoff: '19:00',
      round: 'Matchweek 1',
      home: 'Liverpool',
      away: 'Arsenal',
      p_home: 0.421,
      p_draw: 0.268,
      p_away: 0.311,
      xg_home: 1.62,
      xg_away: 1.34,
      scorelines: [{ score: '1-1', p: 0.121 }],
    },
  ],
}

const EVALUATION = {
  available: true,
  historical: { available: true, n: 43433, brier: 0.59303, ece: 0.0099 },
  live: { n: 0 },
  snapshot_store: { rows: 2346, fixtures: 2346, versions: 1 },
}

function mockFetch(projections: unknown, fixtures: unknown, evaluation: unknown) {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    const u = String(url)
    const body = u.includes('projections')
      ? projections
      : u.includes('evaluation')
        ? evaluation
        : fixtures
    return Promise.resolve({ ok: true, json: async () => body })
  }) as unknown as typeof fetch
}

/** Open the league picker and choose one. */
async function chooseLeague(name: string) {
  await userEvent.click(screen.getByRole('button', { name: /change league/i }))
  await userEvent.click(
    within(screen.getByRole('listbox')).getByRole('option', {
      name: new RegExp(name, 'i'),
    }),
  )
}

const openTab = (name: string) =>
  userEvent.click(screen.getByRole('tab', { name: new RegExp(name, 'i') }))

afterEach(() => {
  jest.resetAllMocks()
  // The picker remembers the last league in BOTH places, and jsdom carries a
  // URL across tests in the same file. Without clearing both, one test's
  // choice silently becomes the next test's starting league — which looks
  // exactly like the page ignoring its own data.
  window.localStorage.clear()
  window.history.replaceState(null, '', '/season')
})

describe('SeasonPage', () => {
  it('opens on the most-followed league rather than the alphabetically first', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText(/Title race/i)).toBeInTheDocument())
    expect(screen.getAllByText('Manchester City').length).toBeGreaterThan(0)
    expect(screen.getByText(/380 fixtures remaining/i)).toBeInTheDocument()
  })

  it('shows the title race and the relegation race together', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText(/Title race/i)).toBeInTheDocument())
    expect(screen.getByText(/Relegation race/i)).toBeInTheDocument()
    expect(screen.getAllByText('Manchester City').length).toBeGreaterThan(0)
    expect(screen.getAllByText('38.6%').length).toBeGreaterThan(0)
    // The half that is easy to drop.
    expect(screen.getAllByText('Ipswich Town').length).toBeGreaterThan(0)
    expect(screen.getAllByText('71.2%').length).toBeGreaterThan(0)
  })

  it('states when the forecast was generated and how much is left to play', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText(/Title race/i)).toBeInTheDocument())
    expect(screen.getByText(/380 fixtures remaining/i)).toBeInTheDocument()
    expect(screen.getByText(/updated/i)).toBeInTheDocument()
  })

  it('keeps the measured evidence on the page beside the forecast', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    // Without this the percentages above are unfalsifiable.
    await waitFor(() => expect(screen.getByText('43,433')).toBeInTheDocument())
    expect(screen.getByText('0.59303')).toBeInTheDocument()
    expect(screen.getByText('0.0099')).toBeInTheDocument()
    expect(screen.getByText(/How accurate is this\?/i)).toBeInTheDocument()
  })

  it('does not hide the evidence behind a tab', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText('43,433')).toBeInTheDocument())
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Overview', 'Table', 'Fixtures'])

    // Still there from every tab, not just the default one.
    await openTab('Fixtures')
    expect(screen.getByText('43,433')).toBeInTheDocument()
    await openTab('Table')
    expect(screen.getByText('43,433')).toBeInTheDocument()
  })

  it('does not present the historical backtest as a live record', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText('43,433')).toBeInTheDocument())
    expect(screen.getByText(/Nothing scored yet/i)).toBeInTheDocument()
    expect(screen.getByText(/Historical walk-forward/i)).toBeInTheDocument()
    expect(screen.getByText(/Live published forecasts/i)).toBeInTheDocument()
  })

  it('points at what was measured and dropped rather than reprinting it', async () => {
    // The six dropped feature groups used to be chips on this page. They are
    // model detail on a page about one league's fixtures, so they live in the
    // handbook now — `src/__tests__/lib/docs.test.ts` pins that the document
    // genuinely still lists them, which is the half of this trade that could
    // silently fail.
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() =>
      expect(screen.getByText(/What was measured and dropped/i)).toBeInTheDocument(),
    )
    const link = screen.getByText(/What was measured and dropped/i).closest('a')
    expect(link).toHaveAttribute('href', expect.stringContaining('docs/handbook/concepts/models.md'))
  })

  it('renders a fixture card whose 1X2 and scoreline come from one object', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText(/Title race/i)).toBeInTheDocument())
    expect(screen.getByText('Liverpool')).toBeInTheDocument()
    expect(screen.getByText('42.1%')).toBeInTheDocument()
    expect(screen.getByText('1.62 — 1.34')).toBeInTheDocument()
    expect(screen.getByText('1-1 · 12.1%')).toBeInTheDocument()
  })

  it('puts the full table behind its own tab and actually renders it there', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText(/Title race/i)).toBeInTheDocument())
    expect(
      screen.queryByRole('heading', { name: 'Projected final table' }),
    ).not.toBeInTheDocument()

    await openTab('Table')
    expect(
      screen.getByRole('heading', { name: 'Projected final table' }),
    ).toBeInTheDocument()
    // Expected points is the column the races do not carry — proof the table
    // itself rendered rather than the overview under a new heading.
    expect(screen.getAllByText('79').length).toBeGreaterThan(0)
    // How many go down is the single most consequential number on the table.
    // It now lives in the qualification legend, which is also what tells a
    // reader why rows 18-20 carry a different stripe from rows 5-17.
    // `getAllByText`: the legend entry is one <li> whose text also matches on
    // its parent <ul>, so the exact-node query finds two.
    expect(
      screen.getAllByText((_, el) =>
        el?.textContent?.includes('Bottom 3 — relegation') ?? false,
      ).length,
    ).toBeGreaterThan(0)
  })

  it('lists every remaining fixture under its own tab, grouped by day', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText(/Title race/i)).toBeInTheDocument())
    await openTab('Fixtures')

    expect(screen.getByText(/Every fixture left/i)).toBeInTheDocument()
    expect(screen.getByText('Friday 21 August')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Liverpool versus Arsenal/i }),
    ).toHaveAttribute('href', '/season/fixture/abc123')
  })

  it('actually switches leagues', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() =>
      expect(screen.getAllByText('Manchester City').length).toBeGreaterThan(0),
    )
    expect(screen.getByText(/380 fixtures remaining/i)).toBeInTheDocument()

    await chooseLeague('Bundesliga')

    expect(screen.getAllByText('Bayern Munich').length).toBeGreaterThan(0)
    expect(screen.queryByText('Manchester City')).not.toBeInTheDocument()
    expect(screen.getByText(/306 fixtures remaining/i)).toBeInTheDocument()
  })

  it('remembers the chosen league and puts it in the URL', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    const { unmount } = render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText(/Title race/i)).toBeInTheDocument())
    await chooseLeague('Bundesliga')
    expect(window.location.search).toContain('league=ger.1')

    unmount()
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)
    await waitFor(() =>
      expect(screen.getAllByText('Bayern Munich').length).toBeGreaterThan(0),
    )
  })


  // -------------------------------------------------------- extra leagues
  //
  // Fourteen leagues are published, each admitted only after beating its own
  // baselines. Two things must survive that: a second tier must not be
  // labelled with a top-flight's column, and no league may borrow another's
  // accuracy figures.

  it('offers every published league in the picker', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)
    await waitFor(() => expect(screen.getByText(/Title race/i)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /change league/i }))
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Premier League'),
        expect.stringContaining('Bundesliga'),
        expect.stringContaining('EFL Championship'),
      ]),
    )
  })

  it('labels a second tier by promotion, not by top four', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)
    await waitFor(() => expect(screen.getByText(/Title race/i)).toBeInTheDocument())

    await chooseLeague('EFL Championship')
    await openTab('Table')
    expect(screen.getAllByText(/Promoted/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Top 4')).not.toBeInTheDocument()
  })

  it('reports each league’s own record, never another league’s', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)
    await waitFor(() => expect(screen.getByText('0.58266')).toBeInTheDocument())

    await chooseLeague('EFL Championship')
    // The Championship is a harder league and says so.
    expect(screen.getByText('0.63810')).toBeInTheDocument()
    expect(screen.queryByText('0.58266')).not.toBeInTheDocument()
    expect(screen.getByText('5,176')).toBeInTheDocument()
  })

  it('names the model version so a forecast can be tied to an implementation', async () => {
    mockFetch(PROJECTIONS, FIXTURES, EVALUATION)
    render(<SeasonPage />)

    await waitFor(() =>
      expect(screen.getByText('2026.08.1+27734fb2')).toBeInTheDocument(),
    )
  })

  it('renders an honest empty state when no forecast has been generated', async () => {
    mockFetch({ available: false }, { available: false }, { available: false, live: { n: 0 } })
    render(<SeasonPage />)

    await waitFor(() =>
      expect(
        screen.getByText(/No season forecast has been generated here/i),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Next fixtures/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })
})
