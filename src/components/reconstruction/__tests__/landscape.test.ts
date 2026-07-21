import { readFileSync } from 'fs'
import { join } from 'path'

import type { MomentumBin, MomentumLandscape } from '@/lib/reconstructions'

import {
  buildSurface,
  clamp,
  dominantZone,
  leaderAt,
  minuteLabel,
  momentumColor,
  sampleAt,
  scoreAt,
  timeToX,
  xToTime,
  type RGB,
  type SurfaceOptions,
} from '../landscape'

const HOME: RGB = [0, 1, 0]
const AWAY: RGB = [1, 0, 0]
const NEUTRAL: RGB = [1, 1, 0]

function opts(overrides: Partial<SurfaceOptions> = {}): SurfaceOptions {
  return {
    timeSpan: 40,
    depthSpan: 8,
    amplitude: 5,
    domainMinutes: 90,
    home: HOME,
    away: AWAY,
    neutral: NEUTRAL,
    ...overrides,
  }
}

function bin(t: number, momentum: number, zones: [number, number, number]): MomentumBin {
  return { t, momentum, zoneIntensities: zones }
}

describe('momentumColor', () => {
  it('is neutral at zero and the pure endpoints at ±1', () => {
    expect(momentumColor(0, HOME, AWAY, NEUTRAL)).toEqual(NEUTRAL)
    expect(momentumColor(1, HOME, AWAY, NEUTRAL)).toEqual(HOME)
    expect(momentumColor(-1, HOME, AWAY, NEUTRAL)).toEqual(AWAY)
  })

  it('lerps toward home for positive and away for negative', () => {
    const pos = momentumColor(0.5, HOME, AWAY, NEUTRAL)
    // halfway between yellow (1,1,0) and green (0,1,0) -> (0.5,1,0)
    expect(pos[0]).toBeCloseTo(0.5)
    expect(pos[1]).toBeCloseTo(1)
    const neg = momentumColor(-0.5, HOME, AWAY, NEUTRAL)
    // halfway between yellow and red (1,0,0) -> (1,0.5,0)
    expect(neg[0]).toBeCloseTo(1)
    expect(neg[1]).toBeCloseTo(0.5)
  })

  it('clamps magnitudes beyond one', () => {
    expect(momentumColor(9, HOME, AWAY, NEUTRAL)).toEqual(HOME)
    expect(momentumColor(-9, HOME, AWAY, NEUTRAL)).toEqual(AWAY)
  })
})

describe('timeToX / xToTime', () => {
  it('centres the domain and inverts cleanly', () => {
    expect(timeToX(0, 90, 40)).toBeCloseTo(-20)
    expect(timeToX(90, 90, 40)).toBeCloseTo(20)
    expect(timeToX(45, 90, 40)).toBeCloseTo(0)
    for (const t of [0, 12.5, 45, 88]) {
      expect(xToTime(timeToX(t, 90, 40), 90, 40)).toBeCloseTo(t)
    }
  })

  it('clamps xToTime into the domain', () => {
    expect(xToTime(999, 90, 40)).toBe(90)
    expect(xToTime(-999, 90, 40)).toBe(0)
  })
})

describe('buildSurface', () => {
  const bins: MomentumBin[] = [
    bin(0, 0, [0, 0, 0]),
    bin(0.5, 0.6, [0.1, 0.2, 0.3]),
    bin(1, -0.4, [-0.4, 0, 0]),
  ]
  const surf = buildSurface(bins, opts({ domainMinutes: 1 }))

  it('emits one vertex per (bin × 3 zones)', () => {
    expect(surf.nTime).toBe(3)
    expect(surf.nZone).toBe(3)
    expect(surf.positions.length).toBe(3 * 3 * 3)
    expect(surf.colors.length).toBe(3 * 3 * 3)
  })

  it('emits two triangles per grid quad', () => {
    // (3-1) * (3-1) quads * 6 indices
    expect(surf.indices.length).toBe((3 - 1) * (3 - 1) * 6)
    expect(Math.max(...Array.from(surf.indices))).toBeLessThan(surf.positions.length / 3)
  })

  it('height follows the zone intensity, signed home-up / away-down', () => {
    // bin index 1, zone 2 -> intensity 0.3 -> y = 0.3 * amplitude(5) = 1.5
    const idx = (1 * 3 + 2) * 3
    expect(surf.positions[idx + 1]).toBeCloseTo(1.5)
    // bin index 2, zone 0 -> intensity -0.4 -> y negative (away digs down)
    const away = (2 * 3 + 0) * 3
    expect(surf.positions[away + 1]).toBeCloseTo(-2)
  })

  it('colours a home-positive vertex greener and an away vertex redder', () => {
    const homeIdx = (1 * 3 + 2) * 3 // +0.3
    // toward green: g high, r reduced from neutral
    expect(surf.colors[homeIdx + 1]).toBeCloseTo(1)
    expect(surf.colors[homeIdx]).toBeLessThan(1)
    const awayIdx = (2 * 3 + 0) * 3 // -0.4
    // toward red: r stays 1, g reduced
    expect(surf.colors[awayIdx]).toBeCloseTo(1)
    expect(surf.colors[awayIdx + 1]).toBeLessThan(1)
  })
})

