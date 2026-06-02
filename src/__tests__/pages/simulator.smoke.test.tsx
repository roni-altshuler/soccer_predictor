import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import SimulatorPage from '@/app/(app)/simulator/page'

/**
 * Smoke tests for /simulator. Verifies the mode toggle wires up correctly
 * and the child simulator components mount on demand. We are NOT testing
 * fetch behaviour — that's covered by the unit tests on the underlying
 * math. Network calls are stubbed.
 */

beforeEach(() => {
  // Stub fetch globally so any child component that calls it during mount
  // resolves cleanly with empty data, instead of throwing in jsdom.
  global.fetch = jest.fn(async () =>
    Promise.resolve(
      new Response(JSON.stringify({ events: [], children: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  ) as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('SimulatorPage', () => {
  it('renders the Tournament/League mode toggle', () => {
    render(<SimulatorPage />)
    // Two role=tab elements in the mode tablist
    const tabs = screen.getAllByRole('tab')
    // First two tabs are the mode toggle (Tournament / League). The five
    // tournament sub-tabs underneath are <button>s without role=tab, so
    // exactly two role=tab elements at the top level.
    expect(tabs.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('tab', { name: /Tournament/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /League/i })).toBeInTheDocument()
  })

  it('defaults to Tournament mode and mounts the knockout simulator', () => {
    render(<SimulatorPage />)
    const tournamentTab = screen.getByRole('tab', { name: /Tournament/i })
    expect(tournamentTab).toHaveAttribute('aria-selected', 'true')
    // Methodology copy that is *tournament-specific* should be present.
    expect(
      screen.getByText(/Tournament-specific rules/i),
    ).toBeInTheDocument()
  })

  it('switches to League mode on click and mounts the championship simulator', async () => {
    render(<SimulatorPage />)
    const leagueTab = screen.getByRole('tab', { name: /League/i })
    fireEvent.click(leagueTab)
    await waitFor(() =>
      expect(leagueTab).toHaveAttribute('aria-selected', 'true'),
    )
    // The championship-mode empty state heading or its CTA should appear.
    expect(
      screen.getByText(/Championship contention simulator/i),
    ).toBeInTheDocument()
    // League-mode methodology bullet should replace the tournament one.
    expect(
      screen.getByText(/Title race table: pure mathematics/i),
    ).toBeInTheDocument()
  })

  it('hides tournament sub-tabs in League mode', () => {
    render(<SimulatorPage />)
    // Champions League tournament chip is visible in tournament mode (default).
    expect(screen.getByRole('button', { name: /Champions League/i })).toBeInTheDocument()
    // Switch to League — the tournament sub-tab strip should not render.
    fireEvent.click(screen.getByRole('tab', { name: /League/i }))
    expect(screen.queryByRole('button', { name: /Champions League/i })).not.toBeInTheDocument()
  })

  it('does not render a stale Tournament panel while in League mode', () => {
    render(<SimulatorPage />)
    // Initially both panels are NOT both mounted — only tournament is.
    expect(document.getElementById('simulator-tournament')).toBeTruthy()
    expect(document.getElementById('simulator-league')).toBeFalsy()
    fireEvent.click(screen.getByRole('tab', { name: /League/i }))
    // After switching, the league panel mounts and the tournament panel
    // unmounts (clean state — no stale tournament UI underneath).
    expect(document.getElementById('simulator-league')).toBeTruthy()
    expect(document.getElementById('simulator-tournament')).toBeFalsy()
  })
})
