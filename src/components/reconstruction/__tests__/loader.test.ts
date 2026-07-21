import {
  isValidLandscape,
  loadLandscape,
  featuredBySlug,
  FEATURED_RECONSTRUCTIONS,
  type LandscapeFetch,
} from '@/lib/reconstructions'

function validArtifact() {
  return {
    slug: 's',
    matchId: 1,
    competition: 'C',
    stage: 'Final',
    date: '2022-01-01',
    gender: 'M',
    dataCredit: 'StatsBomb',
    binSeconds: 30,
    zones: ['a', 'b', 'c'],
    scaleReference: 10,
    home: { team: 'H', isNational: true },
    away: { team: 'A', isNational: true },
    finalScore: { home: 1, away: 0, note: '' },
    bins: [{ t: 0, momentum: 0.1, zoneIntensities: [0.1, 0, 0] }],
    keyEvents: [],
  }
}

function fetchReturning(status: boolean, body: unknown): LandscapeFetch {
  return async () => ({ ok: status, json: async () => body })
}

describe('isValidLandscape', () => {
  it('accepts a well-formed artifact', () => {
    expect(isValidLandscape(validArtifact())).toBe(true)
  })

  it('rejects missing / empty bins', () => {
    expect(isValidLandscape({ ...validArtifact(), bins: [] })).toBe(false)
    const { bins: _omit, ...noBins } = validArtifact()
    expect(isValidLandscape(noBins)).toBe(false)
  })

  it('rejects a bin without three numeric zone intensities', () => {
    const bad = { ...validArtifact(), bins: [{ t: 0, momentum: 0, zoneIntensities: [1, 2] }] }
    expect(isValidLandscape(bad)).toBe(false)
  })

  it('rejects a missing final score', () => {
    const { finalScore: _omit, ...noScore } = validArtifact()
    expect(isValidLandscape(noScore)).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isValidLandscape(null)).toBe(false)
    expect(isValidLandscape('nope')).toBe(false)
  })
})

describe('loadLandscape gating', () => {
  it('returns the artifact on a valid 200', async () => {
    const data = await loadLandscape('s', fetchReturning(true, validArtifact()))
    expect(data?.slug).toBe('s')
  })

  it('returns null on a non-ok response (missing → honest empty)', async () => {
    expect(await loadLandscape('s', fetchReturning(false, validArtifact()))).toBeNull()
  })

  it('returns null when the payload is malformed', async () => {
    expect(await loadLandscape('s', fetchReturning(true, { nope: 1 }))).toBeNull()
  })

  it('returns null when fetch throws (offline)', async () => {
    const throwing: LandscapeFetch = async () => {
      throw new Error('offline')
    }
    expect(await loadLandscape('s', throwing)).toBeNull()
  })

  it('requests the committed public path for the slug', async () => {
    let seen = ''
    const spy: LandscapeFetch = async (url) => {
      seen = url
      return { ok: true, json: async () => validArtifact() }
    }
    await loadLandscape('wc2022-final-arg-fra', spy)
    expect(seen).toBe('/momentum/wc2022-final-arg-fra.json')
  })
})

describe('registry', () => {
  it('ships one men’s and one women’s showcase with matching slugs', () => {
    expect(FEATURED_RECONSTRUCTIONS).toHaveLength(2)
    expect(FEATURED_RECONSTRUCTIONS.map((m) => m.gender).sort()).toEqual(['F', 'M'])
  })

  it('resolves slugs and rejects unknown ones', () => {
    expect(featuredBySlug('wc2022-final-arg-fra')?.home).toBe('Argentina')
    expect(featuredBySlug('nope')).toBeUndefined()
  })
})
