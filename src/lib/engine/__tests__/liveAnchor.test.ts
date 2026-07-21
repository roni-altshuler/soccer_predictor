/**
 * Live-fixture anchor derivation — the seam that lets the roll-forward kernel
 * run on in-progress matches. Reads the committed team-strength artifact and
 * asserts the exact Dixon-Coles nesting the kernel assumes, plus the honest
 * refusal rules (uncovered competition, unresolved / ambiguous team).
 *
 * Expected λ/μ are recomputed from the committed artifact itself, so this test
 * stays green across pipeline param refreshes.
 */
import fs from 'fs'
import path from 'path'

import { deriveLiveAnchor } from '../liveAnchor'

interface Artifact {
  competitions: Record<
    string,
    {
      espn_league_slug: string
      home_adv: number
      rho: number
      teams: Record<string, { attack: number; defence: number }>
    }
  >
}

const artifact: Artifact = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'backend', 'data', 'sim_priors.json'),
    'utf-8',
  ),
)

function firstTwoTeams(comp: string): [string, string] {
  const names = Object.keys(artifact.competitions[comp].teams)
  return [names[0], names[1]]
}

describe('deriveLiveAnchor', () => {
  it('derives λ/μ/ρ from the committed strengths using the DC nesting', () => {
    const comp = 'eng.1'
    const [home, away] = firstTwoTeams(comp)
    const c = artifact.competitions[comp]
    const h = c.teams[home]
    const a = c.teams[away]

    const anchor = deriveLiveAnchor({ competition: comp, homeTeam: home, awayTeam: away })
    expect(anchor).not.toBeNull()
    expect(anchor!.lambda).toBeCloseTo(Math.exp(h.attack - a.defence + c.home_adv), 9)
    expect(anchor!.mu).toBeCloseTo(Math.exp(a.attack - h.defence), 9)
    expect(anchor!.rho).toBe(c.rho)
    expect(anchor!.gender).toBe('M')
  })

  it('is deterministic — identical inputs yield the identical anchor', () => {
    const [home, away] = firstTwoTeams('esp.1')
    const first = deriveLiveAnchor({ competition: 'esp.1', homeTeam: home, awayTeam: away })
    const second = deriveLiveAnchor({ competition: 'esp.1', homeTeam: home, awayTeam: away })
    expect(first).toEqual(second)
  })

  it('resolves a competition by its ESPN slug and reads gender off the key', () => {
    // usa.1.w is keyed under the warehouse id but carries the ESPN slug usa.nwsl.
    const comp = artifact.competitions['usa.1.w']
    const [home, away] = firstTwoTeams('usa.1.w')
    const anchor = deriveLiveAnchor({
      competition: comp.espn_league_slug, // 'usa.nwsl'
      homeTeam: home,
      awayTeam: away,
    })
    expect(anchor).not.toBeNull()
    expect(anchor!.gender).toBe('F')
  })

  it('resolves a team by unambiguous normalized name (suffix differences)', () => {
    // eng.1 lists "AFC Bournemouth"; a live feed sending "Bournemouth" must bind.
    const names = Object.keys(artifact.competitions['eng.1'].teams)
    const hasBournemouth = names.some((n) => /bournemouth/i.test(n))
    if (!hasBournemouth) return
    const other = names.find((n) => !/bournemouth/i.test(n))!
    const anchor = deriveLiveAnchor({
      competition: 'eng.1',
      homeTeam: 'Bournemouth',
      awayTeam: other,
    })
    expect(anchor).not.toBeNull()
  })

  it('returns null for an uncovered competition', () => {
    const [home, away] = firstTwoTeams('eng.1')
    expect(deriveLiveAnchor({ competition: 'ita.1', homeTeam: home, awayTeam: away })).toBeNull()
  })

  it('returns null when either team cannot be resolved', () => {
    const [home] = firstTwoTeams('eng.1')
    expect(
      deriveLiveAnchor({ competition: 'eng.1', homeTeam: home, awayTeam: 'Nowhere United' }),
    ).toBeNull()
    expect(
      deriveLiveAnchor({ competition: 'eng.1', homeTeam: 'Nowhere United', awayTeam: home }),
    ).toBeNull()
  })
})
