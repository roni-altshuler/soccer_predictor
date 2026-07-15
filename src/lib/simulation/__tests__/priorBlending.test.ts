import fs from 'fs'
import path from 'path'

import {
  PRIOR_EVIDENCE_MATCHES,
  blendedPpg,
  runMonteCarloSimulation,
  runMonteCarloSimulationDetailed,
  type TeamData,
} from '@/lib/simulation/leagueMonteCarlo'
import {
  getLeaguePriorPpg,
  lookupPriorPpg,
  normalizeTeamName,
} from '@/lib/simulation/teamPriors'

/**
 * Tests for the historical-prior blending layer:
 *
 *   1. blendedPpg math — pre-season = pure prior, late season = mostly
 *      observed, no prior = bit-for-bit legacy behaviour
 *   2. Determinism — priors change inputs, never the seeded PRNG contract
 *   3. Pre-season differentiation — the headline fix: a 0-matches-played
 *      table with priors must separate strong from weak teams
 *   4. Honest fallback — teams without a prior behave exactly as before
 *   5. teamPriors loader — name lookup (exact + normalized) over the
 *      committed artifact, honest undefined/null for unknowns
 */

function team(
  name: string,
  points: number,
  matchesPlayed: number,
  priorPpg?: number,
): TeamData {
  return {
    name,
    points,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    matchesPlayed,
    ...(priorPpg !== undefined ? { priorPpg } : {}),
  }
}

describe('blendedPpg', () => {
  it('with no prior reproduces the legacy PPG exactly', () => {
    expect(blendedPpg(50, 25)).toBe(50 / 25)
    expect(blendedPpg(1, 38)).toBe(1 / 38)
    // Legacy neutral default before round 1.
    expect(blendedPpg(0, 0)).toBe(1.3)
    // Non-finite priors are ignored, not propagated.
    expect(blendedPpg(50, 25, NaN)).toBe(2)
    expect(blendedPpg(0, 0, Infinity)).toBe(1.3)
  })

  it('pre-season (0 played) returns exactly the prior', () => {
    expect(blendedPpg(0, 0, 2.31)).toBe(2.31)
    expect(blendedPpg(0, 0, 0.6)).toBe(0.6)
  })

  it('is the effective-sample-size blend of prior and observed', () => {
    const K = PRIOR_EVIDENCE_MATCHES
    // 6 played at 3.0 observed vs 1.0 prior.
    expect(blendedPpg(18, 6, 1.0)).toBeCloseTo((K * 1.0 + 18) / (K + 6), 12)
  })

  it('early season is mostly prior, late season mostly observed', () => {
    const prior = 2.4
    const observed = 0.5 // team collapsing vs its history
    const at = (n: number) => blendedPpg(observed * n, n, prior)
    // Weight on the prior = K / (K + n).
    const K = PRIOR_EVIDENCE_MATCHES
    expect(K / (K + 4)).toBeGreaterThan(0.7) // 4 rounds in: prior dominates
    expect(K / (K + 34)).toBeLessThan(0.3) // run-in: observed dominates
    expect(at(4)).toBeGreaterThan((prior + observed) / 2)
    expect(at(34)).toBeLessThan((prior + observed) / 2)
    // Monotone decay of the prior's pull as matches accumulate.
    expect(at(2)).toBeGreaterThan(at(10))
    expect(at(10)).toBeGreaterThan(at(30))
  })
})

