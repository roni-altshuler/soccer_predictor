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

  it('shows data source attribution', () => {
    render(<Footer />)
    expect(screen.getByText(/Powered by/i)).toBeInTheDocument()
    const fotmobLink = screen.getByRole('link', { name: /FotMob/i })
    const espnLink = screen.getByRole('link', { name: /ESPN/i })
    expect(fotmobLink).toHaveAttribute('href', 'https://www.fotmob.com')
    expect(espnLink).toHaveAttribute('href', 'https://www.espn.com/soccer/')
  })

  it('displays educational disclaimer', () => {
    render(<Footer />)
    expect(screen.getByText(/For educational and entertainment purposes only/i)).toBeInTheDocument()
  })
})
