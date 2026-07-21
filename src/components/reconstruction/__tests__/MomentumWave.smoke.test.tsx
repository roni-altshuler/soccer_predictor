import { readFileSync } from 'fs'
import { join } from 'path'

import { render, screen } from '@testing-library/react'

import type { MomentumLandscape } from '@/lib/reconstructions'

// WebGL can't run in jsdom, so the R3F surfaces are stubbed out and we assert
// the DOM shell + readout that wrap the canvas. The pure geometry/probe maths
// is covered exhaustively in landscape.test.ts.
jest.mock('@react-three/fiber', () => ({
  Canvas: () => null,
  useFrame: () => {},
}))
jest.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
}))

import { MomentumWave } from '../MomentumWave'

function loadArtifact(slug: string): MomentumLandscape {
  const raw = readFileSync(join(process.cwd(), 'public', 'momentum', `${slug}.json`), 'utf-8')
  return JSON.parse(raw) as MomentumLandscape
}

describe('MomentumWave', () => {
  it('renders an honest empty notice when the landscape is missing', () => {
    render(<MomentumWave landscape={null} />)
    expect(screen.getByText(/isn't available/i)).toBeInTheDocument()
  })

  it('renders the readout chrome, team legend, data credit and event chips', () => {
    render(<MomentumWave landscape={loadArtifact('wc2022-final-arg-fra')} />)
    // Legend keyed to the two teams.
    expect(screen.getByText(/Argentina threat/)).toBeInTheDocument()
    expect(screen.getByText(/France threat/)).toBeInTheDocument()
    // Licence-required data credit travels with the viz.
    expect(screen.getByText(/StatsBomb/)).toBeInTheDocument()
    // A goal from the key-event timeline strip.
    expect(screen.getAllByText(/Messi/).length).toBeGreaterThan(0)
  })
})
