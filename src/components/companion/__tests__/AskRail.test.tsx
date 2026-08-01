import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import { AskRail } from '@/components/companion/AskRail'
import { CompanionProvider, useCompanionSubject } from '@/components/companion/CompanionProvider'
import type { CompanionContext, MatchContext } from '@/lib/companion/context'

/**
 * The rail's contract is that it never speaks beyond what the page can prove.
 * These tests cover the two ways that breaks: offering a capability whose data
 * is absent, and offering a question about a match that has no state.
 */

function makeMatch(over: Partial<MatchContext> = {}): MatchContext {
  return {
    kind: 'match',
    matchId: '733123',
    home: 'Arsenal',
    away: 'Chelsea',
    competitionId: 'eng.1',
    gender: 'M',
    phase: 'live',
    homeScore: 0,
    awayScore: 2,
    minute: 63,
    hasEventCoverage: true,
    ...over,
  }
}

/** Mount the rail with a page that publishes `subject`. */
function Harness({ subject }: { subject: CompanionContext | null }): ReactNode {
  useCompanionSubject(subject)
  return <AskRail />
}

function renderRail(subject: CompanionContext | null) {
  return render(
    <CompanionProvider>
      <Harness subject={subject} />
    </CompanionProvider>
  )
}

describe('AskRail — subject', () => {
  it('names the match it is speaking about', () => {
    renderRail(makeMatch())
    expect(screen.getByText('Arsenal v Chelsea')).toBeInTheDocument()
  })

  it('falls back to the product name with no subject', () => {
    renderRail(null)
    expect(screen.getByText('Pitchverse')).toBeInTheDocument()
  })
})

describe('AskRail — contextual questions', () => {
  it('offers questions naming the real teams for a live match', () => {
    renderRail(makeMatch())
    expect(screen.getByText('About this match')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: "Can Arsenal come back from 2 down at 60'?" })
    ).toBeInTheDocument()
  })

  it('offers none for a scheduled match — no state to interpret', () => {
    const scheduled = makeMatch({
      phase: 'scheduled',
      homeScore: null,
      awayScore: null,
      minute: null,
    })
    renderRail(scheduled)
    expect(screen.queryByText('About this match')).not.toBeInTheDocument()
  })

  it('offers none with no subject at all, rather than generic examples', () => {
    renderRail(null)
    expect(screen.queryByText('About this match')).not.toBeInTheDocument()
  })
})

describe('AskRail — capability gating', () => {
  it('offers the fork on a covered finished match', () => {
    renderRail(makeMatch({ phase: 'finished', minute: null }))
    expect(screen.getByRole('link', { name: /Fork this match/ })).toBeInTheDocument()
  })

  it('withholds the fork when the match has no timeline', () => {
    renderRail(makeMatch({ phase: 'finished', minute: null, hasEventCoverage: false }))
    expect(screen.queryByRole('link', { name: /Fork this match/ })).not.toBeInTheDocument()
  })

  it('withholds the Counterfact heading entirely when it has nothing to offer', () => {
    const scheduled = makeMatch({
      phase: 'scheduled',
      homeScore: null,
      awayScore: null,
      minute: null,
      hasEventCoverage: false,
    })
    renderRail(scheduled)
    // The universe browser is global-only, so a scheduled match leaves the
    // verb empty — and an empty verb must not render its header.
    expect(screen.queryByText('Counterfact')).not.toBeInTheDocument()
  })

  it('always offers something, even with no subject', () => {
    renderRail(null)
    expect(screen.getByRole('link', { name: /Ask the history anything/ })).toBeInTheDocument()
  })

  it('links the fork at the What if tab', () => {
    renderRail(makeMatch({ phase: 'finished', minute: null }))
    expect(screen.getByRole('link', { name: /Fork this match/ })).toHaveAttribute(
      'href',
      '/matches/733123?tab=whatif'
    )
  })
})