describe('prior blending in the league Monte Carlo', () => {
  it('pre-season with priors differentiates strong vs weak (the headline fix)', () => {
    const preseason = [
      team('Strong', 0, 0, 2.2),
      team('Upper', 0, 0, 1.7),
      team('Lower', 0, 0, 1.2),
      team('Weak', 0, 0, 0.7),
    ]
    const result = runMonteCarloSimulation(preseason, 38, 3000, 47, null, null)
    const by = (n: string) => result.find((t) => t.team_name === n)!
    expect(by('Strong').title_probability).toBeGreaterThan(
      by('Upper').title_probability,
    )
    expect(by('Upper').title_probability).toBeGreaterThan(
      by('Lower').title_probability,
    )
    expect(by('Lower').title_probability).toBeGreaterThan(
      by('Weak').title_probability,
    )
    // Not a coin flip: the favourite must clearly separate from the weakest.
    expect(by('Strong').title_probability).toBeGreaterThan(0.5)
    expect(by('Weak').title_probability).toBeLessThan(0.05)
    // And relegation risk runs the other way.
    expect(by('Weak').relegation_probability).toBeGreaterThan(
      by('Strong').relegation_probability,
    )
  })

  it('pre-season WITHOUT priors stays flat (documents the old behaviour)', () => {
    const preseason = [
      team('A', 0, 0),
      team('B', 0, 0),
      team('C', 0, 0),
      team('D', 0, 0),
    ]
    const result = runMonteCarloSimulation(preseason, 38, 3000, 47, null, null)
    for (const t of result) {
      // Everyone hovers around 1/4 title probability — no information.
      expect(t.title_probability).toBeGreaterThan(0.15)
      expect(t.title_probability).toBeLessThan(0.35)
    }
  })

  it('is deterministic with priors: identical inputs → identical outputs', () => {
    const teams = [
      team('Strong', 12, 6, 2.2),
      team('Mid', 8, 6, 1.4),
      team('Weak', 3, 6, 0.8),
    ]
    const a = runMonteCarloSimulationDetailed(teams, 38, 1500, 47, null, null, {
      sampleUniverses: 8,
    })
    const b = runMonteCarloSimulationDetailed(teams, 38, 1500, 47, null, null, {
      sampleUniverses: 8,
    })
    expect(a.standings).toEqual(b.standings)
    expect(a.sampled_universes).toEqual(b.sampled_universes)
  })

  it('teams with no prior are bit-for-bit unchanged (zero behaviour change)', () => {
    const bare = [team('A', 40, 20), team('B', 30, 20), team('C', 20, 20)]
    const explicitUndefined = bare.map((t) => ({ ...t, priorPpg: undefined }))
    // A prior equal to the observed PPG blends to the identical strength too.
    const selfPrior = bare.map((t) => ({
      ...t,
      priorPpg: t.points / t.matchesPlayed,
    }))
    const base = runMonteCarloSimulation(bare, 38, 1000, 47, null, null)
    expect(
      runMonteCarloSimulation(explicitUndefined, 38, 1000, 47, null, null),
    ).toEqual(base)
    expect(
      runMonteCarloSimulation(selfPrior, 38, 1000, 47, null, null),
    ).toEqual(base)
  })

  it('mixed rosters: a no-prior team sits between strong and weak priors pre-season', () => {
    const preseason = [
      team('Strong', 0, 0, 2.2),
      team('NoPrior', 0, 0), // falls back to the 1.3 neutral default
      team('Weak', 0, 0, 0.7),
    ]
    const result = runMonteCarloSimulation(preseason, 38, 3000, 47, null, null)
    const by = (n: string) => result.find((t) => t.team_name === n)!
    expect(by('Strong').title_probability).toBeGreaterThan(
      by('NoPrior').title_probability,
    )
    expect(by('NoPrior').title_probability).toBeGreaterThan(
      by('Weak').title_probability,
    )
  })

  it('late-season observed form outweighs a contradicting prior', () => {
    // Overachiever: weak history, storming the actual season (2.6 PPG over 30).
    // Underachiever: strong history, terrible actual season (0.6 PPG over 30).
    const teams = [
      team('Overachiever', 78, 30, 0.8),
      team('Underachiever', 18, 30, 2.3),
    ]
    const result = runMonteCarloSimulation(teams, 38, 2000, 47, null, null)
    const by = (n: string) => result.find((t) => t.team_name === n)!
    expect(by('Overachiever').title_probability).toBeGreaterThan(0.9)
    expect(by('Underachiever').title_probability).toBeLessThan(0.1)
  })
})

describe('teamPriors loader (committed artifact)', () => {
  const artifactPath = path.join(
    process.cwd(),
    'backend',
    'data',
    'sim_priors.json',
  )
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8')) as {
    schema: number
    competitions: Record<
      string,
      {
        teams: Record<string, { prior_ppg: number }>
        unmatched_frontend_teams: string[]
      }
    >
  }
  const [compId, comp] = Object.entries(artifact.competitions)[0]

  it('normalizeTeamName mirrors the artifact builder', () => {
    expect(normalizeTeamName('AFC Bournemouth')).toBe('bournemouth')
    expect(normalizeTeamName('Alavés')).toBe('alaves')
    expect(normalizeTeamName('Brighton & Hove Albion')).toBe(
      'brighton and hove albion',
    )
    expect(normalizeTeamName('San Diego Wave FC')).toBe('san diego wave')
    expect(normalizeTeamName('NJ/NY Gotham FC')).toBe('nj ny gotham')
  })

  it('serves every artifact team by exact and normalized name', () => {
    const priors = getLeaguePriorPpg(compId)
    expect(priors).not.toBeNull()
    for (const [name, entry] of Object.entries(comp.teams)) {
      expect(lookupPriorPpg(priors, name)).toBe(entry.prior_ppg)
      // Round-trip through a cosmetic respelling (suffix + case noise).
      expect(lookupPriorPpg(priors, `${name.toUpperCase()} FC`)).toBe(
        entry.prior_ppg,
      )
      expect(entry.prior_ppg).toBeGreaterThan(0)
      expect(entry.prior_ppg).toBeLessThan(3)
    }
  })

  it('returns undefined for unmatched frontend teams (honest fallback)', () => {
    const priors = getLeaguePriorPpg(compId)
    for (const name of comp.unmatched_frontend_teams) {
      expect(lookupPriorPpg(priors, name)).toBeUndefined()
    }
    expect(lookupPriorPpg(priors, 'Nonexistent Wanderers XI')).toBeUndefined()
  })

  it('returns null for unknown competitions and tolerates null maps', () => {
    expect(getLeaguePriorPpg('xx.99')).toBeNull()
    expect(lookupPriorPpg(null, 'Arsenal')).toBeUndefined()
  })
})
