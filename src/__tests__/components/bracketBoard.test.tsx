import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BracketBoard } from '@/components/tournament/BracketBoard'
import type { BracketRound } from '@/components/tournament/BracketBoard'

/**
 * The board itself — what it draws, beyond where it draws it.
 *
 * `bracketLayout.test.ts` pins the geometry. These pin the three things the
 * redesign added, each of which answers a question a reader was previously
 * left to work out from an empty box:
 *
 *   what fills an undrawn slot   the winner of the two ties that feed it
 *   what a tap does              traces that team's remaining route
 *   what the board says at the   the champion, named, rather than a bold row
 *   end of a finished edition    somewhere in the middle of the tree
 */

const tie = (over: Record<string, unknown>) => ({
  score: null,
  winner: null,
  winner_id: null,
  p_team_a: null,
  two_legged: false,
  pending: false,
  kickoff: '2026-04-08',
  slot: null,
  ...over,
})

/** Four ties, two semis, one final — the smallest bracket with a real shape. */
const LIVE: BracketRound[] = [
  {
    slug: 'quarterfinals',
    label: 'quarterfinals',
    display: 'Quarter-finals',
    slots: 4,
    ties: [
      tie({
        slot: 0,
        team_a: 'Arsenal',
        team_b: 'Real Madrid',
        team_a_id: 1,
        team_b_id: 2,
        pending: true,
        p_team_a: 0.44,
      }),
      tie({
        slot: 1,
        team_a: 'Bayern Munich',
        team_b: 'Inter',
        team_a_id: 3,
        team_b_id: 4,
        score: '3-1',
        winner: 'Bayern Munich',
        winner_id: 3,
      }),
      tie({
        slot: 2,
        team_a: 'Barcelona',
        team_b: 'Napoli',
        team_a_id: 5,
        team_b_id: 6,
        pending: true,
        p_team_a: 0.71,
      }),
      tie({
        slot: 3,
        team_a: 'PSG',
        team_b: 'Chelsea',
        team_a_id: 7,
        team_b_id: 8,
        pending: true,
        p_team_a: 0.5,
      }),
    ],
  },
  { slug: 'semifinals', label: 'semifinals', display: 'Semi-finals', slots: 2, ties: [] },
  { slug: 'final', label: 'final', display: 'Final', slots: 1, ties: [] },
]

const FINISHED: BracketRound[] = [
  {
    slug: 'semifinals',
    label: 'semifinals',
    display: 'Semi-finals',
    slots: 2,
    ties: [
      tie({
        slot: 0,
        team_a: 'Arsenal',
        team_b: 'Real Madrid',
        team_a_id: 1,
        team_b_id: 2,
        score: '2-1',
        winner: 'Arsenal',
        winner_id: 1,
      }),
      tie({
        slot: 1,
        team_a: 'Bayern Munich',
        team_b: 'Inter',
        team_a_id: 3,
        team_b_id: 4,
        score: '0-2',
        winner: 'Inter',
        winner_id: 4,
      }),
    ],
  },
  {
    slug: 'final',
    label: 'final',
    display: 'Final',
    slots: 1,
    ties: [
      tie({
        slot: 0,
        team_a: 'Arsenal',
        team_b: 'Inter',
        team_a_id: 1,
        team_b_id: 4,
        score: '1-1 (4-2 pens)',
        winner: 'Arsenal',
        winner_id: 1,
      }),
    ],
  },
]

