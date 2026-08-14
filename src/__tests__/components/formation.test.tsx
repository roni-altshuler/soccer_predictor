import { render, screen, within } from '@testing-library/react'

import { Formation, dealRows, formationRows, shortLabel } from '@/components/fixture/Formation'
import type { Lineup, LineupPlayer } from '@/lib/server/tieFixtures'

/**
 * The team sheets, in the shape the two sides actually lined up in.
 *
 * `4-2-3-1` against `4-4-2` is most of what a reader wants from a lineup, and
 * a flat list of eleven names cannot show it — so the pitch is drawn from
 * ESPN's own formation string and `formationPlace`, never inferred.
 *
 * The two properties worth pinning are what it draws and what it refuses to
 * draw: a shape built from numbers that do not add up is a wrong claim about
 * how a team set up, and the list is the honest fallback.
 */

const p = (n: number, over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  id: `p${n}`,
  name: `Player ${n}`,
  short: `P. ${n}`,
  jersey: String(n),
  position: 'M',
  formationPlace: n,
  subbedIn: false,
  subbedOut: false,
  ...over,
})

const eleven = Array.from({ length: 11 }, (_, i) => p(i + 1))

const lineup = (over: Partial<Lineup> = {}): Lineup => ({
  teamId: '1',
  homeAway: 'home',
  formation: '4-3-3',
  starters: eleven,
  bench: [p(12), p(14, { subbedIn: true })],
  ...over,
})

describe('formationRows', () => {
  it('puts the keeper in front of the bands', () => {
    expect(formationRows('4-3-3', 11)).toEqual([1, 4, 3, 3])
    expect(formationRows('4-2-3-1', 11)).toEqual([1, 4, 2, 3, 1])
  })

  it('refuses a shape that does not add up to the eleven it was given', () => {
    // A sheet that says 4-4-2 and lists ten is a hole in the data, not a
    // formation, and drawing it would place a player in a position nobody
    // played.
    expect(formationRows('4-4-2', 10)).toBeNull()
    expect(formationRows('4-3-3', 11)).not.toBeNull()
  })

  it('refuses nonsense rather than rendering it', () => {
    expect(formationRows(null, 11)).toBeNull()
    expect(formationRows('', 11)).toBeNull()
    expect(formationRows('diamond', 11)).toBeNull()
    expect(formationRows('4-3-3-0', 11)).toBeNull()
  })
})

describe('dealRows', () => {
  it('fills each band in formationPlace order', () => {
    const bands = dealRows(eleven, [1, 4, 3, 3])
    expect(bands.map((b) => b.length)).toEqual([1, 4, 3, 3])
    expect(bands[0][0].jersey).toBe('1')
    expect(bands[3].map((x) => x.jersey)).toEqual(['9', '10', '11'])
  })
})

describe('shortLabel', () => {
  it('uses the source’s own short name rather than deriving one', () => {
    // Deriving it by dropping the first token gives "Júnior" for Vinícius
    // Júnior — the rule that works for European surnames fails for Brazilian
    // and Spanish ones, and a name nobody recognises is worse than a long one.
    expect(shortLabel({ name: 'Vinícius Júnior', short: 'V. Júnior' })).toBe('V. Júnior')
    expect(shortLabel({ name: 'Trent Alexander-Arnold', short: 'T. Alexander-Arnold' })).toBe(
      'T. Alexander-Arnold',
    )
  })

  it('falls back to the full name when the source published no short one', () => {
    expect(shortLabel({ name: 'Alisson Becker', short: '' })).toBe('Alisson Becker')
  })
})

describe('Formation', () => {
  it('identifies players by shirt number, not by a face', () => {
    // Every provider that shows portraits licences them; ESPN has a headshot
    // for one player in forty-six. The number is on the actual shirt.
    const { container } = render(
      <Formation
        lineups={[lineup(), lineup({ homeAway: 'away', teamId: '2' })]}
        homeName="Arsenal"
        awayName="Real Madrid"
      />,
    )
    expect(container.querySelectorAll('img')).toHaveLength(0)
    const token = container.querySelector('[data-player="Player 7"]')!
    expect(token).toHaveTextContent('7')
  })

  it('draws both elevens and names the two shapes', () => {
    render(
      <Formation
        lineups={[lineup({ formation: '4-2-3-1' }), lineup({ homeAway: 'away', teamId: '2' })]}
        homeName="Arsenal"
        awayName="Real Madrid"
      />,
    )
    // Each label sits against its own half — away above the pitch, home below
    // — because side-by-side labels read as left-hand and right-hand teams.
    expect(screen.getByText(/Arsenal · 4-2-3-1/)).toBeInTheDocument()
    expect(screen.getByText(/Real Madrid · 4-3-3/)).toBeInTheDocument()
  })

  it('falls back to a list when a shape cannot be trusted', () => {
    // Ten starters against a 4-3-3. The names are still real; the shape is not.
    render(
      <Formation
        lineups={[lineup({ starters: eleven.slice(0, 10) })]}
        homeName="Arsenal"
        awayName="Real Madrid"
      />,
    )
    expect(screen.getAllByText('Player 4').length).toBeGreaterThan(0)
    expect(screen.getByText(/Arsenal · 4-3-3/)).toBeInTheDocument()
  })

  it('lists the bench and marks who came on', () => {
    render(<Formation lineups={[lineup()]} homeName="Arsenal" awayName="Real Madrid" />)
    const bench = screen.getByText('Arsenal · bench').parentElement!
    // The bench carries the source's short name too, and the row keeps the
    // full one on the element for anyone hovering it.
    expect(within(bench).getByText('P. 12')).toBeInTheDocument()
    expect(within(bench).getByText('on')).toBeInTheDocument()
    expect(bench.querySelector('[data-player="Player 12"]')).toBeTruthy()
  })

  it('shows nothing rather than an empty pitch when no sheet was filed', () => {
    const { container } = render(
      <Formation lineups={[]} homeName="Arsenal" awayName="Real Madrid" />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
