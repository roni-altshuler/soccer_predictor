import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LegDetail } from '@/components/fixture/LegDetail'
import type { MatchCard } from '@/lib/server/tieFixtures'

/**
 * One match, in the depth ESPN publishes and no deeper.
 *
 * The property that matters here is what the card does when a source is thin:
 * a tab exists only when its data does. An empty *Lineups* tab on a fixture
 * whose sheets were never filed does not read as "not published", it reads as
 * a broken site — and this is a page assembled from someone else's payload, so
 * thin is the normal case rather than the exception.
 */

const card = (over: Partial<MatchCard> = {}): MatchCard => ({
  eventId: '1',
  date: '2026-04-08T19:00Z',
  state: 'post',
  statusDetail: 'FT',
  leg: null,
  neutralSite: false,
  home: { id: '1', name: 'Arsenal', abbreviation: 'ARS', score: '2', winner: true, logo: null, homeAway: 'home' },
  away: { id: '2', name: 'Real Madrid', abbreviation: 'RMA', score: '1', winner: false, logo: null, homeAway: 'away' },
  venue: { name: 'Emirates', city: 'London', country: 'England' },
  attendance: 60260,
  officials: ['Clément Turpin'],
  events: [
    { id: 'e1', minute: "12'", type: 'goal', scoring: true, teamId: '1', text: 'Goal', short: 'Saka Goal', players: ['Saka', 'Ødegaard'] },
    { id: 'e2', minute: "66'", type: 'yellow-card', scoring: false, teamId: '2', text: 'Booked', short: 'Rüdiger booked', players: ['Rüdiger'] },
  ],
  commentary: Array.from({ length: 20 }, (_, i) => ({
    sequence: 20 - i,
    minute: `${90 - i * 4}'`,
    text: `Comment ${20 - i}`,
  })),
  stats: [
    { name: 'possessionPct', label: 'Possession', home: '61%', away: '39%', homeValue: 61, awayValue: 39 },
    { name: 'saves', label: 'Saves', home: '3', away: '5', homeValue: 3, awayValue: 5 },
  ],
  lineups: [],
  headToHead: null,
  form: [],
  ...over,
})

describe('LegDetail', () => {
  it('leads with the score, the ground and who refereed it', () => {
    render(<LegDetail card={card()} />)
    expect(screen.getByText(/Emirates, London/)).toBeInTheDocument()
    expect(screen.getByText(/60,260 in/)).toBeInTheDocument()
    expect(screen.getByText(/Referee Clément Turpin/)).toBeInTheDocument()
  })

  it('offers a tab only where there is something behind it', () => {
    // No team sheets on this fixture, so no Lineups tab — rather than a tab
    // that opens onto nothing and reads as a fault.
    render(<LegDetail card={card()} />)
    expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Stats' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Lineups' })).not.toBeInTheDocument()
  })

  it('names the scorer and who set it up', () => {
    render(<LegDetail card={card()} />)
    expect(screen.getByText('Saka')).toBeInTheDocument()
    expect(screen.getByText(/assist Ødegaard/)).toBeInTheDocument()
  })

  it('reads a substitution as one player for another, not as an assist', () => {
    render(
      <LegDetail
        card={card({
          events: [
            { id: 's1', minute: "70'", type: 'substitution', scoring: false, teamId: '1', text: '', short: 'Sub', players: ['Jesus', 'Havertz'] },
          ],
        })}
      />,
    )
    expect(screen.getByText(/for Havertz/)).toBeInTheDocument()
  })

  it('shows both sides of a statistic as published', async () => {
    render(<LegDetail card={card()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Stats' }))
    expect(screen.getByText('61%')).toBeInTheDocument()
    expect(screen.getByText('39%')).toBeInTheDocument()
    expect(screen.getByText('Possession')).toBeInTheDocument()
  })

  it('holds the commentary back behind a control rather than printing all of it', async () => {
    render(<LegDetail card={card()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Commentary' }))
    expect(screen.getByText('Comment 20')).toBeInTheDocument()
    expect(screen.queryByText('Comment 1')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /All 20 entries/i }))
    expect(screen.getByText('Comment 1')).toBeInTheDocument()
  })

  it('says a match has no detail yet rather than drawing empty tabs', () => {
    render(<LegDetail card={card({ events: [], commentary: [], stats: [], state: 'pre' })} />)
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByText(/about an hour before kickoff/i)).toBeInTheDocument()
  })

  it('says which leg it is when a tie has two', () => {
    render(<LegDetail card={card()} legLabel="Leg 2 of 2" />)
    expect(screen.getByText(/Leg 2 of 2/)).toBeInTheDocument()
  })
})
