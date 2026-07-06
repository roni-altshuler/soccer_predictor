import { render, screen } from '@testing-library/react'

import {
  FlagBadge,
  LeagueChip,
  ProbBar,
  SectionHeader,
  StatCard,
  StatusChip,
} from '@/components/primitives'

describe('broadcast primitives', () => {
  it('SectionHeader renders kicker, title and description', () => {
    render(
      <SectionHeader
        kicker="today"
        title="Match Centre"
        description="Fixtures and predictions"
      />
    )
    expect(screen.getByRole('heading', { name: 'Match Centre' })).toBeInTheDocument()
    expect(screen.getByText('today')).toBeInTheDocument()
    expect(screen.getByText('Fixtures and predictions')).toBeInTheDocument()
  })

  it('StatCard renders label and value', () => {
    render(<StatCard label="Accuracy" value="60.6%" sub="settled picks" accent="ai" />)
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('60.6%')).toBeInTheDocument()
    expect(screen.getByText('settled picks')).toBeInTheDocument()
  })

  it('ProbBar exposes an accessible probability label and renormalises', () => {
    render(<ProbBar home={0.5} draw={0.25} away={0.25} showLabels />)
    expect(
      screen.getByLabelText('Win probability: home 50%, draw 25%, away 25%')
    ).toBeInTheDocument()
    expect(screen.getByText('H 50%')).toBeInTheDocument()
  })

  it('ProbBar handles a zero/degenerate input without NaN', () => {
    render(<ProbBar home={0} draw={0} away={0} />)
    // Even/even/even fallback → 33% each.
    expect(
      screen.getByLabelText('Win probability: home 33%, draw 33%, away 33%')
    ).toBeInTheDocument()
  })

  it('LeagueChip renders a button with the league name', () => {
    render(<LeagueChip leagueId="eng.1" name="Premier League" onClick={() => {}} />)
    expect(
      screen.getByRole('button', { name: /Premier League/ })
    ).toBeInTheDocument()
  })

  it('LeagueChip renders a link when href is set', () => {
    render(<LeagueChip leagueId="esp.1" name="La Liga" href="/leagues/esp.1" active />)
    const link = screen.getByRole('link', { name: /La Liga/ })
    expect(link).toHaveAttribute('href', '/leagues/esp.1')
    expect(link).toHaveAttribute('aria-current', 'true')
  })

  it('StatusChip renders the default lowercase label', () => {
    render(<StatusChip status="live" />)
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  it('FlagBadge falls back to a monogram when no image resolves', () => {
    render(<FlagBadge teamName="Wanderers" />)
    expect(screen.getByLabelText('Wanderers')).toBeInTheDocument()
    expect(screen.getByText('W')).toBeInTheDocument()
  })

  it('FlagBadge renders a flag image for a known country', () => {
    render(<FlagBadge country="Spain" teamName="Spain" />)
    const img = screen.getByAltText('Spain') as HTMLImageElement
    expect(img).toBeInTheDocument()
    expect(img.src).toContain('flagcdn.com/w40/es.png')
  })
})
