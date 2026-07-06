import { render, screen } from '@testing-library/react'
import { Footer } from '@/components/Footer'

describe('Footer', () => {
  it('renders the soccer predictor branding', () => {
    render(<Footer />)
    expect(screen.getByText('Pitchwise')).toBeInTheDocument()
    expect(screen.getByText(/Calibrated football intelligence/i)).toBeInTheDocument()
  })

  it('renders all navigation links', () => {
    render(<Footer />)
    expect(screen.getByText('Leagues')).toBeInTheDocument()
    expect(screen.getByText('AI Predict')).toBeInTheDocument()
    expect(screen.getByText('Accuracy')).toBeInTheDocument()
    expect(screen.getByText('News')).toBeInTheDocument()
    expect(screen.getByText('About')).toBeInTheDocument()
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

  it('displays educational disclaimer', () => {
    render(<Footer />)
    expect(screen.getByText(/For educational and entertainment purposes only/i)).toBeInTheDocument()
  })
})
