import fs from 'fs'
import path from 'path'

import { ESPN_SLUG, espnSlug, matchCard, resolveTie } from '@/lib/server/tieFixtures'

/**
 * Joining a bracket tie to the fixture behind it.
 *
 * `tournaments.json` carries no match id, so this is a NAME join — the thing
 * this project measured at 68.9% on the season snapshots, where it dropped the
 * rest silently and the sample merely looked small. Measured over 520 real ties
 * before the page was built: 76.7% on the pairing alone, 91.3% with ESPN's own
 * competition slugs, **99.2%** once one differing spelling is allowed on a
 * unique date.
 *
 * These pin the rules that got it there, and — more important — the two places
 * it must REFUSE. A bracket that opens the wrong match is worse than one that
 * opens nothing, because nothing announces itself.
 */

const ev = (id: string, date: string, a: string, b: string) => ({
  id,
  date: `${date}T19:00Z`,
  competitions: [{ competitors: [{ team: { displayName: a } }, { team: { displayName: b } }] }],
})

let urls: string[] = []

function mockEvents(events: unknown[], ok = true) {
  urls = []
  global.fetch = jest.fn().mockImplementation((url: string) => {
    urls.push(String(url))
    return Promise.resolve({ ok, json: async () => ({ events }) })
  }) as unknown as typeof fetch
}

const TIE = {
  competitionId: 'uefa.champions',
  kickoff: '2026-04-08',
  teamA: 'Arsenal',
  teamB: 'Real Madrid',
  twoLegged: false,
}

afterEach(() => jest.resetAllMocks())

describe('espnSlug', () => {
  it('translates the ids ESPN does not share with us', () => {
    // 0% of Conference League and Asian Cup ties resolved until this existed:
    // ESPN answers `afc.asian` with HTTP 400 and `uefa.conference` with silence.
    expect(espnSlug('uefa.conference')).toBe('uefa.europa.conf')
    expect(espnSlug('afc.asian')).toBe('afc.asian.cup')
  })

  it('leaves an id ESPN already agrees with alone', () => {
    expect(espnSlug('uefa.champions')).toBe('uefa.champions')
    expect(espnSlug('fifa.world')).toBe('fifa.world')
  })

  it('agrees with the ingester, which probed every slug live', () => {
    // `ingest_tournaments.py` is where these were verified against the real
    // scoreboard. Two copies of a mapping drift, and the drift is invisible:
    // the page just stops finding matches for one competition.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'backend', 'scripts', 'ingest_tournaments.py'),
      'utf8',
    )
    const pairs = [...src.matchAll(/Tournament\(\s*"([^"]+)",\s*"([^"]+)"/g)]
    expect(pairs.length).toBeGreaterThan(5)
    for (const [, espn, internal] of pairs) {
      expect([internal, espnSlug(internal)]).toEqual([internal, espn])
    }
  })

  it('names no competition ESPN already agrees with', () => {
    // An entry that maps an id to itself is noise that reads as a real quirk.
    for (const [from, to] of Object.entries(ESPN_SLUG)) expect(from).not.toBe(to)
  })
})