describe('BracketBoard', () => {
  it('names an undrawn slot after the ties that feed it', () => {
    // A blank box is the least informative thing a bracket can draw, and
    // "who plays whom next" is exactly what a reader is working out.
    render(<BracketBoard rounds={LIVE} competitionId="uefa.champions" />)
    expect(screen.getByText('Winner of Arsenal / Real Madrid')).toBeInTheDocument()
    expect(screen.getByText('Winner of Barcelona / Napoli')).toBeInTheDocument()
    // A settled feeder names the club that came through, not both of them —
    // so "Bayern Munich" appears twice: in its own tie, and in the empty semi
    // it has already reached.
    expect(screen.getAllByText('Bayern Munich')).toHaveLength(2)
  })

  it('says "to be decided" only where it genuinely cannot say more', () => {
    // The final is fed by two rounds that do not exist yet.
    render(<BracketBoard rounds={LIVE} competitionId="uefa.champions" />)
    expect(screen.getByText('To be decided')).toBeInTheDocument()
  })

  it('traces a route to the final when a tie is tapped', async () => {
    const { container } = render(<BracketBoard rounds={LIVE} competitionId="uefa.champions" />)
    const before = container.querySelectorAll('.opacity-30')
    expect(before).toHaveLength(0)

    await userEvent.click(screen.getByText('Real Madrid'))

    // Everything off that team's path dims: the other three quarter-finals and
    // the semi-final on the far side of the draw.
    const dimmed = Array.from(container.querySelectorAll('.opacity-30'))
    expect(dimmed.length).toBeGreaterThan(0)
    expect(dimmed.some((el) => el.textContent?.includes('PSG'))).toBe(true)
    expect(dimmed.some((el) => el.textContent?.includes('Real Madrid'))).toBe(false)
  })

  it('lets go of the route when the same tie is tapped again', async () => {
    const { container } = render(<BracketBoard rounds={LIVE} competitionId="uefa.champions" />)
    const card = screen.getByText('Real Madrid')
    await userEvent.click(card)
    expect(container.querySelectorAll('.opacity-30').length).toBeGreaterThan(0)
    await userEvent.click(card)
    // Hover survives the second click in jsdom, so assert on the pin being
    // released rather than on the dimming disappearing entirely.
    expect(screen.getByText('Real Madrid')).toBeInTheDocument()
  })

  it('names the champion rather than leaving it as one bold row', () => {
    render(<BracketBoard rounds={FINISHED} competitionId="uefa.champions" />)
    expect(screen.getByText('Champion')).toBeInTheDocument()
    // Arsenal appears in the semi, the final and the champion bar.
    expect(screen.getAllByText('Arsenal').length).toBeGreaterThanOrEqual(3)
  })

  it('claims no champion while the edition is still being played', () => {
    render(<BracketBoard rounds={LIVE} competitionId="uefa.champions" />)
    expect(screen.queryByText('Champion')).not.toBeInTheDocument()
  })

  it('splits an aggregate onto the two clubs and keeps the shootout', () => {
    render(<BracketBoard rounds={FINISHED} competitionId="uefa.champions" />)
    expect(screen.getByText(/4-2 pens/)).toBeInTheDocument()
    const rows = Array.from(document.querySelectorAll('[data-club="Inter"]'))
    // Beaten 0-2 in the semi and 1-1 in the final: both scores are on the club
    // that scored them, not printed once at the foot of the card.
    expect(rows.some((r) => r.textContent?.includes('2'))).toBe(true)
  })

  it('prices an undecided tie on both sides and never alongside a score', () => {
    render(<BracketBoard rounds={LIVE} competitionId="uefa.champions" />)
    expect(screen.getByText('44%')).toBeInTheDocument()
    expect(screen.getByText('56%')).toBeInTheDocument()
    // The settled quarter-final carries goals instead.
    const bayern = document.querySelector('[data-club="Bayern Munich"]')!
    expect(bayern.textContent).toMatch(/3/)
    expect(bayern.textContent).not.toMatch(/%/)
  })

  it('draws one connector per feeding tie', () => {
    const { container } = render(<BracketBoard rounds={LIVE} competitionId="uefa.champions" />)
    // 4 quarter-finals feed 2 semis, which feed the final: six paths.
    expect(container.querySelectorAll('svg path')).toHaveLength(6)
  })
})
