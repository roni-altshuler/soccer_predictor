import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

/**
 * What moved the projection, and what may be said about why.
 *
 * A season projection moves for three reasons and only two of them are news:
 * a club played, a rival played, or the model retrained overnight. The third
 * looks identical to the first in the numbers and is not a fact about football
 * at all, so these tests are mostly about refusing to narrate it.
 */

let dir: string
let cwd: jest.SpyInstance

const A = '2026-08-15T07:57:18.351161+00:00'
const B = '2026-08-16T07:58:42.647451+00:00'

const row = (over: Record<string, unknown>) => ({
  generated_at: A,
  competition_id: 'esp.1',
  season: 2026,
  team: 'Barcelona',
  played: 0,
  points: 0,
  p_title: 0.4,
  p_top_cut: 0.9,
  p_relegated: 0.0,
  ...over,
})

async function write(rows: unknown[]) {
  await fs.writeFile(
    path.join(dir, 'backend', 'data', 'predictions', 'projection_history.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  )
}

async function load() {
  let mod!: typeof import('@/lib/server/projectionHistory')
  await jest.isolateModulesAsync(async () => {
    mod = await import('@/lib/server/projectionHistory')
  })
  return mod
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'projhist-'))
  await fs.mkdir(path.join(dir, 'backend', 'data', 'predictions'), { recursive: true })
  cwd = jest.spyOn(process, 'cwd').mockReturnValue(dir)
})

afterEach(async () => {
  cwd.mockRestore()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('projectionMovement', () => {
  it('refuses to report movement when no football was played', async () => {
    // THE test. The model retrains nightly, so two snapshots over a quiet day
    // differ for reasons that have nothing to do with any team. Rendering that
    // as "Barcelona's title chance fell" would be inventing a result.
    await write([
      row({ generated_at: A, played: 0, p_title: 0.4 }),
      row({ generated_at: B, played: 0, p_title: 0.31 }),
    ])
    const { projectionMovement } = await load()
    expect(await projectionMovement('esp.1')).toBeNull()
  })

  it('reports movement when a match was actually played', async () => {
    await write([
      row({ generated_at: A, played: 0, p_title: 0.4 }),
      row({ generated_at: B, played: 1, p_title: 0.52 }),
    ])
    const { projectionMovement } = await load()
    const m = (await projectionMovement('esp.1'))!
    expect(m.matchesPlayed).toBe(1)
    expect(m.moves[0]).toMatchObject({ team: 'Barcelona', figure: 'p_title', movedBy: 'own-result' })
    expect(m.moves[0].delta).toBeCloseTo(0.12, 5)
  })

  it('separates a club moved by its OWN result from one moved by others', async () => {
    // The distinction a naive version loses. Measured 2026-08-16: of the four
    // biggest esp.1 movers, two had played nothing — showing them under one
    // heading credits a club for a Saturday it spent at home.
    await write([
      row({ generated_at: A, team: 'Alavés', played: 0, p_title: 0.02 }),
      row({ generated_at: B, team: 'Alavés', played: 1, p_title: 0.05 }),
      row({ generated_at: A, team: 'Barcelona', played: 0, p_title: 0.40 }),
      row({ generated_at: B, team: 'Barcelona', played: 0, p_title: 0.36 }),
    ])
    const { projectionMovement } = await load()
    const m = (await projectionMovement('esp.1'))!
    const by = Object.fromEntries(m.moves.map((x) => [x.team, x.movedBy]))
    expect(by['Alavés']).toBe('own-result')
    expect(by['Barcelona']).toBe('other-results')
  })

  it('does not report one number twice under two names', async () => {
    // MLS's `top_cut_label` is "Supporters' Shield", so `p_top_cut` IS
    // `p_title`. Rendered raw, Nashville appeared twice with identical
    // figures, reading as two independent findings instead of one.
    await write([
      row({ generated_at: A, team: 'Nashville SC', played: 18, p_title: 0.2212, p_top_cut: 0.2212 }),
      row({ generated_at: B, team: 'Nashville SC', played: 19, p_title: 0.384, p_top_cut: 0.384 }),
    ])
    const { projectionMovement } = await load()
    const m = (await projectionMovement('esp.1'))!
    expect(m.moves).toHaveLength(1)
    // The primary name survives, not the alias.
    expect(m.moves[0].figure).toBe('p_title')
  })

  it('still reports two figures that genuinely differ', async () => {
    await write([
      row({ generated_at: A, played: 0, p_title: 0.20, p_top_cut: 0.60 }),
      row({ generated_at: B, played: 1, p_title: 0.30, p_top_cut: 0.75 }),
    ])
    const { projectionMovement } = await load()
    const m = (await projectionMovement('esp.1'))!
    expect(m.moves.map((x) => x.figure).sort()).toEqual(['p_title', 'p_top_cut'])
  })

  it('says nothing at all from a single recorded forecast', async () => {
    // One snapshot is a number, not a movement.
    await write([row({ generated_at: A, played: 1 })])
    const { projectionMovement } = await load()
    expect(await projectionMovement('esp.1')).toBeNull()
  })

  it('compares the two most recent forecasts, not the first and last', async () => {
    const C = '2026-08-17T07:00:00+00:00'
    await write([
      row({ generated_at: A, played: 0, p_title: 0.10 }),
      row({ generated_at: B, played: 1, p_title: 0.40 }),
      row({ generated_at: C, played: 2, p_title: 0.45 }),
    ])
    const { projectionMovement } = await load()
    const m = (await projectionMovement('esp.1'))!
    expect(m.from).toBe(B)
    expect(m.to).toBe(C)
    expect(m.moves[0].delta).toBeCloseTo(0.05, 5)
  })

  it('ignores noise below the threshold', async () => {
    await write([
      row({ generated_at: A, team: 'Alavés', played: 0, p_title: 0.2000 }),
      row({ generated_at: B, team: 'Alavés', played: 1, p_title: 0.2004 }),
    ])
    const { projectionMovement } = await load()
    const m = await projectionMovement('esp.1')
    // A match was played, so there IS movement to report — but nothing in it
    // clears the threshold, so there are no rows.
    expect(m?.moves ?? []).toHaveLength(0)
  })

  it('keeps competitions apart', async () => {
    await write([
      row({ generated_at: A, competition_id: 'esp.1', played: 0, p_title: 0.4 }),
      row({ generated_at: B, competition_id: 'esp.1', played: 0, p_title: 0.4 }),
      row({ generated_at: A, competition_id: 'usa.1', team: 'Nashville', played: 18, p_title: 0.10 }),
      row({ generated_at: B, competition_id: 'usa.1', team: 'Nashville', played: 19, p_title: 0.26 }),
    ])
    const { projectionMovement } = await load()
    expect(await projectionMovement('esp.1')).toBeNull()
    const usa = (await projectionMovement('usa.1'))!
    expect(usa.moves[0].delta).toBeCloseTo(0.16, 5)
  })

  it('survives a half-written line without losing the file', async () => {
    const p = path.join(dir, 'backend', 'data', 'predictions', 'projection_history.jsonl')
    await fs.writeFile(
      p,
      JSON.stringify(row({ generated_at: A, played: 0, p_title: 0.4 })) +
        '\n{ broken\n' +
        JSON.stringify(row({ generated_at: B, played: 1, p_title: 0.5 })) +
        '\n',
      'utf8',
    )
    const { projectionMovement } = await load()
    expect((await projectionMovement('esp.1'))!.moves).toHaveLength(1)
  })

  it('has nothing to say when the history does not exist yet', async () => {
    const { projectionMovement } = await load()
    expect(await projectionMovement('esp.1')).toBeNull()
  })
})
