import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

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

// The Broadcast redesign renders TWO tablists: the mode toggle
// ("Simulator mode": Tournament / League) and, in tournament mode, the
// tournament picker ("Tournament": Champions League, Europa League, …).
// Names like /League/i are ambiguous across them, so queries scope to
// the owning tablist.
const modeToggle = () =>
  within(screen.getByRole('tablist', { name: /Simulator mode/i }))
const tournamentPicker = () =>
  screen.queryByRole('tablist', { name: /^Tournament$/i })

describe('SimulatorPage', () => {
  it('renders the Tournament/League mode toggle', () => {
    render(<SimulatorPage />)
    expect(modeToggle().getByRole('tab', { name: /Tournament/i })).toBeInTheDocument()
    expect(modeToggle().getByRole('tab', { name: /League/i })).toBeInTheDocument()
  })

  it('defaults to Tournament mode and mounts the knockout simulator', () => {
    render(<SimulatorPage />)
    const tournamentTab = modeToggle().getByRole('tab', { name: /Tournament/i })
    expect(tournamentTab).toHaveAttribute('aria-selected', 'true')
    // Methodology copy that is *tournament-specific* should be present.
    expect(
      screen.getByText(/Tournament-specific rules/i),
    ).toBeInTheDocument()
  })

  it('switches to League mode on click and mounts the championship simulator', async () => {
    render(<SimulatorPage />)
    const leagueTab = modeToggle().getByRole('tab', { name: /League/i })
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
    // Tournament picker tablist is visible in tournament mode (default).
    const picker = tournamentPicker()
    expect(picker).toBeTruthy()
    expect(
      within(picker!).getByRole('tab', { name: /Champions League/i }),
    ).toBeInTheDocument()
    // Switch to League — the tournament picker should not render.
    fireEvent.click(modeToggle().getByRole('tab', { name: /League/i }))
    expect(tournamentPicker()).not.toBeInTheDocument()
  })

  it('does not render a stale Tournament panel while in League mode', () => {
    render(<SimulatorPage />)
    // Initially both panels are NOT both mounted — only tournament is.
    expect(document.getElementById('simulator-tournament')).toBeTruthy()
    expect(document.getElementById('simulator-league')).toBeFalsy()
    fireEvent.click(modeToggle().getByRole('tab', { name: /League/i }))
    // After switching, the league panel mounts and the tournament panel
    // unmounts (clean state — no stale tournament UI underneath).
    expect(document.getElementById('simulator-league')).toBeTruthy()
    expect(document.getElementById('simulator-tournament')).toBeFalsy()
  })
})
