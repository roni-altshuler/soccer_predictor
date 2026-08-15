import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import TiePage from '@/app/(app)/tournaments/tie/[...key]/page'

/**
 * One tie, opened from the bracket.
 *
 * The page has two halves from two sources, and the whole point of it is that
 * they stay separable: the tie is ours and always present, the match detail is
 * ESPN's and resolves for 99.2% of ties. The tests that matter are the ones
 * about the other 0.8% — a page that quietly shows a different fixture, or
 * that loses the tie because a third party was unreachable, is worse than one
 * that says so.
 */

const KEY = ['uefa.champions', '2021', 'final', '3v21']

jest.mock('next/navigation', () => ({
  useParams: () => ({ key: KEY }),
}))

const TIE = {
  team_a: 'Liverpool',
  team_b: 'Real Madrid',
  team_a_id: 3,
  team_b_id: 21,
  score: '0-1',
  winner: 'Real Madrid',
  winner_id: 21,
  p_team_a: null as number | null,
  kickoff: '2022-05-28',
  two_legged: false,
  pending: false,
}

const LEG = {
  eventId: '634861',
  date: '2022-05-28T19:00Z',
  state: 'post',
  statusDetail: 'FT',
  leg: null,
  neutralSite: true,
  home: { id: '364', name: 'Liverpool', abbreviation: 'LIV', score: '0', winner: false, logo: null, homeAway: 'home' },
  away: { id: '86', name: 'Real Madrid', abbreviation: 'RMA', score: '1', winner: true, logo: null, homeAway: 'away' },
  venue: { name: 'Stade de France', city: 'Saint-Denis', country: 'France' },
  attendance: 75000,
  officials: ['Clément Turpin'],
  events: [
    { id: 'e1', minute: "59'", type: 'goal', scoring: true, teamId: '86', text: 'Goal', short: 'Goal', players: ['Vinícius Júnior'] },
  ],
  commentary: [{ sequence: 1, minute: "59'", text: 'Goal for Real Madrid' }],
  stats: [{ name: 'possessionPct', label: 'Possession', home: '58%', away: '42%', homeValue: 58, awayValue: 42 }],
  lineups: [],
  headToHead: {
    summary: 'RMA leads series 4-0-1',
    meetings: [
      {
        id: 'h1',
        date: '2021-04-14',
        competition: 'UEFA Champions League',
        home: { name: 'Liverpool', score: '0', winner: false },
        away: { name: 'Real Madrid', score: '0', winner: false },
      },
    ],
  },
  form: [
    {
      teamId: '364',
      games: [
        { id: 'f1', date: '2022-05-07', opponent: 'Tottenham', atVs: 'vs', score: '1-1', result: 'D', competition: 'Premier League' },
      ],
    },
  ],
}

const payload = (over: Record<string, unknown> = {}) => ({
  available: true,
  competition: { id: 'uefa.champions', name: 'UEFA Champions League' },
  season: 2021,
  round: { slug: 'final', display: 'Final', label: 'final' },
  tie: TIE,
  legs: [LEG],
  resolution: { how: 'both-names', events: ['634861'] },
  reason: null,
  ...over,
})

const mock = (body: unknown) => {
  global.fetch = jest
    .fn()
    .mockImplementation(() => Promise.resolve({ ok: true, json: async () => body })) as unknown as typeof fetch
}

afterEach(() => jest.resetAllMocks())

