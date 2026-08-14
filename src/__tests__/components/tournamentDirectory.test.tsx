import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TournamentDirectory } from '@/components/tournament/TournamentDirectory'
import type { TournamentForecast } from '@/components/tournament/TournamentPicker'

/**
 * The tournaments front door.
 *
 * A directory of fourteen competitions has one job beyond listing them: say
 * what each one is DOING, because the state decides what the numbers under it
 * mean. Odds on an undecided competition and a record of a settled call look
 * identical as a percentage next to a club name.
 *
 * The other rule is the site's oldest: no number where there is no forecast.
 * An undrawn competition gets a sentence, not a bar chart.
 */

const base = (over: Partial<TournamentForecast>): TournamentForecast => ({
  competition_id: 'uefa.champions',
  name: 'UEFA Champions League',
  region: 'Europe',
  season: 2026,
  status: 'in_progress',
  is_current: true,
  ...over,
})

describe('TournamentDirectory', () => {
  it('shows every competition without anything being opened', () => {
    render(
      <TournamentDirectory
        tournaments={[
          base({}),
          base({ competition_id: 'fifa.world', name: 'FIFA World Cup', season: 2026 }),
        ]}
        onOpen={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /Champions League/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /World Cup/i })).toBeInTheDocument()
    expect(screen.getByText(/2 competitions/i)).toBeInTheDocument()
  })

  it('opens the competition that was clicked', async () => {
    const opened: string[] = []
    render(
      <TournamentDirectory
        tournaments={[base({}), base({ competition_id: 'fifa.world', name: 'FIFA World Cup' })]}
        onOpen={(id) => opened.push(id)}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /World Cup/i }))
    expect(opened).toEqual(['fifa.world'])
  })

  it('leads with the title odds while a competition is live', () => {
    render(
      <TournamentDirectory
        tournaments={[
          base({
            odds: [
              { team_id: 1, team: 'Real Madrid', probability: 0.24, elo: 1950 },
              { team_id: 2, team: 'Arsenal', probability: 0.18, elo: 1930 },
              { team_id: 3, team: 'Bayern Munich', probability: 0.12, elo: 1910 },
              { team_id: 4, team: 'Inter', probability: 0.09, elo: 1900 },
            ],
          }),
        ]}
        onOpen={() => {}}
      />,
    )
    const card = screen.getByRole('button', { name: /Champions League/i })
    expect(card).toHaveTextContent('Real Madrid')
    expect(card).toHaveTextContent('24%')
    // Three contenders, not the whole field: a card is a glance.
    expect(card).not.toHaveTextContent('Inter')
  })

  it('says who won a finished edition and what the model gave them', () => {
    render(
      <TournamentDirectory
        tournaments={[
          base({
            status: 'completed',
            season: 2025,
            actual_champion: 'Chelsea',
            probability_on_actual: 0.07,
            called_it: false,
            odds: [{ team_id: 1, team: 'Real Madrid', probability: 0.24, elo: 1950 }],
          }),
        ]}
        onOpen={() => {}}
      />,
    )
    const card = screen.getByRole('button', { name: /Champions League/i })
    expect(card).toHaveTextContent(/Won it/i)
    expect(card).toHaveTextContent('Chelsea')
    expect(card).toHaveTextContent('7%')
    // The model made someone else favourite, and the card says which way round
    // it was rather than leaving 7% to be read as a successful call.
    expect(card).toHaveTextContent(/what the model gave them/i)
    expect(card).not.toHaveTextContent('Real Madrid')
  })

  it('gives an undrawn competition no number at all', () => {
    // The rule the whole tournament layer is built on: a bracket is a field of
    // teams, and a percentage on one that has not been drawn is invented.
    render(
      <TournamentDirectory
        tournaments={[base({ status: 'awaiting_draw', field: 6 })]}
        onOpen={() => {}}
      />,
    )
    const card = screen.getByRole('button', { name: /Champions League/i })
    expect(card).toHaveTextContent(/Draw not made/i)
    expect(card).toHaveTextContent(/no title odds/i)
    expect(card.textContent).not.toMatch(/\d+%/)
  })

  it('says when the next edition starts, once fixtures exist', () => {
    render(
      <TournamentDirectory
        tournaments={[
          base({
            status: 'awaiting_fixtures',
            season: 2027,
            next_fixture: { season: 2027, starts: '2026-09-16', fixtures: 36 },
          }),
        ]}
        onOpen={() => {}}
      />,
    )
    const card = screen.getByRole('button', { name: /Champions League/i })
    expect(card).toHaveTextContent(/Next up/i)
    expect(card).toHaveTextContent('36 fixtures')
    expect(card).toHaveTextContent(/16 Sep/i)
  })

  it('opens each competition on the edition the artifact calls current', () => {
    // Not simply the newest season: a competition whose next edition has one
    // qualifying tie played would otherwise lead with a tournament that has
    // barely started.
    render(
      <TournamentDirectory
        tournaments={[
          base({ season: 2027, is_current: false, status: 'awaiting_fixtures' }),
          base({
            season: 2026,
            is_current: true,
            status: 'in_progress',
            odds: [{ team_id: 1, team: 'Real Madrid', probability: 0.24, elo: 1950 }],
          }),
        ]}
        onOpen={() => {}}
      />,
    )
    const card = screen.getByRole('button', { name: /Champions League/i })
    expect(card).toHaveTextContent('2026')
    expect(card).toHaveTextContent(/In progress/i)
    expect(card).toHaveTextContent(/2 editions on file/i)
  })

  it('orders by competition, not by which one happens to be playing', () => {
    // Some minor competition is nearly always mid-flight. Sorting live-first
    // put the Champions League below it for most of the calendar.
    render(
      <TournamentDirectory
        tournaments={[
          base({
            competition_id: 'conmebol.sudamericana',
            name: 'Copa Sudamericana',
            status: 'in_progress',
          }),
          base({ status: 'completed', actual_champion: 'Arsenal' }),
        ]}
        onOpen={() => {}}
      />,
    )
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(names.findIndex((n) => /Champions League/.test(n))).toBeLessThan(
      names.findIndex((n) => /Sudamericana/.test(n)),
    )
  })
})
