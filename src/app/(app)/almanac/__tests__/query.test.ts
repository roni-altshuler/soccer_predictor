import {
  DEFAULT_DIFF,
  DEFAULT_MINUTE,
  MINUTE_OPTIONS,
  PRESETS,
  buildQuestion,
  clampDiff,
  diffFrom,
  directionOf,
  magnitudeOf,
  magnitudeWord,
  minuteBucket,
  minuteLabel,
  ordinal,
  parseQuery,
  queryToSearch,
  statePhrase,
  stateKey,
} from '../query'

describe('state → key mapping (must mirror @/lib/rarity + build_rarity.py)', () => {
  test('minuteBucket floors onto the 5-minute grid', () => {
    expect(minuteBucket(0)).toBe(0)
    expect(minuteBucket(4)).toBe(0)
    expect(minuteBucket(5)).toBe(5)
    expect(minuteBucket(69)).toBe(65)
    expect(minuteBucket(70)).toBe(70)
    expect(minuteBucket(74)).toBe(70)
  })

  test('minuteBucket clamps 90+ and extra time to the 90 bucket', () => {
    expect(minuteBucket(90)).toBe(90)
    expect(minuteBucket(93)).toBe(90)
    expect(minuteBucket(120)).toBe(90)
  })

  test('minuteBucket guards non-finite and negative input', () => {
    expect(minuteBucket(-10)).toBe(0)
    expect(minuteBucket(Number.NaN)).toBe(0)
  })

  test('clampDiff clamps to [-3, 3] and truncates', () => {
    expect(clampDiff(0)).toBe(0)
    expect(clampDiff(-2)).toBe(-2)
    expect(clampDiff(-9)).toBe(-3)
    expect(clampDiff(5)).toBe(3)
    expect(clampDiff(2.9)).toBe(2)
    expect(clampDiff(Number.NaN)).toBe(0)
  })

  test('stateKey composes the canonical "G:diff:bucket" key', () => {
    expect(stateKey({ gender: 'M', diff: -2, minute: 79 })).toBe('M:-2:75')
    expect(stateKey({ gender: 'F', diff: -2, minute: 60 })).toBe('F:-2:60')
    expect(stateKey({ gender: 'M', diff: 4, minute: 999 })).toBe('M:3:90')
    expect(stateKey({ gender: 'M', diff: 0, minute: 45 })).toBe('M:0:45')
  })
})

describe('direction / magnitude split (the two-axis state control)', () => {
  test('directionOf reads the sign of the diff', () => {
    expect(directionOf(-2)).toBe('trailing')
    expect(directionOf(0)).toBe('level')
    expect(directionOf(3)).toBe('leading')
  })

  test('magnitudeOf is the absolute goal gap, defaulting to 1 at level', () => {
    expect(magnitudeOf(-2)).toBe(2)
    expect(magnitudeOf(0)).toBe(1)
    expect(magnitudeOf(3)).toBe(3)
    expect(magnitudeOf(-9)).toBe(3)
  })

  test('diffFrom recomposes a signed diff from the two axes', () => {
    expect(diffFrom('trailing', 2)).toBe(-2)
    expect(diffFrom('leading', 1)).toBe(1)
    expect(diffFrom('level', 2)).toBe(0)
    expect(diffFrom('trailing', 5)).toBe(-3)
  })

  test('directionOf/magnitudeOf/diffFrom round-trip', () => {
    for (const diff of [-3, -2, -1, 0, 1, 2, 3]) {
      expect(diffFrom(directionOf(diff), magnitudeOf(diff))).toBe(diff)
    }
  })
})

