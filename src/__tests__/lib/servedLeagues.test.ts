/**
 * The directory must describe the product, not a past version of it.
 *
 * `/leagues` lists `SERVED_COMPETITION_IDS` and labels five of them as scored
 * against the closing line. Both claims are about what the backend actually
 * publishes, and neither is checked by anything at build time — the page
 * renders happily with a stale list, which is exactly how it came to advertise
 * MLS as "not covered yet" while `/season` was projecting MLS conference
 * tables.
 *
 * So the constant is pinned to the artifact `forecast_season.py` writes. A
 * league added to or removed from `LEAGUES` there fails here rather than
 * quietly going missing from, or lingering in, the directory.
 */
import { promises as fs } from 'fs'
import path from 'path'

import {
  SERVED_COMPETITION_IDS,
  WAVE_A_COMPETITION_IDS,
  getLeagueAccent,
} from '@/lib/leagueAccents'

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'predictions',
  'season_projections.json',
)

async function projectedIds(): Promise<string[]> {
  const parsed = JSON.parse(await fs.readFile(ARTIFACT, 'utf8'))
  return (parsed.leagues ?? []).map((l: { competition_id: string }) => l.competition_id)
}

describe('the served league list', () => {
  it('is exactly what the season forecast publishes', async () => {
    const projected = await projectedIds()
    expect([...SERVED_COMPETITION_IDS].sort()).toEqual([...projected].sort())
  })

  it('gives every served league a real badge and country', () => {
    for (const id of SERVED_COMPETITION_IDS) {
      const accent = getLeagueAccent(id)
      // The fallback accent is named 'Match' with no country. A served league
      // resolving to it means the directory renders a row with no identity.
      expect(accent.competitionId).toBe(id)
      expect(accent.country).not.toBe('')
    }
  })

  it('keeps the market-scored set a strict subset of the served set', () => {
    // Wave A is the benchmark corpus — leagues with a closing price on every
    // fixture. A league cannot be scored against the market without being
    // served, and conflating the two would promote four leagues into a claim
    // no measurement supports.
    for (const id of WAVE_A_COMPETITION_IDS) {
      expect(SERVED_COMPETITION_IDS).toContain(id)
    }
    expect(WAVE_A_COMPETITION_IDS.length).toBeLessThan(
      SERVED_COMPETITION_IDS.length,
    )
  })
})