describe('sampleAt', () => {
  const bins: MomentumBin[] = [
    bin(0, 0, [0, 0, 0]),
    bin(1, 0.4, [0.1, 0.1, 0.2]),
    bin(2, -0.2, [-0.2, 0, 0]),
  ]

  it('returns the exact bin at a bin boundary', () => {
    expect(sampleAt(bins, 1).momentum).toBeCloseTo(0.4)
  })

  it('linearly interpolates between two bins', () => {
    // halfway between t=0 (0) and t=1 (0.4) -> 0.2
    expect(sampleAt(bins, 0.5).momentum).toBeCloseTo(0.2)
    // zone 0 halfway between 0 and 0.1 -> 0.05
    expect(sampleAt(bins, 0.5).zoneIntensities[0]).toBeCloseTo(0.05)
  })

  it('clamps at both ends of the domain', () => {
    expect(sampleAt(bins, -5).momentum).toBeCloseTo(0)
    expect(sampleAt(bins, 99).momentum).toBeCloseTo(-0.2)
  })

  it('handles stoppage-time bins beyond the 45/90 marks', () => {
    const stoppage: MomentumBin[] = [bin(45, 0.2, [0.2, 0, 0]), bin(45.5, 0.6, [0.6, 0, 0])]
    expect(sampleAt(stoppage, 45.25).momentum).toBeCloseTo(0.4)
  })
})

describe('scoreAt', () => {
  const landscape = {
    keyEvents: [
      { t: 22, minute: 22, type: 'goal', team: 'home', player: 'Messi', scoreAfter: { home: 1, away: 0 } },
      { t: 79, minute: 79, type: 'goal', team: 'away', player: 'Mbappé', scoreAfter: { home: 1, away: 1 } },
      { t: 80, minute: 80, type: 'card', team: 'home', player: 'X' },
    ],
  } as unknown as MomentumLandscape

  it('is 0-0 before the first goal', () => {
    expect(scoreAt(landscape.keyEvents, 10)).toEqual({ home: 0, away: 0 })
  })

  it('reflects the last goal at or before t', () => {
    expect(scoreAt(landscape.keyEvents, 30)).toEqual({ home: 1, away: 0 })
    expect(scoreAt(landscape.keyEvents, 90)).toEqual({ home: 1, away: 1 })
  })
})

describe('leaderAt / dominantZone / minuteLabel / clamp', () => {
  it('picks a side outside the dead band, else even', () => {
    expect(leaderAt(0.3)).toBe('home')
    expect(leaderAt(-0.3)).toBe('away')
    expect(leaderAt(0.01)).toBe('even')
  })

  it('finds the strongest-magnitude zone', () => {
    expect(dominantZone([0.1, -0.5, 0.2])).toBe(1)
    expect(dominantZone([0.6, -0.5, 0.2])).toBe(0)
  })

  it('labels a minute and clamps', () => {
    expect(minuteLabel(45.7)).toBe('45′')
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
  })
})

describe('committed artifacts are internally consistent (real data)', () => {
  const slugs = ['wc2022-final-arg-fra', 'wwc2023-final-esp-eng']
  for (const slug of slugs) {
    const raw = readFileSync(join(process.cwd(), 'public', 'momentum', `${slug}.json`), 'utf-8')
    const data = JSON.parse(raw) as MomentumLandscape

    it(`${slug}: momentum equals the sum of its zone intensities`, () => {
      for (const b of data.bins) {
        const sum = b.zoneIntensities.reduce((a, v) => a + v, 0)
        expect(Math.abs(b.momentum - sum)).toBeLessThan(2e-4)
      }
    })

    it(`${slug}: every value is normalised into [-1, 1]`, () => {
      for (const b of data.bins) {
        expect(Math.abs(b.momentum)).toBeLessThanOrEqual(1 + 1e-6)
        for (const z of b.zoneIntensities) expect(Math.abs(z)).toBeLessThanOrEqual(1 + 1e-6)
      }
    })

    it(`${slug}: bins are strictly time-ordered`, () => {
      for (let i = 1; i < data.bins.length; i++) {
        expect(data.bins[i].t).toBeGreaterThan(data.bins[i - 1].t)
      }
    })

    it(`${slug}: the final goal's running score matches the final score`, () => {
      const goals = data.keyEvents.filter((e) => e.type === 'goal' && e.scoreAfter)
      if (goals.length > 0) {
        expect(goals[goals.length - 1].scoreAfter).toEqual({
          home: data.finalScore.home,
          away: data.finalScore.away,
        })
      }
    })
  }
})
