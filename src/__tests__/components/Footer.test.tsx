import { render, screen } from '@testing-library/react'
import { Footer } from '@/components/Footer'

describe('Footer', () => {
  it('renders the soccer predictor branding', () => {
    render(<Footer />)
    expect(screen.getByText('Pitchverse')).toBeInTheDocument()
    expect(screen.getByText(/Calibrated football intelligence/i)).toBeInTheDocument()
  })

  it('renders all navigation links', () => {
    render(<Footer />)
    expect(screen.getByText('Leagues')).toBeInTheDocument()
    expect(screen.getByText('AI Predict')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Accuracy' })).toBeInTheDocument()
    expect(screen.getByText(/Title & Relegation/)).toBeInTheDocument()
    expect(screen.getByText('How it works')).toBeInTheDocument()
  })

  it('links only to pages that exist', () => {
    // Regression guard: the footer shipped dead links to /news and /tracking
    // for the whole of the pivot. Anything added here must be a real route.
    const LIVE_ROUTES = ['/leagues', '/predict', '/accuracy', '/simulator', '/about']
    render(<Footer />)
    for (const link of screen.getAllByRole('link')) {
      expect(LIVE_ROUTES).toContain(link.getAttribute('href'))
    }
  })

  it('displays copyright information', () => {
    render(<Footer />)
    const currentYear = new Date().getFullYear()
    expect(screen.getByText(new RegExp(`© ${currentYear}`))).toBeInTheDocument()
  })

  it('does not surface data-provider attribution in the UI', () => {
    // Provenance is documented in the repo (README / docs), not on the site.
    render(<Footer />)
    expect(screen.queryByText(/Powered by/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /FotMob/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /ESPN/i })).not.toBeInTheDocument()
  })

  it('states the honest disclaimer, not the retired educational one', () => {
    // The pivot made this a betting-adjacent product, so "educational and
    // entertainment purposes only" became untrue rather than cautious.
    render(<Footer />)
    expect(screen.getByText(/Probability estimates, not advice/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/educational and entertainment/i),
    ).not.toBeInTheDocument()
  })
})
