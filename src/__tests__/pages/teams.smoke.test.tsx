import { render, screen } from '@testing-library/react'

import TeamPage from '@/app/(app)/teams/[id]/page'
import { fetchTeamOverview } from '@/lib/server/espnTeamOverview'

/**
 * Smoke tests for the team page (/teams/[id]).
 *
 * The page is an async server component, so it is invoked as a function and
 * the resulting JSX is rendered — there is no client fetch to stub. The data
 * layer is mocked at the module boundary instead, with one representative
 * payload, because the page's contract is "render the football facts that are
 * present, render `—` or omit the section for the ones that are not, and
 * notFound() everything else".
 *
 * notFound() is mocked to THROW (which is what the real one does — it throws
 * NEXT_NOT_FOUND) so that "invalid id refuses to render" is assertable as a
 * rejection rather than silently falling through to a render of nothing.
 */

jest.mock('@/lib/server/espnTeamOverview', () => ({
  fetchTeamOverview: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  // SmartBackLink (via useSmartBack) reads the router; give it inert stubs.
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/teams/359',
}))

const mockFetchTeamOverview = fetchTeamOverview as jest.MockedFunction<typeof fetchTeamOverview>

const PAYLOAD = {
  team: {
    id: '359',
    name: 'Arsenal',
    abbreviation: 'ARS',
    logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png',
    venue: null,
    color: '#EF0107',
    founded: null,
  },
  league: { id: 'eng.1', name: 'English Premier League', season: null },
  standing: {
    position: 2,
    played: 7,
    won: 4,
    drawn: 2,
    lost: 1,
    gf: 12,
    ga: 5,
    points: 14,
    form_string: 'WDLWW',
  },
  next_fixture: {
    match_id: '740001',
    kickoff: '2026-08-30T14:00Z',
    venue: 'Emirates Stadium',
    is_home: true,
    opponent: { id: '382', name: 'Manchester City' },
    self_score: null,
    opponent_score: null,
    status: 'pre',
    status_detail: 'Sat, August 30',
    completed: false,
  },
  recent_results: [
    {
      match_id: '739900',
      kickoff: '2026-08-23T15:30Z',
      venue: 'Craven Cottage',
      is_home: false,
      opponent: { id: '370', name: 'Fulham' },
      self_score: 2,
      opponent_score: 1,
      status: 'post',
      status_detail: 'FT',
      completed: true,
    },
  ],
  upcoming_fixtures: [
    {
      match_id: '740001',
      kickoff: '2026-08-30T14:00Z',
      venue: 'Emirates Stadium',
      is_home: true,
      opponent: { id: '382', name: 'Manchester City' },
      self_score: null,
      opponent_score: null,
      status: 'pre',
      status_detail: 'Sat, August 30',
      completed: false,
    },
  ],
  squad: [
    { player_id: '133731', name: 'David Raya', position: 'G', number: 1, nationality: 'Spain' },
    { player_id: '246603', name: 'Bukayo Saka', position: 'F', number: 7, nationality: 'England' },
    { player_id: '221166', name: 'Declan Rice', position: 'M', number: 41, nationality: 'England' },
  ],
  stats: {
    goals_per_match: 1.71,
    conceded_per_match: 0.71,
    clean_sheets: null,
    possession_avg: null,
  },
  injuries: [],
  generated_at: '2026-08-25T09:00:00.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFetchTeamOverview.mockResolvedValue(
    PAYLOAD as unknown as Awaited<ReturnType<typeof fetchTeamOverview>>,
  )
})

describe('TeamPage', () => {
  it('renders the team header, stat tiles and footer stamp', async () => {
    render(await TeamPage({ params: Promise.resolve({ id: '359' }) }))

    expect(screen.getByRole('heading', { name: /Arsenal/i })).toBeInTheDocument()
    // Mono subline: league · position.
    expect(screen.getByText(/English Premier League · 2nd/i)).toBeInTheDocument()

    // Stat tiles: labels and their values as TEXT (never colour-alone).
    for (const label of ['Position', 'Record', 'Points', 'Form']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('4-2-1')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()

    // Footer stamp carries the freshness date only — DESIGN.md's copy rule
    // keeps provider names out of the UI.
    expect(screen.getByText(/Updated /i)).toBeInTheDocument()
  })

  it('links every fixture row to its match page', async () => {
    render(await TeamPage({ params: Promise.resolve({ id: '359' }) }))

    const upcoming = screen.getByRole('link', { name: /Manchester City/i })
    expect(upcoming).toHaveAttribute('href', expect.stringContaining('/matches/740001'))

    // Recent result: letter chip + score + opponent, one link.
    const recent = screen.getByRole('link', { name: /Fulham/i })
    expect(recent).toHaveAttribute('href', expect.stringContaining('/matches/739900'))
    expect(recent).toHaveTextContent('W')
    expect(recent).toHaveTextContent('2-1')
    expect(recent).toHaveTextContent('at')
  })

  it('renders the squad table sorted GK first', async () => {
    render(await TeamPage({ params: Promise.resolve({ id: '359' }) }))

    expect(screen.getByText('Squad')).toBeInTheDocument()
    const rows = screen.getAllByRole('row').slice(1) // drop the header row
    expect(rows[0]).toHaveTextContent('David Raya')
    expect(rows).toHaveLength(3)
  })

  it('calls notFound() on a non-numeric id without fetching', async () => {
    const { notFound } = jest.requireMock('next/navigation') as { notFound: jest.Mock }
    await expect(
      TeamPage({ params: Promise.resolve({ id: 'not-a-team' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
    expect(mockFetchTeamOverview).not.toHaveBeenCalled()
  })

  it('calls notFound() when the overview comes back null', async () => {
    mockFetchTeamOverview.mockResolvedValue(null)
    await expect(
      TeamPage({ params: Promise.resolve({ id: '999999' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
