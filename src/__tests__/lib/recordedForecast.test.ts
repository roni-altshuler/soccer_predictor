import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

/**
 * The forecast on file, and whether it may be shown beside a result.
 *
 * The panel this feeds makes one claim — "we said this, first" — and the claim
 * is worth nothing unless the ordering is provable from the record. So the
 * tests that matter here are the refusals: no row, no panel; no timestamp, no
 * timing claim; a stamp after kickoff is reported as such rather than quietly
 * counted.
 */

let dir: string
let cwd: jest.SpyInstance

const row = (over: Record<string, unknown> = {}) => ({
  match_id: '401879301',
  league: 'Premier League',
  home_team: 'Arsenal',
  away_team: 'Fulham',
  predicted_home_win: 0.62,
  predicted_draw: 0.22,
  predicted_away_win: 0.16,
  prediction_timestamp: '2026-05-01T09:00:00+00:00',
  actual_winner: 'home',
  actual_home_goals: 3,
  actual_away_goals: 0,
  ...over,
})

const KICKOFF = '2026-05-02T16:30Z'

async function write(name: string, rows: unknown[]) {
  await fs.writeFile(
    path.join(dir, 'backend', 'data', 'predictions', name),
    JSON.stringify({ month: name, count: rows.length, predictions: rows }),
    'utf8',
  )
}

/** Fresh module per test: the index caches on file mtime. */
async function load() {
  let mod!: typeof import('@/lib/server/recordedForecast')
  await jest.isolateModulesAsync(async () => {
    mod = await import('@/lib/server/recordedForecast')
  })
  return mod
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recorded-'))
  await fs.mkdir(path.join(dir, 'backend', 'data', 'predictions'), { recursive: true })
  cwd = jest.spyOn(process, 'cwd').mockReturnValue(dir)
})

afterEach(async () => {
  cwd.mockRestore()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('recordedForecast', () => {
  it('returns the forecast and scores it against the result', async () => {
    await write('predictions_2026-05.json', [row()])
    const { recordedForecast } = await load()
    const got = (await recordedForecast('401879301', KICKOFF))!

    expect(got.p).toEqual([0.62, 0.22, 0.16])
    expect(got.outcome).toBe('home')
    expect(got.calledIt).toBe(true)
    expect(got.pActual).toBeCloseTo(0.62, 5)
    // Summed over three outcomes — the scale every number in CLAUDE.md uses.
    expect(got.brier).toBeCloseTo(0.38 ** 2 + 0.22 ** 2 + 0.16 ** 2, 6)
  })

  it('marks a forecast that did not call it, without hiding it', async () => {
    await write('predictions_2026-05.json', [row({ actual_winner: 'away' })])
    const { recordedForecast } = await load()
    const got = (await recordedForecast('401879301', KICKOFF))!
    expect(got.calledIt).toBe(false)
    expect(got.pActual).toBeCloseTo(0.16, 5)
  })

  it('proves the forecast predates kickoff, in hours', async () => {
    await write('predictions_2026-05.json', [row()])
    const { recordedForecast } = await load()
    const got = (await recordedForecast('401879301', KICKOFF))!
    expect(got.beforeKickoff).toBe(true)
    expect(got.hoursBeforeKickoff).toBeCloseTo(31.5, 1)
  })

  it('reports a stamp AFTER kickoff as such rather than swallowing it', async () => {
    // The panel refuses to draw on this. Returning null here instead would
    // hide the fact that a post-hoc number exists in the record at all.
    await write('predictions_2026-05.json', [
      row({ prediction_timestamp: '2026-05-02T18:00:00+00:00' }),
    ])
    const { recordedForecast } = await load()
    const got = (await recordedForecast('401879301', KICKOFF))!
    expect(got.beforeKickoff).toBe(false)
  })

  it('claims nothing about timing when it cannot', async () => {
    await write('predictions_2026-05.json', [row({ prediction_timestamp: '' })])
    const { recordedForecast } = await load()
    const got = (await recordedForecast('401879301', KICKOFF))!
    expect(got.beforeKickoff).toBeNull()
    expect(got.hoursBeforeKickoff).toBeNull()
  })

  it('leaves an unplayed fixture unscored rather than scoring it as a loss', async () => {
    await write('predictions_2026-05.json', [row({ actual_winner: null })])
    const { recordedForecast } = await load()
    const got = (await recordedForecast('401879301', KICKOFF))!
    expect(got.outcome).toBeNull()
    expect(got.brier).toBeNull()
    expect(got.calledIt).toBeNull()
    expect(got.pActual).toBeNull()
  })

  it('has nothing to say about a fixture it never forecast', async () => {
    await write('predictions_2026-05.json', [row()])
    const { recordedForecast } = await load()
    expect(await recordedForecast('999999', KICKOFF)).toBeNull()
  })

  it('refuses a row whose probabilities are unusable', async () => {
    await write('predictions_2026-05.json', [row({ predicted_draw: null })])
    const { recordedForecast } = await load()
    expect(await recordedForecast('401879301', KICKOFF)).toBeNull()
  })

  it('takes the later month when a fixture was forecast twice', async () => {
    // The later file is the one that was served.
    await write('predictions_2026-04.json', [row({ predicted_home_win: 0.1, predicted_draw: 0.1, predicted_away_win: 0.8 })])
    await write('predictions_2026-05.json', [row()])
    const { recordedForecast } = await load()
    const got = (await recordedForecast('401879301', KICKOFF))!
    expect(got.p[0]).toBeCloseTo(0.62, 5)
  })

  it('survives a corrupt month without losing the others', async () => {
    await fs.writeFile(
      path.join(dir, 'backend', 'data', 'predictions', 'predictions_2026-04.json'),
      '{ broken',
      'utf8',
    )
    await write('predictions_2026-05.json', [row()])
    const { recordedForecast } = await load()
    expect(await recordedForecast('401879301', KICKOFF)).not.toBeNull()
  })

  it('renormalises a triple that drifted off 1', async () => {
    await write('predictions_2026-05.json', [
      row({ predicted_home_win: 1.24, predicted_draw: 0.44, predicted_away_win: 0.32 }),
    ])
    const { recordedForecast } = await load()
    const got = (await recordedForecast('401879301', KICKOFF))!
    expect(got.p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    expect(got.p[0]).toBeCloseTo(0.62, 5)
  })
})