describe('TiePage', () => {
  it('names the competition, the round and the edition', async () => {
    mock(payload())
    render(<TiePage />)
    await waitFor(() =>
      expect(screen.getByText(/UEFA Champions League · Final · 2021/)).toBeInTheDocument(),
    )
  })

  it('strikes the side that went out, the way the bracket does', async () => {
    // Liverpool lost the tie, and the strikethrough now lives in the shared
    // card's own header rather than in a second header this page used to draw
    // above it.
    mock(payload())
    render(<TiePage />)
    await waitFor(() => expect(document.querySelector('[data-side="home"]')).toBeTruthy())
    expect(document.querySelector('[data-side="home"]')).toHaveAttribute('data-out', 'true')
    expect(document.querySelector('[data-side="away"]')).not.toHaveAttribute('data-out')
  })

  it('draws the two clubs once, not twice', async () => {
    // A one-legged tie IS its match, so this page used to print the clubs, the
    // score and the date, and then the card printed all three again directly
    // underneath. The league fixture page, on the same card, printed them
    // once — which is the inconsistency this removes.
    mock(payload())
    render(<TiePage />)
    await waitFor(() => expect(document.querySelector('[data-side="home"]')).toBeTruthy())
    expect(document.querySelectorAll('[data-side="home"]')).toHaveLength(1)
    expect(screen.getAllByText('Liverpool')).toHaveLength(1)
  })

  it('still heads a two-legged tie itself, because the aggregate is not on either leg', async () => {
    mock(
      payload({
        tie: { ...TIE, two_legged: true, score: '2-3' },
        legs: [LEG, { ...LEG, eventId: '634862' }],
      }),
    )
    render(<TiePage />)
    await waitFor(() => expect(document.querySelector('[data-club="Liverpool"]')).toBeTruthy())
    expect(screen.getByText(/Leg 1 of 2/)).toBeInTheDocument()
    expect(screen.getByText(/Leg 2 of 2/)).toBeInTheDocument()
  })

  it('carries the match through: timeline, ground and crowd', async () => {
    mock(payload())
    render(<TiePage />)
    // Named twice on purpose: once on the scorer line under the score, once
    // on the timeline.
    await waitFor(() => expect(screen.getAllByText(/Vinícius Júnior/)).toHaveLength(2))
    expect(screen.getByText(/Stade de France/)).toBeInTheDocument()
    expect(screen.getByText('Clément Turpin')).toBeInTheDocument()
  })

  it('shows the head-to-head record and recent form as real results', async () => {
    // Both sit behind the card's own H2H tab, the same place a league fixture
    // keeps them — the two pages share one component.
    mock(payload())
    render(<TiePage />)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'H2H' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('tab', { name: 'H2H' }))
    expect(screen.getByText('RMA leads series 4-0-1')).toBeInTheDocument()
    expect(screen.getByText('Tottenham')).toBeInTheDocument()
    expect(screen.getByText('1-1')).toBeInTheDocument()
  })

  it('prices a tie still to be played and never one already settled', async () => {
    mock(payload({ tie: { ...TIE, p_team_a: 0.62, pending: true, score: null, winner: null, winner_id: null } }))
    render(<TiePage />)
    await waitFor(() => expect(screen.getByText('62%')).toBeInTheDocument())
    expect(screen.getByText('38%')).toBeInTheDocument()
    expect(screen.getByText(/the floor here is 50%/i)).toBeInTheDocument()
  })

  it('shows no forecast beside a result it already knows', async () => {
    mock(payload())
    render(<TiePage />)
    await waitFor(() => expect(document.querySelector('[data-side="home"]')).toBeTruthy())
    expect(screen.queryByText(/What the model expected/i)).not.toBeInTheDocument()
  })

  it('puts its forecast in the same slot a league fixture uses', async () => {
    // Inside the card, above the tabs — not in a separate panel floating over
    // it. One card, one place to look, whichever competition brought you here.
    mock(payload({ tie: { ...TIE, p_team_a: 0.42 } }))
    render(<TiePage />)
    await waitFor(() => expect(screen.getByText(/What the model expected/i)).toBeInTheDocument())
    const card = document.querySelector('[data-side="home"]')!.closest('section')!
    expect(card.textContent).toContain('42%')
  })

  it('keeps the tie and says so when the fixture cannot be matched', async () => {
    // Four of 520 ties do not resolve. Showing whichever match was nearest is
    // the failure this refuses; losing the tie as well would be the second.
    mock(
      payload({
        legs: [],
        resolution: null,
        reason: 'This tie could not be matched to a fixture in ESPN’s record.',
      }),
    )
    render(<TiePage />)
    await waitFor(() => expect(document.querySelector('[data-club="Liverpool"]')).toBeTruthy())
    expect(screen.getByText(/could not be matched/i)).toBeInTheDocument()
    expect(screen.getByText(/is from our own record and is unaffected/i)).toBeInTheDocument()
  })

  it('offers the way back to the competition it came from', async () => {
    mock(payload())
    render(<TiePage />)
    await waitFor(() => expect(document.querySelector('[data-side="home"]')).toBeTruthy())
    expect(screen.getByRole('link', { name: /The bracket/i })).toHaveAttribute(
      'href',
      '/tournaments?competition=uefa.champions',
    )
  })

  it('says a link names no tie rather than drawing an empty match', async () => {
    mock({ available: false, reason: 'no such tie in this edition' })
    render(<TiePage />)
    await waitFor(() => expect(screen.getAllByText(/No such tie/i).length).toBeGreaterThan(0))
  })
})
