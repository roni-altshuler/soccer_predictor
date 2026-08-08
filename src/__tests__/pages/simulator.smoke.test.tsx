import { render, screen } from '@testing-library/react'

import SimulatorPage from '@/app/(app)/simulator/page'

/**
 * Smoke tests for /simulator — the Title & Relegation page.
 *
 * The League/Tournament mode toggle these tests used to cover is gone: knockout
 * brackets left with the Wave C tournaments (docs/PIVOT_2026-08.md §5), so the
 * page is now single-purpose. We are NOT testing fetch behaviour — that's
 * covered by unit tests on the underlying math. Network calls are stubbed.
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
  it('renders as the Title & Relegation page', () => {
    render(<SimulatorPage />)
    expect(
      screen.getByRole('heading', { name: /Title & Relegation/i }),
    ).toBeInTheDocument()
  })

  it('mounts the league championship simulator unconditionally', () => {
    render(<SimulatorPage />)
    // League-specific methodology copy is present with no mode switching.
    expect(screen.getByText(/what-if lab locks a single result/i)).toBeInTheDocument()
  })

  it('offers no knockout-bracket surface', () => {
    render(<SimulatorPage />)
    // The mode toggle and the tournament picker are both gone.
    expect(
      screen.queryByRole('tablist', { name: /Simulator mode/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: /^Tournament$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Club rounds are two-legged/i)).not.toBeInTheDocument()
  })
})
