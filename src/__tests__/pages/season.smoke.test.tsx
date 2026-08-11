import { render, screen, waitFor } from '@testing-library/react'

import SeasonPage from '@/app/(app)/season/page'

/**
 * Smoke tests for the season forecast.
 *
 * Beyond "it mounts", three things are worth guarding:
 *
 *  1. **The measured record stays next to the forecast.** The percentages on
 *     this page are unfalsifiable without it, and it is the first thing that
 *     gets edited away when a page is tidied.
 *  2. **Relegation is shown, not just the title race.** It is the half of the
 *     season question that is easy to drop and is what most readers of a
 *     mid-table club actually want.
 *  3. **A missing artifact renders an honest empty state**, rather than an
 *     empty table that reads as "nobody will be relegated".
 */

const METHOD = {
  measured: {
    brier: 0.59303,
    ece: 0.0099,
    n: 43433,
    protocol: 'expanding-window walk-forward, Wave A 2000-2025',
  },
  excluded_after_measurement: ['referee', 'rest', 'head-to-head', 'venue'],
}

const PROJECTIONS = {
  available: true,
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
      table: [
        {
          team: 'Manchester City',
          p_title: 0.386,
          p_top4: 0.815,
          p_relegated: 0.0,
          p_playoff: null,
          exp_points: 78.8,
          exp_position: 2.9,
          played: 0,
          points: 0,
        },
        {
          team: 'Ipswich Town',
          p_title: 0.0,
          p_top4: 0.001,
          p_relegated: 0.712,
          p_playoff: null,
          exp_points: 28.0,
          exp_position: 18.0,
          played: 0,
          points: 0,
        },
      ],
    },
  ],
}

const FIXTURES = {
  available: true,
  method: METHOD,
  fixtures: [
    {
      competition_id: 'eng.1',
      date: '2026-08-21',
      kickoff: '20:00',
      home: 'Liverpool',
      away: 'Arsenal',
      p_home: 0.42,
      p_draw: 0.27,
      p_away: 0.31,
      xg_home: 1.62,
      xg_away: 1.34,
      scorelines: [{ score: '1-1', p: 0.121 }],
    },
  ],
}

function mockFetch(projections: unknown, fixtures: unknown) {
  global.fetch = jest.fn().mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () =>
        String(url).includes('projections') ? projections : fixtures,
    }),
  ) as unknown as typeof fetch
}

afterEach(() => {
  jest.resetAllMocks()
})

describe('SeasonPage', () => {
  it('shows the title race and the relegation race together', async () => {
    mockFetch(PROJECTIONS, FIXTURES)
    render(<SeasonPage />)

    await waitFor(() =>
      expect(screen.getByText('Manchester City')).toBeInTheDocument(),
    )
    expect(screen.getByText('38.6%')).toBeInTheDocument()
    // Relegation is the half of the question that is easy to drop.
    expect(screen.getByText('Ipswich Town')).toBeInTheDocument()
    expect(screen.getByText('71.2%')).toBeInTheDocument()
    expect(screen.getByText(/3 go down/i)).toBeInTheDocument()
  })

  it('keeps the measured record beside the forecast', async () => {
    mockFetch(PROJECTIONS, FIXTURES)
    render(<SeasonPage />)

    // Without this the percentages are unfalsifiable.
    await waitFor(() => expect(screen.getByText('0.59303')).toBeInTheDocument())
    expect(screen.getByText('0.0099')).toBeInTheDocument()
    expect(screen.getByText('43,433')).toBeInTheDocument()
    expect(screen.getAllByText(/it had not seen/i).length).toBeGreaterThan(0)
  })

  it('publishes what was measured and dropped', async () => {
    mockFetch(PROJECTIONS, FIXTURES)
    render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText(/Measured and dropped/i)).toBeInTheDocument())
    expect(screen.getByText(/referee, rest, head-to-head, venue/i)).toBeInTheDocument()
  })

  it('shows a fixture whose 1X2 and scoreline agree', async () => {
    mockFetch(PROJECTIONS, FIXTURES)
    render(<SeasonPage />)

    await waitFor(() => expect(screen.getByText('Liverpool')).toBeInTheDocument())
    expect(screen.getByText('42 · 27 · 31')).toBeInTheDocument()
    expect(screen.getByText(/xG 1.62–1.34/)).toBeInTheDocument()
  })

  it('renders an honest empty state when no forecast has been generated', async () => {
    mockFetch({ available: false }, { available: false })
    render(<SeasonPage />)

    await waitFor(() =>
      expect(
        screen.getByText(/No season forecast has been generated here/i),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Next fixtures/i)).not.toBeInTheDocument()
  })
})
