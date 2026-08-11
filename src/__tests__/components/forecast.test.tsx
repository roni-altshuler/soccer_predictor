import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { EvidencePanel } from '@/components/forecast/EvidencePanel'
import { FixtureCard } from '@/components/forecast/FixtureCard'
import { FixtureList } from '@/components/forecast/FixtureList'
import { ProbabilityBar } from '@/components/forecast/ProbabilityBar'
import { ProjectedTable } from '@/components/forecast/ProjectedTable'

/**
 * The forecast components, tested for the properties that make them
 * trustworthy rather than for their markup.
 *
 * Three themes:
 *   accessibility  every probability is readable as TEXT, not only as a bar,
 *                  and the sortable table is operable from a keyboard
 *   honesty        an empty live sample says so; it never renders as 0.000
 *   consistency    the 1X2 and the scoreline grid come from one object and
 *                  the card shows both without a caveat
 */

const FIXTURE = {
  competition_id: 'eng.1',
  season: 2026,
  date: '2026-08-21',
  kickoff: '19:00',
  round: 'Matchweek 1',
  home: 'Liverpool',
  away: 'Arsenal',
  p_home: 0.421,
  p_draw: 0.268,
  p_away: 0.311,
  xg_home: 1.62,
  xg_away: 1.34,
  scorelines: [
    { score: '1-1', p: 0.121 },
    { score: '1-0', p: 0.098 },
    { score: '2-1', p: 0.094 },
  ],
  elo_home: 1690.4,
  elo_away: 1799.6,
}

const TABLE = [
  { team: 'Manchester City', p_title: 0.386, p_top4: 0.815, p_relegated: 0.0,
    p_playoff: null, exp_points: 78.8, exp_position: 2.9, played: 0, points: 0 },
  { team: 'Arsenal', p_title: 0.279, p_top4: 0.757, p_relegated: 0.001,
    p_playoff: null, exp_points: 76.2, exp_position: 3.4, played: 0, points: 0 },
  { team: 'Ipswich Town', p_title: 0.0, p_top4: 0.001, p_relegated: 0.712,
    p_playoff: null, exp_points: 28.0, exp_position: 18.0, played: 0, points: 0 },
]

describe('ProbabilityBar', () => {
  it('renders every probability as text, not only as a bar', () => {
    render(
      <ProbabilityBar probabilities={{ home: 0.421, draw: 0.268, away: 0.311 }} />,
    )
    // Colour and width are a second encoding; the text is the first.
    expect(screen.getByText('42.1%')).toBeInTheDocument()
    expect(screen.getByText('26.8%')).toBeInTheDocument()
    expect(screen.getByText('31.1%')).toBeInTheDocument()
  })

  it('does not imply precision beyond the model calibration', () => {
    render(<ProbabilityBar probabilities={{ home: 0.42137, draw: 0.26801, away: 0.31062 }} />)
    expect(screen.getByText('42.1%')).toBeInTheDocument()
    expect(screen.queryByText(/42\.14/)).not.toBeInTheDocument()
  })
})

