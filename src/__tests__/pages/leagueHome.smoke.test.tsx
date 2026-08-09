import { render, screen, waitFor } from '@testing-library/react'

import LeagueHomePage from '@/components/league/LeagueHomePage'

/**
 * Smoke test for the League Home page component. We don't try to populate
 * real data — we stub fetch and verify the page mounts cleanly, renders
 * the loading state, and reaches the "no data" empty state without
 * crashing. This guards against the kind of regressions that broke the
 * Vercel deploy in earlier phases (duplicate imports, missing magicui
 * deps, etc.).
 */

beforeEach(() => {
  // Generic empty-but-valid response covering every consumer in the page:
  //   - /api/standings, /api/news, /api/top-scorers      → standings[], items[]
  //   - /api/simulation/{id}                              → simulation result shape
  //   - ESPN /standings, /scoreboard, /leaders, /news     → children[], events[], leaders[]
  // The page reads `data?.standings[0]?...` directly (no `?.[0]?...`) which
  // throws on undefined; an empty array sidesteps the crash without
  // requiring full per-endpoint fixtures.
  const emptyShape = {
    standings: [],
    topScorers: [],
    upcomingMatches: [],
    recentResults: [],
    news: [],
    children: [{ standings: { entries: [] } }],
    events: [],
    leaders: [],
    articles: [],
  }
  global.fetch = jest.fn(async () =>
    Promise.resolve(
      new Response(JSON.stringify(emptyShape), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  ) as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('LeagueHomePage', () => {
  it('mounts without crashing and shows the loading skeleton', () => {
    render(
      <LeagueHomePage
        leagueId="eng.1"
        leagueName="Premier League"
        country="England"
      />,
    )
    // While loading, the component renders token-styled pulse skeletons
    // (design language: no bespoke spinners) inside an aria-busy container.
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('renders the redesigned hero, tabs, and league brand after data resolves', async () => {
    render(
      <LeagueHomePage
        leagueId="eng.1"
        leagueName="Premier League"
        country="England"
      />,
    )

    // Wait for the loading state to clear (fetch resolves immediately with
    // empty JSON, so the component should transition into its empty state).
    await waitFor(
      () => expect(document.querySelector('.animate-spin')).toBeFalsy(),
      { timeout: 4000 },
    )

    // Hero heading shows the league name.
    expect(screen.getByRole('heading', { name: /Premier League/i })).toBeInTheDocument()
    // Back link present.
    expect(screen.getByRole('link', { name: /All leagues/i })).toBeInTheDocument()
    // Phase 2.1 added country + shortName ("ENG · PL").
    expect(screen.getByText(/England · PL/i)).toBeInTheDocument()
    // Tab navigation present with role=tablist.
    expect(screen.getByRole('tablist', { name: /League sections/i })).toBeInTheDocument()
    // Five tabs. News went with the pivot — the league page covers matches,
    // the table and the season projection, and nothing else.
    expect(screen.queryByRole('tab', { name: /News/i })).not.toBeInTheDocument()
    for (const label of ['Overview', 'Standings', 'Top Scorers', 'Fixtures', 'Simulator']) {
      expect(
        screen.getByRole('tab', { name: new RegExp(label, 'i') }),
      ).toBeInTheDocument()
    }
  })

  it('applies the correct active state to the default Overview tab', async () => {
    render(
      <LeagueHomePage
        leagueId="esp.1"
        leagueName="La Liga"
        country="Spain"
      />,
    )
    await waitFor(
      () => expect(document.querySelector('.animate-spin')).toBeFalsy(),
      { timeout: 4000 },
    )
    const overview = screen.getByRole('tab', { name: /Overview/i })
    expect(overview).toHaveAttribute('aria-selected', 'true')
    // The other tabs should NOT be active.
    expect(screen.getByRole('tab', { name: /Standings/i })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })
})
