import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import StandingsPage from '@/app/(app)/standings/page'

/**
 * The standings destination.
 *
 * Two controls — which competition, which season — over one board. What is
 * worth guarding beyond "it mounts":
 *
 *  1. Switching competition CLEARS the season. 2019 means something in the
 *     Premier League and nothing in a tournament that did not run that year,
 *     and carrying it across returns an empty table for the wrong reason —
 *     one that looks identical to a competition genuinely having no table.
 *  2. An absent table says so. ESPN advertises next season months early and
 *     answers with a full table of zeroes; the route drops those, so the page
 *     has to render the resulting nothing honestly rather than as an empty
 *     grid that reads as "everyone on zero points".
 */

const PREMIER = {
  available: true,
  competition: 'eng.1',
  name: 'English Premier League',
  season: 2025,
  seasons: [
    { year: 2025, label: '2025-26' },
    { year: 2024, label: '2024-25' },
  ],
  groups: [
    {
      name: 'Premier League',
      teams: [
        {
          rank: 1,
          team: 'Arsenal',
          played: 38,
          won: 28,
          drawn: 6,
          lost: 4,
          goalsFor: 91,
          goalsAgainst: 29,
          goalDifference: 62,
          points: 90,
          note: 'Champions League',
          noteColor: '#81D6AC',
        },
      ],
    },
  ],
}

/** Records what the page asked for, so the query string can be asserted. */
function mockRoute(reply: unknown = PREMIER) {
  const calls: string[] = []
  global.fetch = jest.fn().mockImplementation((url: string) => {
    calls.push(String(url))
    return Promise.resolve({ ok: true, json: async () => reply })
  }) as unknown as typeof fetch
  return calls
}

afterEach(() => {
  jest.resetAllMocks()
})

describe('StandingsPage', () => {
  it('opens on the Premier League and draws its table', async () => {
    mockRoute()
    render(<StandingsPage />)

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(within(screen.getByRole('table')).getByText('Arsenal')).toBeInTheDocument()
    expect(screen.getByText('90', { selector: 'td' })).toBeInTheDocument()
  })

  it('offers only the seasons the route returned', async () => {
    mockRoute()
    render(<StandingsPage />)

    await waitFor(() => expect(screen.getByLabelText('Season')).toBeInTheDocument())
    const options = within(screen.getByLabelText('Season')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['2025-26 · current', '2024-25'])
  })

  it('asks the route for the season that was chosen', async () => {
    const calls = mockRoute()
    render(<StandingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Season')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByLabelText('Season'), '2024')
    await waitFor(() => expect(calls.some((c) => c.includes('season=2024'))).toBe(true))
  })

  it('clears the season when the competition changes', async () => {
    // A year that exists in one competition and not another must not be
    // carried across — the empty table it produces is indistinguishable from
    // a competition that genuinely has none.
    const calls = mockRoute()
    render(<StandingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Season')).toBeInTheDocument())

    await userEvent.selectOptions(screen.getByLabelText('Season'), '2024')
    await waitFor(() => expect(calls.some((c) => c.includes('season=2024'))).toBe(true))

    await userEvent.click(screen.getByRole('button', { name: /change competition/i }))
    await userEvent.click(
      within(screen.getByRole('listbox')).getByRole('option', { name: /La Liga/i }),
    )

    await waitFor(() => expect(calls.some((c) => c.includes('competition=esp.1'))).toBe(true))
    const laLiga = calls.filter((c) => c.includes('competition=esp.1'))
    expect(laLiga.every((c) => !c.includes('season='))).toBe(true)
  })

  it('offers tournaments alongside leagues, since both have tables', async () => {
    mockRoute()
    render(<StandingsPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /change competition/i }))
    const text = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent ?? '')
    expect(text.some((t) => /Premier League/.test(t))).toBe(true)
    expect(text.some((t) => /Champions League/.test(t))).toBe(true)
  })

  it('says there is no table rather than drawing an empty one', async () => {
    mockRoute({ available: false, reason: 'this season has no table yet' })
    render(<StandingsPage />)

    await waitFor(() =>
      expect(screen.getByText(/this season has no table yet/i)).toBeInTheDocument(),
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('survives the route failing outright', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    render(<StandingsPage />)

    await waitFor(() =>
      expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument(),
    )
  })
})
