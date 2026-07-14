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

// The page renders TWO tablists: the mode toggle ("Simulator mode":
// League / Tournament) and, in tournament mode, the tournament picker
// ("Tournament": Champions League, Europa League, …). Names like
// /League/i are ambiguous across them, so queries scope to the owning
// tablist.
const modeToggle = () =>
  within(screen.getByRole('tablist', { name: /Simulator mode/i }))
const tournamentPicker = () =>
  screen.queryByRole('tablist', { name: /^Tournament$/i })

describe('SimulatorPage', () => {
  it('renders the League/Tournament mode toggle', () => {
    render(<SimulatorPage />)
    expect(modeToggle().getByRole('tab', { name: /Tournament/i })).toBeInTheDocument()
    expect(modeToggle().getByRole('tab', { name: /League/i })).toBeInTheDocument()
  })

  it('defaults to League mode and mounts the championship simulator', () => {
    render(<SimulatorPage />)
    const leagueTab = modeToggle().getByRole('tab', { name: /League/i })
    expect(leagueTab).toHaveAttribute('aria-selected', 'true')
    expect(document.getElementById('simulator-league')).toBeTruthy()
    // Methodology copy that is *league-specific* should be present.
    expect(screen.getByText(/what-if lab locks a single result/i)).toBeInTheDocument()
  })

  it('switches to Tournament mode on click and mounts the knockout simulator', async () => {
    render(<SimulatorPage />)
    const tournamentTab = modeToggle().getByRole('tab', { name: /Tournament/i })
    fireEvent.click(tournamentTab)
    await waitFor(() =>
      expect(tournamentTab).toHaveAttribute('aria-selected', 'true'),
    )
    expect(document.getElementById('simulator-tournament')).toBeTruthy()
    // Tournament-mode methodology bullet should replace the league one.
    expect(
      screen.getByText(/Club rounds are two-legged/i),
    ).toBeInTheDocument()
  })

  it('shows tournament sub-tabs only in Tournament mode', () => {
    render(<SimulatorPage />)
    // League mode (default) — the tournament picker should not render.
    expect(tournamentPicker()).not.toBeInTheDocument()
    // Switch to Tournament — the picker tablist appears with crest chips.
    fireEvent.click(modeToggle().getByRole('tab', { name: /Tournament/i }))
    const picker = tournamentPicker()
    expect(picker).toBeTruthy()
    expect(
      within(picker!).getByRole('tab', { name: /Champions League/i }),
    ).toBeInTheDocument()
  })

  it('does not render a stale League panel while in Tournament mode', () => {
    render(<SimulatorPage />)
    // Initially both panels are NOT both mounted — only league is.
    expect(document.getElementById('simulator-league')).toBeTruthy()
    expect(document.getElementById('simulator-tournament')).toBeFalsy()
    fireEvent.click(modeToggle().getByRole('tab', { name: /Tournament/i }))
    // After switching, the tournament panel mounts and the league panel
    // unmounts (clean state — no stale league UI underneath).
    expect(document.getElementById('simulator-tournament')).toBeTruthy()
    expect(document.getElementById('simulator-league')).toBeFalsy()
  })
})
