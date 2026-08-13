import { fireEvent, render, screen, within } from '@testing-library/react'

import type { ProjectedRow } from '@/components/forecast/ProjectedTable'
import { StandingsTable } from '@/components/forecast/StandingsTable'

/**
 * The standings table has to serve two competition shapes without pretending
 * they are the same one. A single table decides a champion and relegates the
 * bottom; MLS decides nothing in its combined 30-team standing except the
 * Supporters' Shield, and a club's season turns on where it finishes in its
 * own conference.
 *
 * Getting that wrong is not a layout bug. Ranking all thirty together and
 * labelling the top of it "title" would publish a confident answer to a
 * question the competition does not ask.
 *
 * Club-name queries are scoped with `within(table)` throughout: the component
 * renders a table and a card list and hides one with `md:` classes, which
 * jsdom does not apply — so every club legitimately appears twice in the DOM
 * and an unscoped `getByText` finds two of everything.
 */

const table = () => screen.getAllByRole('table')[0]

const row = (over: Partial<ProjectedRow> & { team: string }): ProjectedRow => ({
  p_title: 0.1,
  p_top_cut: 0.4,
  p_top4: 0.4,
  p_relegated: 0.05,
  p_playoff: null,
  exp_points: 60,
  exp_position: 5,
  played: 10,
  points: 18,
  ...over,
})

const LEAGUE: ProjectedRow[] = [
  row({ team: 'Alpha', exp_position: 1, p_title: 0.6, points: 30 }),
  row({ team: 'Beta', exp_position: 2, p_title: 0.3, points: 27 }),
  row({ team: 'Gamma', exp_position: 3, p_title: 0.1, points: 24 }),
  row({ team: 'Delta', exp_position: 4, p_title: 0.0, points: 20 }),
  row({ team: 'Epsilon', exp_position: 5, p_title: 0.0, points: 12 }),
  row({ team: 'Zeta', exp_position: 6, p_title: 0.0, p_relegated: 0.8, points: 6 }),
]

const GROUPED: ProjectedRow[] = [
  row({
    team: 'East One',
    group: 'Eastern Conference',
    group_exp_position: 1,
    p_group_title: 0.7,
    p_qualify: 0.99,
    p_relegated: null,
    p_title: 0.4,
  }),
  row({
    team: 'East Two',
    group: 'Eastern Conference',
    group_exp_position: 2,
    p_group_title: 0.2,
    p_qualify: 0.6,
    p_relegated: null,
    p_title: 0.1,
  }),
  row({
    team: 'East Three',
    group: 'Eastern Conference',
    group_exp_position: 3,
    p_group_title: 0.1,
    p_qualify: 0.1,
    p_relegated: null,
    p_title: 0.0,
  }),
  row({
    team: 'West One',
    group: 'Western Conference',
    group_exp_position: 1,
    p_group_title: 0.9,
    p_qualify: 0.95,
    p_relegated: null,
    p_title: 0.5,
  }),
]

const GROUPS = [
  { name: 'Eastern Conference', short: 'Eastern', teams: 3, qualify: 2 },
  { name: 'Western Conference', short: 'Western', teams: 1, qualify: 2 },
]

describe('StandingsTable — a single-table league', () => {
  it('leads with what happened, then what is projected', () => {
    render(<StandingsTable rows={LEAGUE} relegationPlaces={1} topCut={3} />)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.slice(0, 4)).toEqual(['#', 'Club', 'P', 'Pts'])
  })

  it('names the bands rather than relying on the stripe colour', () => {
    render(
      <StandingsTable
        rows={LEAGUE}
        relegationPlaces={1}
        topCut={3}
        topCutLabel="Top 3"
      />,
    )
    expect(screen.getAllByText(/Top 3/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Bottom 1 — relegation/).length).toBeGreaterThan(0)
  })

  it('offers no conference tabs when there are no conferences', () => {
    render(<StandingsTable rows={LEAGUE} relegationPlaces={1} />)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})

describe('StandingsTable — a competition ranked inside conferences', () => {
  const renderGrouped = () =>
    render(
      <StandingsTable
        rows={GROUPED}
        relegationPlaces={0}
        groups={GROUPS}
        qualifyLabel="MLS Cup Playoffs"
      />,
    )

  it('opens on a conference, because that is what the season decides', () => {
    renderGrouped()
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveTextContent('Eastern')
    // Only that conference's clubs are listed.
    expect(within(table()).queryByText('West One')).not.toBeInTheDocument()
  })

  it('asks the conference question, not the league one', () => {
    renderGrouped()
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toContain('Win conf')
    expect(headers).toContain('Playoffs')
    expect(headers).not.toContain('Title')
  })

  it('switches conference without leaking the other one in', () => {
    renderGrouped()
    fireEvent.click(screen.getByRole('tab', { name: 'Western' }))
    expect(within(table()).getByText('West One')).toBeInTheDocument()
    expect(within(table()).queryByText('East One')).not.toBeInTheDocument()
  })

  it('keeps the combined standing as its own named trophy', () => {
    renderGrouped()
    const shield = screen.getByRole('tab', { name: /Supporters/ })
    fireEvent.click(shield)
    // All four clubs, ranked league-wide, and the column is the title again.
    expect(within(table()).getByText('East One')).toBeInTheDocument()
    expect(within(table()).getByText('West One')).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toContain('Title')
  })

  it('shows no relegation column where nobody is relegated', () => {
    renderGrouped()
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).not.toContain('Rel')
  })

  it('marks the playoff cut line from the conference, not a constant', () => {
    renderGrouped()
    // GROUPS says two qualify, so the legend must say two — not the nine a
    // hard-coded MLS rule would produce, and not the four a league uses.
    expect(
      screen.getAllByText(/Top 2 — MLS Cup Playoffs/).length,
    ).toBeGreaterThan(0)
  })
})

describe('StandingsTable — the numbers themselves', () => {
  it('renders every probability as text, not only as a bar', () => {
    render(<StandingsTable rows={LEAGUE} relegationPlaces={1} topCut={3} />)
    expect(within(table()).getByText('60.0%')).toBeInTheDocument()
  })

  it('prints a dash where a probability does not apply', () => {
    render(
      <StandingsTable
        rows={GROUPED}
        relegationPlaces={0}
        groups={GROUPS}
        qualifyLabel="MLS Cup Playoffs"
      />,
    )
    // Nothing here should render "null" or "NaN" for the absent relegation.
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
    expect(screen.queryByText(/null/)).not.toBeInTheDocument()
  })
})
