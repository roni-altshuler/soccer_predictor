import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MatchDetail, barSplit, scorerLines } from '@/components/fixture/MatchDetail'
import type { MatchCard } from '@/lib/server/tieFixtures'

/**
 * The match card — one component, both competitions.
 *
 * This is the piece that makes a Premier League fixture and a Champions League
 * tie look like the same product. `/season/fixture` and `/tournaments/tie` both
 * render it, so the tests here are the contract for both pages at once, and a
 * second copy of this layout is the thing they exist to prevent.
 *
 * Everything it draws is ESPN's. A statistic only one side reported is dropped
 * rather than paired against a zero; a tab exists only when there is something
 * behind it; and no number is derived from another.
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
    { id: 'e1', minute: "12'", type: 'goal', scoring: true, teamId: '1', text: '', short: '', players: ['Saka', 'Ødegaard'] },
    { id: 'e2', minute: "58'", type: 'goal', scoring: true, teamId: '1', text: '', short: '', players: ['Saka'] },
    { id: 'e3', minute: "66'", type: 'yellow-card', scoring: false, teamId: '2', text: '', short: 'Rüdiger booked', players: ['Rüdiger'] },
    { id: 'e4', minute: "77'", type: 'goal', scoring: true, teamId: '2', text: '', short: '', players: ['Mbappé'] },
  ],
  commentary: Array.from({ length: 20 }, (_, i) => ({
    sequence: 20 - i,
    minute: `${90 - i * 4}'`,
    text: `Comment ${20 - i}`,
  })),
  stats: [
    { name: 'possessionPct', label: 'Possession', home: '61%', away: '39%', homeValue: 61, awayValue: 39 },
    { name: 'totalShots', label: 'Total shots', home: '8', away: '14', homeValue: 8, awayValue: 14 },
  ],
  lineups: [],
  headToHead: {
    summary: 'ARS leads 2-0-1',
    meetings: [
      {
        id: 'h1',
        date: '2025-03-01',
        competition: 'UEFA Champions League',
        home: { name: 'Arsenal', score: '3', winner: true },
        away: { name: 'Real Madrid', score: '0', winner: false },
      },
    ],
  },
  form: [
    {
      teamId: '1',
      games: [
        { id: 'f1', date: '2026-04-01', opponent: 'Spurs', atVs: 'vs', score: '2-0', result: 'W', competition: 'Premier League' },
      ],
    },
  ],
  ...over,
})

describe('scorerLines', () => {
  it('gathers a player’s goals onto one line, in order', () => {
    expect(scorerLines(card().events, '1')).toEqual([{ name: 'Saka', minutes: "12', 58'" }])
  })

  it('marks a penalty and an own goal for what they are', () => {
    const events = [
      { id: 'p', minute: "20'", type: 'penalty-goal', scoring: true, teamId: '1', text: '', short: '', players: ['Saka'] },
      { id: 'o', minute: "40'", type: 'own-goal', scoring: true, teamId: '1', text: '', short: '', players: ['Rüdiger'] },
    ]
    expect(scorerLines(events, '1')).toEqual([
      { name: 'Saka', minutes: "20' (pen)" },
      { name: 'Rüdiger', minutes: "40' (og)" },
    ])
  })

  it('keeps each side’s scorers to itself', () => {
    expect(scorerLines(card().events, '2')).toEqual([{ name: 'Mbappé', minutes: "77'" }])
  })

  it('counts nothing from a card or a substitution', () => {
    const events = card().events.filter((e) => e.type !== 'goal')
    expect(scorerLines(events, '2')).toEqual([])
  })
})

describe('barSplit', () => {
  it('splits in proportion to the two values', () => {
    expect(barSplit({ name: 'p', label: 'P', home: '60%', away: '40%', homeValue: 60, awayValue: 40 })).toBe(60)
  })

  it('stays even when the pair is not a number', () => {
    expect(barSplit({ name: 'p', label: 'P', home: '–', away: '–', homeValue: null, awayValue: null })).toBe(50)
  })

  it('never collapses a side to nothing, so both values stay readable', () => {
    const lopsided = barSplit({ name: 'p', label: 'P', home: '100', away: '0', homeValue: 100, awayValue: 0 })
    expect(lopsided).toBeLessThanOrEqual(92)
    expect(lopsided).toBeGreaterThan(50)
  })
})

describe('MatchDetail', () => {
  it('leads with the score, the ground, the date and the referee', () => {
    render(<MatchDetail card={card()} heading="UEFA Champions League · Final" />)
    expect(screen.getByText('UEFA Champions League · Final')).toBeInTheDocument()
    expect(screen.getByText(/Emirates, London/)).toBeInTheDocument()
    expect(screen.getByText('Clément Turpin')).toBeInTheDocument()
    expect(screen.getByText('FT')).toBeInTheDocument()
  })

  it('names the scorers under the score, on their own side', () => {
    render(<MatchDetail card={card()} />)
    const home = document.querySelector('[data-scorers="home"]')!
    const away = document.querySelector('[data-scorers="away"]')!
    expect(within(home as HTMLElement).getByText(/Saka/)).toBeInTheDocument()
    expect(within(away as HTMLElement).getByText(/Mbappé/)).toBeInTheDocument()
    expect(within(home as HTMLElement).queryByText(/Mbappé/)).toBeNull()
  })

  it('carries our own forecast inside the card when there is one', () => {
    // The forecast is the reason this site exists; on a match page it belongs
    // with the match, not on a separate screen.
    render(<MatchDetail card={card()} model={<p>What the model expected</p>} />)
    expect(screen.getByText('What the model expected')).toBeInTheDocument()
  })

  it('renders the whole card for a competition we do not forecast', () => {
    render(<MatchDetail card={card()} />)
    expect(screen.queryByText(/model/i)).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument()
  })

  it('puts each event on the side of the team it belongs to', () => {
    render(<MatchDetail card={card()} />)
    const booking = screen.getByText('Rüdiger').closest('div')!
    // Away events take the third column of the grid; home events the first.
    expect(booking.className).toMatch(/col-start-3/)
  })

  it('offers a tab only where there is something behind it', () => {
    render(<MatchDetail card={card({ lineups: [], commentary: [] })} />)
    expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Lineups' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Commentary' })).not.toBeInTheDocument()
  })

  it('shows the leading side of every statistic', async () => {
    render(<MatchDetail card={card()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Stats' }))
    expect(screen.getByText('61%')).toBeInTheDocument()
    expect(screen.getByText('Total shots')).toBeInTheDocument()
    // Away won the shot count, so its number is the lit one.
    const row = document.querySelector('[data-stat="totalShots"]')!
    const [homeCell, , awayCell] = Array.from(row.children) as HTMLElement[]
    expect(awayCell.className).toMatch(/text-primary/)
    expect(homeCell.className).toMatch(/text-tertiary/)
  })

  it('puts the previous meetings and recent form behind one tab', async () => {
    render(<MatchDetail card={card()} />)
    expect(screen.queryByText('ARS leads 2-0-1')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'H2H' }))
    expect(screen.getByText('ARS leads 2-0-1')).toBeInTheDocument()
    expect(screen.getByText('Spurs')).toBeInTheDocument()
  })

  it('holds the commentary back behind a control rather than printing all of it', async () => {
    render(<MatchDetail card={card()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Commentary' }))
    expect(screen.getByText('Comment 20')).toBeInTheDocument()
    expect(screen.queryByText('Comment 1')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /All 20 entries/i }))
    expect(screen.getByText('Comment 1')).toBeInTheDocument()
  })

  it('says a match has nothing yet rather than drawing empty tabs', () => {
    render(
      <MatchDetail
        card={card({ events: [], commentary: [], stats: [], headToHead: null, form: [], state: 'pre' })}
      />,
    )
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByText(/about an hour before kickoff/i)).toBeInTheDocument()
  })

  it('opens no Lineups tab for team sheets ESPN has not filled in', () => {
    // Before kickoff ESPN files both sheets as empty shells. Counting the
    // shells rather than the players put a Lineups tab on every upcoming
    // fixture and rendered two club names above nothing at all — which is
    // what a league page looked like all preseason.
    render(
      <MatchDetail
        card={card({
          state: 'pre',
          lineups: [
            { teamId: '1', homeAway: 'home', formation: null, starters: [], bench: [] },
            { teamId: '2', homeAway: 'away', formation: null, starters: [], bench: [] },
          ],
        })}
      />,
    )
    expect(screen.queryByRole('tab', { name: 'Lineups' })).not.toBeInTheDocument()
  })

  it('reads "vs" before kickoff rather than two dashes', () => {
    // "– - –" where a scoreline belongs reads as data we failed to load, not
    // as a match that has not started.
    render(
      <MatchDetail
        card={card({
          state: 'pre',
          statusDetail: 'Fri, August 21st at 3:00 PM EDT',
          home: { ...card().home, score: null, winner: false },
          away: { ...card().away, score: null, winner: false },
        })}
      />,
    )
    expect(document.querySelector('[data-score="pending"]')).toHaveTextContent('vs')
    expect(document.querySelector('[data-score="final"]')).toBeNull()
  })

  it('keeps the real score once there is one', () => {
    render(<MatchDetail card={card()} />)
    expect(document.querySelector('[data-score="final"]')).toHaveTextContent('2')
    expect(document.querySelector('[data-score="pending"]')).toBeNull()
  })

  it('strikes through the club that went out, and only in a knockout', () => {
    // The bracket's strikethrough, carried onto the card so a one-legged tie
    // does not need a second header above it to say who went out.
    const { rerender } = render(<MatchDetail card={card()} eliminated="Real Madrid CF" />)
    expect(document.querySelector('[data-side="away"]')).toHaveAttribute('data-out', 'true')
    expect(document.querySelector('[data-side="home"]')).not.toHaveAttribute('data-out')

    // A league fixture passes nothing, and nothing is struck.
    rerender(<MatchDetail card={card()} />)
    expect(document.querySelector('[data-side="away"]')).not.toHaveAttribute('data-out')
    expect(document.querySelector('[data-side="home"]')).not.toHaveAttribute('data-out')
  })
})
