import { changeComparison, comparisonFromArtifact, pointsPerGame } from '@/lib/teamComparison'

const club = { team: 'Arsenal', played: 5, points: 12, exp_points: 76.9 }
const artifact = { available: true, generated_at: '2026-10-06T14:27:31Z', method: { trained_through: '2026-10-02' }, leagues: [
  { competition_id: 'eng.1', season: 2026, table: [club, { ...club, team: 'Manchester City', points: 15 }] },
  { competition_id: 'usa.1', season: 2026, table: [{ ...club, team: 'Other club' }] },
] }

it('uses one competition and season without treating build/training dates as result dates', () => {
  const data = comparisonFromArtifact(artifact, 'eng.1')!
  expect(data.season).toBe(2026)
  expect(data.generatedAt).toBe(artifact.generated_at)
  expect(data.clubs.map((c) => c.team)).toEqual(['Arsenal', 'Manchester City'])
  expect(pointsPerGame(data.clubs[0])).toBe(2.4)
  expect(data).not.toHaveProperty('resultsThrough')
})

it.each([null, {}, { ...artifact, available: false }, { ...artifact, leagues: null },
  { ...artifact, leagues: [...artifact.leagues, artifact.leagues[0]] },
  { ...artifact, leagues: [{ ...artifact.leagues[0], season: '2026' }] },
])('withholds absent or ambiguous snapshot %p', (value) => {
  expect(comparisonFromArtifact(value, 'eng.1')).toBeNull()
})

it('withholds duplicate identities rather than double counting or guessing a correction', () => {
  const data = comparisonFromArtifact({ ...artifact, leagues: [{ ...artifact.leagues[0], table: [club, { ...club, team: ' ARSENAL ', points: 15 }, { ...club, team: 'City' }, null] }] }, 'eng.1')!
  expect(data.clubs.map((c) => c.team)).toEqual(['City'])
  expect(data.excluded).toBe(3)
})

it('keeps missing and malformed samples/metrics unavailable and genuine zero distinct', () => {
  const data = comparisonFromArtifact({ ...artifact, generated_at: null, leagues: [{ ...artifact.leagues[0], table: [
    { team: 'Before kickoff', played: 0, points: 0, exp_points: null },
    { team: 'Missing', played: null, points: '0', exp_points: NaN },
    { team: 'Malformed', played: -1, points: null },
    { team: 'No sample', played: 0, points: 10, exp_points: 0 },
  ] }] }, 'eng.1')!
  expect(data.generatedAt).toBeNull()
  expect(data.clubs[0]).toEqual({ team: 'Before kickoff', played: 0, points: 0, projectedPoints: null })
  expect(data.clubs.every((c) => pointsPerGame(c) === null)).toBe(true)
  expect(data.clubs.find((c) => c.team === 'Missing')?.points).toBeNull()
  expect(data.clubs.find((c) => c.team === 'No sample')?.points).toBeNull()
})

it('allows recorded deductions and rejects a projection below recorded points', () => {
  const data = comparisonFromArtifact({ ...artifact, leagues: [{ ...artifact.leagues[0], table: [
    { ...club, team: 'Deduction', points: -2 }, { ...club, exp_points: 2 },
  ] }] }, 'eng.1')!
  expect(data.clubs[0].projectedPoints).toBeNull()
  expect(pointsPerGame(data.clubs[1])).toBe(-0.4)
})

it('swaps collisions and keeps independent selections stable', () => {
  expect(changeComparison(['A', 'B'], 0, 'B')).toEqual(['B', 'A'])
  expect(changeComparison(['A', 'B'], 1, 'A')).toEqual(['B', 'A'])
  expect(changeComparison(['A', 'B'], 1, 'C')).toEqual(['A', 'C'])
})