describe('plain-English grammar', () => {
  test('ordinal handles the football minute range and teen exceptions', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(45)).toBe('45th')
    expect(ordinal(70)).toBe('70th')
    expect(ordinal(90)).toBe('90th')
  })

  test('magnitudeWord pools a clamped 3 into "three or more"', () => {
    expect(magnitudeWord(1)).toBe('one')
    expect(magnitudeWord(2)).toBe('two')
    expect(magnitudeWord(3)).toBe('three or more')
    expect(magnitudeWord(6)).toBe('three or more')
  })

  test('statePhrase describes trailing / level / leading', () => {
    expect(statePhrase(-2)).toBe('trailing by two')
    expect(statePhrase(-1)).toBe('trailing by one')
    expect(statePhrase(0)).toBe('level')
    expect(statePhrase(1)).toBe('leading by one')
    expect(statePhrase(3)).toBe('leading by three or more')
  })

  test('minuteLabel is football-first', () => {
    expect(minuteLabel(0)).toBe('Kickoff')
    expect(minuteLabel(70)).toBe('70th minute')
    expect(minuteLabel(69)).toBe('65th minute')
  })
})

describe('buildQuestion — the whole product in one sentence', () => {
  test('the classic comeback reads exactly as designed', () => {
    expect(buildQuestion({ gender: 'M', diff: -2, minute: 70 })).toBe(
      'How often does a team trailing by two at the 70th minute go on to win?'
    )
  })

  test('level and leading states read naturally', () => {
    expect(buildQuestion({ gender: 'M', diff: 0, minute: 45 })).toBe(
      'How often does a team level at the 45th minute go on to win?'
    )
    expect(buildQuestion({ gender: 'F', diff: 1, minute: 60 })).toBe(
      'How often does a team leading by one at the 60th minute go on to win?'
    )
  })

  test('kickoff and clamped 3+ deficits stay grammatical', () => {
    expect(buildQuestion({ gender: 'M', diff: 0, minute: 0 })).toBe(
      'How often does a team level at kickoff go on to win?'
    )
    expect(buildQuestion({ gender: 'M', diff: -3, minute: 80 })).toBe(
      'How often does a team trailing by three or more at the 80th minute go on to win?'
    )
  })
})

describe('URL <-> query', () => {
  test('parseQuery clamps and buckets deep-link params', () => {
    expect(parseQuery({ gender: 'F', diff: '-2', minute: '79' })).toEqual({
      gender: 'F',
      diff: -2,
      minute: 75,
    })
    expect(parseQuery({ gender: 'women', diff: '-9', minute: '200' })).toEqual({
      gender: 'F',
      diff: -3,
      minute: 90,
    })
  })

  test('parseQuery falls back to defaults for missing/garbage input', () => {
    expect(parseQuery({})).toEqual({ gender: 'M', diff: DEFAULT_DIFF, minute: DEFAULT_MINUTE })
    expect(parseQuery({ gender: 'x', diff: 'abc', minute: '' }, 'F')).toEqual({
      gender: 'F',
      diff: DEFAULT_DIFF,
      minute: DEFAULT_MINUTE,
    })
  })

  test('queryToSearch round-trips through parseQuery', () => {
    const q = { gender: 'F' as const, diff: -1, minute: 85 }
    const params = new URLSearchParams(queryToSearch(q))
    expect(parseQuery({
      gender: params.get('gender'),
      diff: params.get('diff'),
      minute: params.get('minute'),
    })).toEqual(q)
  })
})

describe('presets + grid invariants', () => {
  test('MINUTE_OPTIONS is the full 5-minute grid 0..90', () => {
    expect(MINUTE_OPTIONS[0]).toBe(0)
    expect(MINUTE_OPTIONS[MINUTE_OPTIONS.length - 1]).toBe(90)
    expect(MINUTE_OPTIONS).toHaveLength(19)
    MINUTE_OPTIONS.forEach((m) => expect(minuteBucket(m)).toBe(m))
  })

  test('every preset is already on the artifact grid (no hidden clamping)', () => {
    for (const preset of PRESETS) {
      const { gender, diff, minute } = preset.query
      expect(stateKey(preset.query)).toBe(`${gender}:${clampDiff(diff)}:${minuteBucket(minute)}`)
      expect(clampDiff(diff)).toBe(diff)
      expect(minuteBucket(minute)).toBe(minute)
    }
  })
})