describe('FixtureCard', () => {
  it('makes the forecast readable in one pass', () => {
    render(<FixtureCard fixture={FIXTURE} />)
    expect(screen.getByText('Liverpool')).toBeInTheDocument()
    expect(screen.getByText('Arsenal')).toBeInTheDocument()
    expect(screen.getByText('42.1%')).toBeInTheDocument()
    expect(screen.getByText('1.62 — 1.34')).toBeInTheDocument()
    expect(screen.getByText('1-1 · 12.1%')).toBeInTheDocument()
  })

  it('gives the view-match link an accessible name naming both clubs', () => {
    render(<FixtureCard fixture={FIXTURE} href="/season/fixture/abc" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAccessibleName(/Liverpool versus Arsenal/i)
  })

  it('renders without a link when none is given', () => {
    render(<FixtureCard fixture={FIXTURE} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('ProjectedTable', () => {
  it('exposes both a table and a mobile list with the same numbers', () => {
    render(<ProjectedTable rows={TABLE} relegationPlaces={3} />)
    // Desktop table and mobile card list both render; each club appears twice.
    expect(screen.getAllByText('Manchester City')).toHaveLength(2)
    expect(screen.getAllByText('38.6%')).toHaveLength(2)
    expect(screen.getAllByText('71.2%')).toHaveLength(2)
  })

  it('is sortable from the keyboard and announces the sort', async () => {
    render(<ProjectedTable rows={TABLE} relegationPlaces={3} />)
    const header = screen.getByRole('columnheader', { name: /sort by Title/i })
    expect(header).toHaveAttribute('aria-sort', 'none')

    const button = within(header).getByRole('button')
    button.focus()
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(
      screen.getByRole('columnheader', { name: /sort by Title/i }),
    ).toHaveAttribute('aria-sort', 'descending')
  })

  it('states the relegation rule rather than leaving it implied', () => {
    render(<ProjectedTable rows={TABLE} relegationPlaces={3} />)
    expect(screen.getByText(/3 of 3 go down/i)).toBeInTheDocument()
  })
})

describe('EvidencePanel', () => {
  const historical = { available: true, n: 43433, brier: 0.59303, ece: 0.0099 }

  it('keeps historical and live in separate blocks', () => {
    render(<EvidencePanel historical={historical} live={{ n: 0 }} />)
    expect(screen.getByText(/Historical walk-forward/i)).toBeInTheDocument()
    expect(screen.getByText(/Live published forecasts/i)).toBeInTheDocument()
    expect(screen.getByText('43,433')).toBeInTheDocument()
  })

  it('says an empty live sample is empty rather than rendering a zero', () => {
    render(<EvidencePanel historical={historical} live={{ n: 0 }} />)
    expect(screen.getByText(/Nothing scored yet/i)).toBeInTheDocument()
    expect(screen.getByText(/genuinely zero rather than pending/i)).toBeInTheDocument()
    // A 0.00000 Brier would read as a perfect model.
    expect(screen.queryByText('0.00000')).not.toBeInTheDocument()
  })

  it('flags a small live sample instead of presenting it as evidence', () => {
    render(<EvidencePanel historical={historical} live={{ n: 40, brier: 0.55, ece: 0.02 }} />)
    expect(screen.getByText(/too few to conclude anything/i)).toBeInTheDocument()
  })

  it('publishes the feature groups that were measured and dropped', () => {
    render(<EvidencePanel historical={historical} live={{ n: 0 }} />)
    for (const dropped of ['referee', 'rest', 'head-to-head', 'venue']) {
      expect(screen.getByText(dropped)).toBeInTheDocument()
    }
  })

  it('makes no claim about beating bookmakers', () => {
    const { container } = render(
      <EvidencePanel historical={historical} live={{ n: 0 }} />,
    )
    // The repository's own measurements say the opposite, so the words must
    // not appear anywhere in this panel.
    expect(container.textContent).not.toMatch(/bookmaker|beat the market|guaranteed/i)
  })
})

// --------------------------------------------------------- the fixture list
//
// A whole season of fixtures is a different problem from "the next six": the
// reader is scanning, not reading. These pin the two things that keep it from
// becoming a wall — day headings and a bounded first render — and the sentence
// that makes a positional layout mean something to a screen reader.

describe('FixtureList', () => {
  const fx = (date: string, home: string, away: string, uid?: string) => ({
    fixture_uid: uid,
    competition_id: 'eng.1',
    season: 2026,
    date,
    kickoff: '15:00',
    home,
    away,
    p_home: 0.5,
    p_draw: 0.25,
    p_away: 0.25,
    xg_home: 1.6,
    xg_away: 1.1,
    scorelines: [{ score: '1-0', p: 0.11 }],
  })

  it('groups fixtures under the day they are played', () => {
    render(
      <FixtureList
        fixtures={[
          fx('2026-08-21', 'Liverpool', 'Arsenal'),
          fx('2026-08-21', 'Chelsea', 'Everton'),
          fx('2026-08-22', 'Fulham', 'Brentford'),
        ]}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Friday 21 August' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Saturday 22 August' }),
    ).toBeInTheDocument()
  })

  it('reads each row as a sentence, not as three unlabelled numbers', () => {
    render(<FixtureList fixtures={[fx('2026-08-21', 'Liverpool', 'Arsenal')]} />)
    expect(
      screen.getByText(
        /Liverpool versus Arsenal\. Liverpool 50\.0 per cent, draw 25\.0 per cent, Arsenal 25\.0 per cent\./,
      ),
    ).toBeInTheDocument()
  })

  it('does not render a whole season at once', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      fx(`2026-09-${String(i + 1).padStart(2, '0')}`, `Home ${i}`, `Away ${i}`),
    )
    render(<FixtureList fixtures={many} />)
    expect(screen.getAllByRole('heading')).toHaveLength(6)
    expect(screen.getByRole('button', { name: /14 more matchdays/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Show more/ }))
    expect(screen.getAllByRole('heading')).toHaveLength(12)
  })

  it('links a fixture only when there is a page to link to', () => {
    render(
      <FixtureList
        fixtures={[
          fx('2026-08-21', 'Liverpool', 'Arsenal', 'abc123'),
          fx('2026-08-21', 'Chelsea', 'Everton'),
        ]}
      />,
    )
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Liverpool versus Arsenal/ })).toHaveAttribute(
      'href',
      '/season/fixture/abc123',
    )
  })

  it('says so when a league has nothing left to play', () => {
    render(<FixtureList fixtures={[]} />)
    expect(screen.getByText(/No fixtures remain in this league/i)).toBeInTheDocument()
  })
})
