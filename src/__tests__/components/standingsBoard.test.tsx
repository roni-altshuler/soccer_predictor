import { render, screen, within } from '@testing-library/react'

import { StandingsBoard } from '@/components/standings/StandingsBoard'
import type { StandingsPayload, StandingsTeam } from '@/components/standings/StandingsBoard'

/**
 * One board, every competition shape.
 *
 * A league is one group, a World Cup group stage is eight, MLS is two
 * conferences and the Champions League league phase is one very long one. The
 * component is not told which it has — the difference is entirely in how many
 * groups the provider returned, and that is the whole design. What must not
 * happen is the thing the older endpoint does: concatenate them, producing a
 * forty-eight-row "table" that renders and sorts and is a table of nothing.
 *
 * The qualification bands are ESPN'S OWN notes rather than constants. The
 * Champions League cut moved from eight to twenty-four when the league phase
 * replaced the group stage, so any number written into this component would
 * have been silently wrong for a season.
 */

const team = (over: Partial<StandingsTeam> & { team: string }): StandingsTeam => ({
  rank: 1,
  played: 10,
  won: 6,
  drawn: 2,
  lost: 2,
  goalsFor: 18,
  goalsAgainst: 9,
  goalDifference: 9,
  points: 20,
  note: null,
  noteColor: null,
  ...over,
})

const payload = (over: Partial<StandingsPayload> = {}): StandingsPayload => ({
  available: true,
  competition: 'eng.1',
  name: 'English Premier League',
  season: 2025,
  groups: [{ name: 'Premier League', teams: [team({ team: 'Arsenal' })] }],
  ...over,
})

const board = (data: StandingsPayload, competitionId = 'eng.1') =>
  render(<StandingsBoard data={data} competitionId={competitionId} />)

describe('StandingsBoard', () => {
  it('draws a league as one table', () => {
    board(payload())
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(within(screen.getByRole('table')).getByText('Arsenal')).toBeInTheDocument()
  })

  it('keeps a group stage as separate tables, never one ladder', () => {
    board(
      payload({
        name: 'FIFA World Cup',
        groups: [
          {
            name: 'Group A',
            teams: [team({ team: 'Mexico', rank: 1 }), team({ team: 'Canada', rank: 2 })],
          },
          { name: 'Group B', teams: [team({ team: 'Spain', rank: 1 })] },
        ],
      }),
      'fifa.world',
    )

    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(2)
    expect(within(tables[0]).getByText('Mexico')).toBeInTheDocument()
    expect(within(tables[1]).getByText('Spain')).toBeInTheDocument()
    // Group B's leader is rank 1 in its own group and must stay that way.
    expect(within(tables[1]).getByText('1')).toBeInTheDocument()
  })

  it('names each group when there is more than one, and not when there is one', () => {
    // A lone heading above a league table repeats the page title. Two groups
    // are meaningless without their names.
    board(payload())
    expect(screen.queryByRole('heading', { name: 'Premier League' })).not.toBeInTheDocument()
  })

  it('labels the groups of a multi-group competition', () => {
    board(
      payload({
        groups: [
          { name: 'Eastern Conference', teams: [team({ team: 'Inter Miami CF' })] },
          { name: 'Western Conference', teams: [team({ team: 'LAFC' })] },
        ],
      }),
      'usa.1',
    )

    expect(screen.getByRole('heading', { name: 'Eastern Conference' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Western Conference' })).toBeInTheDocument()
  })

  it('renders the rows in the order it was given', () => {
    // The route already applied the competition's own tiebreakers. Re-sorting
    // here would quietly disagree with the official table.
    board(
      payload({
        groups: [
          {
            name: 'Serie A',
            teams: [
              team({ team: 'Inter', rank: 1, points: 70 }),
              team({ team: 'Milan', rank: 2, points: 70 }),
              team({ team: 'Napoli', rank: 3, points: 70 }),
            ],
          },
        ],
      }),
      'ita.1',
    )

    // Matched exactly, so the crest's initials fallback ("INT") does not count
    // as a club name. `getAllByText` returns them in DOM order.
    const names = within(screen.getByRole('table'))
      .getAllByText(/^(Inter|Milan|Napoli)$/)
      .map((n) => n.textContent)
    expect(names).toEqual(['Inter', 'Milan', 'Napoli'])
  })

  it('signs goal difference so a positive one reads as positive', () => {
    board(
      payload({
        groups: [
          {
            name: 'Premier League',
            teams: [
              team({ team: 'Arsenal', rank: 1, goalDifference: 9 }),
              team({ team: 'Burnley', rank: 2, goalDifference: -4 }),
              team({ team: 'Fulham', rank: 3, goalDifference: 0 }),
            ],
          },
        ],
      }),
    )

    expect(screen.getByText('+9')).toBeInTheDocument()
    expect(screen.getByText('-4')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it("draws the bands from the competition's own notes", () => {
    board(
      payload({
        name: 'UEFA Champions League',
        groups: [
          {
            name: 'League phase',
            teams: [
              team({ team: 'Liverpool', rank: 1, note: 'Round of 16', noteColor: '#81D6AC' }),
              team({ team: 'Sturm Graz', rank: 36, note: 'Eliminated', noteColor: '#E5313A' }),
            ],
          },
        ],
      }),
      'uefa.champions',
    )

    const legend = screen.getByRole('list')
    expect(within(legend).getByText('Round of 16')).toBeInTheDocument()
    expect(within(legend).getByText('Eliminated')).toBeInTheDocument()
  })

  it('states each band once, however many groups carry it', () => {
    // The same note means the same thing in every group; repeating it per
    // group turns the legend into a wall.
    board(
      payload({
        groups: [
          {
            name: 'Group A',
            teams: [team({ team: 'Mexico', note: 'Advances', noteColor: '#81D6AC' })],
          },
          {
            name: 'Group B',
            teams: [team({ team: 'Spain', note: 'Advances', noteColor: '#81D6AC' })],
          },
        ],
      }),
      'fifa.world',
    )

    expect(within(screen.getByRole('list')).getAllByText('Advances')).toHaveLength(1)
  })

  it('shows no legend at all when nothing carries a note', () => {
    board(payload())
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('still bands a note whose colour the provider omitted', () => {
    // A note without a colour is information; dropping it because the swatch
    // is missing loses the only thing that says what the row means.
    board(
      payload({
        groups: [
          {
            name: 'Premier League',
            teams: [team({ team: 'Leicester', rank: 20, note: 'Relegation', noteColor: null })],
          },
        ],
      }),
    )

    expect(within(screen.getByRole('list')).getByText('Relegation')).toBeInTheDocument()
  })

  it('renders nothing rather than an empty frame when there are no groups', () => {
    board(payload({ available: false, groups: [] }))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('gives every table a caption for a screen reader', () => {
    // Two conference tables are indistinguishable to a screen reader without
    // one — both are just "table".
    board(
      payload({
        name: 'Major League Soccer',
        groups: [
          { name: 'Eastern Conference', teams: [team({ team: 'Inter Miami CF' })] },
          { name: 'Western Conference', teams: [team({ team: 'LAFC' })] },
        ],
      }),
      'usa.1',
    )

    const captions = screen
      .getAllByRole('table')
      .map((t) => t.querySelector('caption')?.textContent)
    expect(captions).toEqual([
      'Major League Soccer Eastern Conference',
      'Major League Soccer Western Conference',
    ])
  })
})