describe('resolveTie', () => {
  it('matches on both names and returns the event', async () => {
    mockEvents([ev('1', '2026-04-08', 'Arsenal', 'Real Madrid')])
    expect(await resolveTie(TIE)).toEqual({ eventIds: ['1'], how: 'both-names' })
  })

  it('asks ESPN under its own slug', async () => {
    mockEvents([ev('1', '2026-04-08', 'Arsenal', 'Real Madrid')])
    await resolveTie({ ...TIE, competitionId: 'uefa.conference' })
    expect(urls[0]).toContain('/uefa.europa.conf/scoreboard')
  })

  it('asks over a window wide enough for a second leg, with an explicit limit', async () => {
    // ESPN's scoreboard silently caps at 100 events — no error, no field
    // saying so — and a second leg lands up to three weeks after the first.
    mockEvents([ev('1', '2026-04-08', 'Arsenal', 'Real Madrid')])
    await resolveTie(TIE)
    expect(urls[0]).toContain('dates=20260407-20260429')
    expect(urls[0]).toContain('limit=')
  })

  it('survives a differing spelling when the date leaves one candidate', async () => {
    // Our warehouse says "Inter"; ESPN says "Internazionale". 42 of 520 ties
    // differ this way and every one of them is a real match.
    mockEvents([
      ev('9', '2026-04-08', 'Bayern Munich', 'Internazionale'),
      ev('10', '2026-04-15', 'Chelsea', 'Porto'),
    ])
    expect(
      await resolveTie({ ...TIE, teamA: 'Bayern Munich', teamB: 'Inter' }),
    ).toEqual({ eventIds: ['9'], how: 'one-name-and-date' })
  })

  it('refuses rather than choose between two candidates on the day', async () => {
    // "Inter" would also accept Inter Miami. Uniqueness is the whole guard.
    mockEvents([
      ev('9', '2026-04-08', 'Bayern Munich', 'Internazionale'),
      ev('11', '2026-04-08', 'Bayern Munich', 'Inter Miami'),
    ])
    expect(await resolveTie({ ...TIE, teamA: 'Bayern Munich', teamB: 'Inter' })).toBeNull()
  })

  it('refuses a rematch later in the same edition', async () => {
    // The AFCON group stage and its final are the same two teams. Anchoring
    // the first leg to the tie's own date is what keeps them apart.
    mockEvents([ev('7', '2026-04-25', 'Arsenal', 'Real Madrid')])
    expect(await resolveTie(TIE)).toBeNull()
  })

  it('returns both legs of a two-legged tie, in order', async () => {
    mockEvents([
      ev('22', '2026-04-15', 'Real Madrid', 'Arsenal'),
      ev('21', '2026-04-08', 'Arsenal', 'Real Madrid'),
    ])
    expect(await resolveTie({ ...TIE, twoLegged: true })).toEqual({
      eventIds: ['21', '22'],
      how: 'both-names',
    })
  })

  it('refuses a two-legged tie with only one leg on file', async () => {
    // A one-legged tie inside a two-legged round is a hole in the data, and
    // reading it as the whole tie names the wrong team about half the time.
    mockEvents([ev('21', '2026-04-08', 'Arsenal', 'Real Madrid')])
    expect(await resolveTie({ ...TIE, twoLegged: true })).toBeNull()
  })

  it('ignores an event that is not a pairing of two teams', async () => {
    mockEvents([
      { id: '3', date: '2026-04-08T19:00Z', competitions: [{ competitors: [] }] },
      ev('4', '2026-04-08', 'Arsenal', 'Real Madrid'),
    ])
    expect((await resolveTie(TIE))?.eventIds).toEqual(['4'])
  })

  it('matches through accents and club-name noise', async () => {
    // The crest normalisation, reused: "Bayern München" and "FC Bayern" are
    // the same club and neither is spelled the way our warehouse spells it.
    mockEvents([ev('5', '2026-04-08', 'FC Bayern München', 'Real Madrid CF')])
    expect(
      (await resolveTie({ ...TIE, teamA: 'Bayern Munchen', teamB: 'Real Madrid' }))?.eventIds,
    ).toEqual(['5'])
  })

  it('gives up quietly when ESPN is unreachable or empty', async () => {
    mockEvents([], false)
    expect(await resolveTie(TIE)).toBeNull()
    mockEvents([])
    expect(await resolveTie(TIE)).toBeNull()
  })

  it('refuses a kickoff it cannot read as a date', async () => {
    mockEvents([ev('1', '2026-04-08', 'Arsenal', 'Real Madrid')])
    expect(await resolveTie({ ...TIE, kickoff: 'TBC' })).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('matchCard', () => {
  const SUMMARY = {
    header: {
      competitions: [
        {
          date: '2026-04-08T19:00Z',
          status: { type: { state: 'post', detail: 'FT' } },
          competitors: [
            { id: '1', homeAway: 'home', score: '2', winner: true, team: { displayName: 'Arsenal', abbreviation: 'ARS' } },
            { id: '2', homeAway: 'away', score: '1', winner: false, team: { displayName: 'Real Madrid', abbreviation: 'RMA' } },
          ],
        },
      ],
    },
    gameInfo: { venue: { fullName: 'Emirates', address: { city: 'London' } }, attendance: 60000, officials: [{ displayName: 'A Referee' }] },
    keyEvents: [
      { id: 'k1', type: { type: 'kickoff' }, clock: { displayValue: '' } },
      { id: 'k2', type: { type: 'goal' }, clock: { displayValue: "12'" }, scoringPlay: true, team: { id: '1' }, participants: [{ athlete: { displayName: 'Saka' } }] },
      { id: 'k3', type: { type: 'halftime' }, clock: { displayValue: '' } },
      // ESPN files a delay pair per club for every drinks break and VAR check.
      { id: 'k4', type: { type: 'start-delay' }, clock: { displayValue: "25'" }, team: { id: '1' } },
      { id: 'k5', type: { type: 'end-delay' }, clock: { displayValue: "27'" }, team: { id: '1' } },
    ],
    commentary: [
      { sequence: 2, time: { displayValue: "12'" }, text: 'Goal' },
      { sequence: 1, time: { displayValue: "1'" }, text: 'Kick off' },
    ],
    boxscore: {
      teams: [
        { homeAway: 'home', statistics: [{ name: 'possessionPct', label: 'Possession', displayValue: '61%' }, { name: 'saves', label: 'Saves', displayValue: '3' }] },
        { homeAway: 'away', statistics: [{ name: 'possessionPct', label: 'Possession', displayValue: '39%' }] },
      ],
    },
    rosters: [
      {
        homeAway: 'home',
        formation: '4-3-3',
        team: { id: '1' },
        roster: [
          { starter: true, jersey: '1', formationPlace: '1', athlete: { id: 'p1', displayName: 'Raya' }, position: { abbreviation: 'G' } },
          { starter: false, jersey: '9', formationPlace: '0', subbedIn: true, athlete: { id: 'p2', displayName: 'Jesus' }, position: { abbreviation: 'SUB' } },
        ],
      },
    ],
    seasonseries: [
      {
        type: 'head-to-head',
        summary: 'ARS leads 2-0-1',
        events: [
          {
            id: 'h1',
            date: '2025-03-01T19:00Z',
            competitors: [
              { homeAway: 'home', winner: true, score: '3', team: { displayName: 'Arsenal' } },
              { homeAway: 'away', winner: false, score: '0', team: { displayName: 'Real Madrid' } },
            ],
          },
        ],
      },
    ],
    lastFiveGames: [
      {
        team: { id: '1', displayName: 'Arsenal' },
        events: [
          // ESPN nests the other club under `opponent`, as an object. This
          // fixture used to carry `awayTeamName`, a field the real payload
          // never sends, so the parser looked right and produced a blank
          // club for every game on both pages.
          {
            id: 'f1',
            gameDate: '2026-04-01T19:00Z',
            atVs: 'vs',
            score: '2-0',
            gameResult: 'W',
            homeTeamId: '1',
            opponent: { id: '2', displayName: 'Spurs' },
          },
          { id: 'f2', gameDate: '2026-03-25T19:00Z', score: '', gameResult: 'D', opponent: { displayName: 'Chelsea' } },
          // Scored, but ESPN named no opponent: a result next to nothing.
          { id: 'f3', gameDate: '2026-03-18T19:00Z', score: '1-1', gameResult: 'D' },
        ],
      },
    ],
  }

  const mockSummary = (body: unknown, ok = true) => {
    global.fetch = jest
      .fn()
      .mockImplementation(() => Promise.resolve({ ok, json: async () => body })) as unknown as typeof fetch
  }

  it('keeps incidents and drops the structural markers', async () => {
    // Kickoff and half-time are the shape of a match, not things that happened
    // in it, and a timeline that leads with "Kickoff" buries the goal.
    //
    // Delays are neither shape nor incident: ESPN files a start/end pair per
    // club for every drinks break and VAR check, and on the 2026 World Cup
    // final that was 20 of 43 rows — a timeline where nearly half the entries
    // read "Start Delay" and the winning goal was one line among them.
    mockSummary(SUMMARY)
    const card = (await matchCard('uefa.champions', '1'))!
    expect(card.events.map((e) => e.type)).toEqual(['goal'])
    expect(card.events[0].players).toEqual(['Saka'])
    expect(card.events[0].minute).toBe("12'")
  })

  it('pairs a statistic only when both sides published it', async () => {
    // ESPN gave the home side Saves and the away side none. Pairing that
    // against a zero invents a number for a team that reported nothing.
    mockSummary(SUMMARY)
    const card = (await matchCard('uefa.champions', '1'))!
    expect(card.stats.map((s) => s.name)).toEqual(['possessionPct'])
    expect(card.stats[0]).toMatchObject({ home: '61%', away: '39%', homeValue: 61, awayValue: 39 })
  })

  it('splits a team sheet into the eleven and the bench', async () => {
    mockSummary(SUMMARY)
    const card = (await matchCard('uefa.champions', '1'))!
    expect(card.lineups[0].formation).toBe('4-3-3')
    expect(card.lineups[0].starters.map((p) => p.jersey)).toEqual(['1'])
    expect(card.lineups[0].bench.map((p) => p.jersey)).toEqual(['9'])
    expect(card.lineups[0].bench[0].subbedIn).toBe(true)
  })

  it('reads commentary newest first', async () => {
    mockSummary(SUMMARY)
    const card = (await matchCard('uefa.champions', '1'))!
    expect(card.commentary.map((c) => c.sequence)).toEqual([2, 1])
  })

  it('carries the head-to-head and the form as published', async () => {
    mockSummary(SUMMARY)
    const card = (await matchCard('uefa.champions', '1'))!
    expect(card.headToHead?.summary).toBe('ARS leads 2-0-1')
    expect(card.headToHead?.meetings[0].home).toMatchObject({ name: 'Arsenal', score: '3' })
    // f2 has no score and f3 no opponent, and each on its own is a row with
    // nothing to say — a blank club beside a scoreline reads as a rendering
    // fault rather than as missing data.
    expect(card.form[0].games.map((g) => g.id)).toEqual(['f1'])
    expect(card.form[0].games[0].opponent).toBe('Spurs')
  })

  it('keeps the venue, the crowd and the referee', async () => {
    mockSummary(SUMMARY)
    const card = (await matchCard('uefa.champions', '1'))!
    expect(card.venue).toEqual({ name: 'Emirates', city: 'London', country: null })
    expect(card.attendance).toBe(60000)
    expect(card.officials).toEqual(['A Referee'])
  })

  it('returns null rather than a shell when the match has no two sides', async () => {
    mockSummary({ header: { competitions: [{ competitors: [] }] } })
    expect(await matchCard('uefa.champions', '1')).toBeNull()
    mockSummary({}, false)
    expect(await matchCard('uefa.champions', '1')).toBeNull()
  })
})
