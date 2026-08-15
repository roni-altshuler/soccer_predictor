import { render, screen } from '@testing-library/react'

import { RecordedForecastPanel, leadTime } from '@/components/fixture/RecordedForecast'
import type { RecordedForecast } from '@/lib/server/recordedForecast'

/**
 * The panel that puts the project's central claim on the match itself.
 *
 * Its value is entirely in what it refuses to do: it will not sit a number
 * beside a result it did not precede, and it will not let one fixture read as
 * a verdict. Those two are the tests worth having.
 */

const recorded = (over: Partial<RecordedForecast> = {}): RecordedForecast => ({
  matchId: '401879301',
  league: 'Premier League',
  homeTeam: 'Arsenal',
  awayTeam: 'Fulham',
  p: [0.62, 0.22, 0.16],
  recordedAt: '2026-05-01T09:00:00+00:00',
  hoursBeforeKickoff: 31.5,
  beforeKickoff: true,
  outcome: 'home',
  homeGoals: 3,
  awayGoals: 0,
  calledIt: true,
  pActual: 0.62,
  brier: 0.2184,
  ...over,
})

const draw = (r: RecordedForecast) => render(
  <RecordedForecastPanel recorded={r} homeName="Arsenal" awayName="Fulham" />,
)

describe('RecordedForecastPanel', () => {
  it('refuses to draw a number it cannot show predates kickoff', () => {
    // THE test. Printing a post-hoc number beside the result it already knows
    // is the exact flattery this project is built to avoid, and a caveat is
    // not good enough — the panel is about ordering, so without ordering there
    // is no panel.
    const { container } = draw(recorded({ beforeKickoff: false }))
    expect(container).toBeEmptyDOMElement()
  })

  it('draws when the ordering is provable, and says how far ahead', () => {
    draw(recorded())
    expect(screen.getByText(/What the model said before kickoff/i)).toBeInTheDocument()
    expect(document.querySelector('[data-lead-time]')).toHaveTextContent('32 hours before kickoff')
  })

  it('leads with the probability it gave what actually happened', () => {
    // The interpretable number, and the one a proper scoring rule is built on.
    draw(recorded())
    expect(document.querySelector('[data-p-actual]')).toHaveTextContent('62.0%')
    expect(screen.getByText(/Arsenal won/)).toBeInTheDocument()
    expect(screen.getByText('3-0')).toBeInTheDocument()
  })

  it('warns against reading a verdict off one match, even when it was right', () => {
    // A hit read as proof is the same error as a miss read as failure, in the
    // flattering direction — so the caveat is unconditional.
    draw(recorded())
    expect(screen.getByText(/Its highest of the three landed/i)).toBeInTheDocument()
    expect(screen.getByText(/One match cannot judge a forecast/i)).toBeInTheDocument()
  })

  it('says plainly when it missed', () => {
    draw(recorded({ calledIt: false, outcome: 'away', pActual: 0.16, brier: 0.9 }))
    expect(screen.getByText(/did not land on the result/i)).toBeInTheDocument()
    expect(document.querySelector('[data-p-actual]')).toHaveTextContent('16.0%')
    expect(screen.getByText(/Fulham won/)).toBeInTheDocument()
  })

  it('shows a forecast for an unplayed match without inventing a score', () => {
    const r = recorded({ outcome: null, homeGoals: null, awayGoals: null, calledIt: null, pActual: null, brier: null })
    draw(r)
    expect(screen.getByText(/What the model expects/i)).toBeInTheDocument()
    expect(document.querySelector('[data-recorded-forecast]')).toHaveAttribute(
      'data-recorded-forecast',
      'pending',
    )
    expect(screen.queryByText(/One match cannot judge/i)).not.toBeInTheDocument()
    expect(document.querySelector('[data-p-actual]')).toBeNull()
  })

  it('says nothing about timing when the record could not prove any', () => {
    draw(recorded({ beforeKickoff: null, hoursBeforeKickoff: null }))
    // Targeted, because the heading itself legitimately reads
    // "...said before kickoff".
    expect(document.querySelector('[data-lead-time]')).toBeNull()
    expect(document.querySelector('[data-recorded-forecast]')).toBeTruthy()
  })
})

describe('leadTime', () => {
  it('reads in hours, then in days', () => {
    expect(leadTime(31.5)).toBe('32 hours before kickoff')
    expect(leadTime(72)).toBe('3 days before kickoff')
  })

  it('does not round a near-kickoff forecast up into comfort', () => {
    expect(leadTime(0.4)).toBe('less than an hour before kickoff')
  })

  it('claims nothing from a missing or impossible lead', () => {
    expect(leadTime(null)).toBeNull()
    expect(leadTime(0)).toBeNull()
    expect(leadTime(-3)).toBeNull()
  })
})
