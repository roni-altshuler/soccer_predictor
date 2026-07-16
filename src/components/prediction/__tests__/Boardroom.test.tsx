import { render, screen } from '@testing-library/react'

import { Boardroom } from '@/components/prediction/Boardroom'
import type { BoardroomDebate } from '@/lib/boardroom'

const DEBATE: BoardroomDebate = {
  match_id: '999',
  home_team: 'Alpha FC',
  away_team: 'Beta FC',
  league: 'Test League',
  kickoff: '2026-08-01',
  gender: 'M',
  dissent_index: 0.28,
  dissent_level: 'high',
  personas: [
    {
      name: 'The Quant',
      key: 'quant',
      stance: 'away',
      text: 'Read straight off the numbers, this leans away.',
      claims: ['Alpha FC 33% / draw 26% / Beta FC 41%'],
    },
    {
      name: 'The Historian',
      key: 'historian',
      stance: 'home',
      text: 'History is blunter than the model.',
      claims: ['level at kickoff — 24847/16328/24847 of 66022'],
    },
    {
      name: 'The Skeptic',
      key: 'skeptic',
      stance: 'draw',
      text: 'Treat the edge as soft.',
      claims: [],
    },
  ],
}

describe('Boardroom', () => {
  it('renders the three personas from a committed debate', () => {
    render(<Boardroom debate={DEBATE} />)

    expect(screen.getByText('The Boardroom')).toBeInTheDocument()
    expect(screen.getByText('The Quant')).toBeInTheDocument()
    expect(screen.getByText('The Historian')).toBeInTheDocument()
    expect(screen.getByText('The Skeptic')).toBeInTheDocument()
    // persona prose + claims render
    expect(screen.getByText('History is blunter than the model.')).toBeInTheDocument()
    expect(screen.getByText('Alpha FC 33% / draw 26% / Beta FC 41%')).toBeInTheDocument()
  })

  it('maps stance to a team-named lean', () => {
    render(<Boardroom debate={DEBATE} />)
    expect(screen.getByText('Leans Beta FC')).toBeInTheDocument() // quant -> away
    expect(screen.getByText('Leans Alpha FC')).toBeInTheDocument() // historian -> home
    expect(screen.getByText('Leans a draw')).toBeInTheDocument() // skeptic -> draw
  })

  it('shows the dissent meter with the level label', () => {
    render(<Boardroom debate={DEBATE} />)
    expect(screen.getByText('high dissent')).toBeInTheDocument()
    expect(screen.getByLabelText('Dissent: high')).toBeInTheDocument()
  })

  it('renders nothing when there is no committed debate (honest absence)', () => {
    const { container } = render(<Boardroom debate={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when fewer than two personas survived', () => {
    const thin = { ...DEBATE, personas: DEBATE.personas.slice(0, 1) }
    const { container } = render(<Boardroom debate={thin} />)
    expect(container).toBeEmptyDOMElement()
  })
})
