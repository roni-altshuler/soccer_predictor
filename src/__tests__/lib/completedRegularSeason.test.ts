import { readCompletedRegularSeason } from '@/lib/completedRegularSeason'
import { comparisonFromArtifact } from '@/lib/teamComparison'
import { completedArtifact } from '@/testFixtures/completedRegularSeason'

const context = { competitionId: 'usa.1', season: 2026, gender: 'M', now: new Date('2026-11-08T12:00:00Z') }

it('accepts a complete bounded observed record without deriving an overall rank or forecast', () => {
  const result = readCompletedRegularSeason(completedArtifact(), context)
  expect(result.kind).toBe('completed')
  if (result.kind !== 'completed') throw new Error('Expected completed season')
  expect(result.season.clubs).toHaveLength(30)
  expect(result.season.groups).toHaveLength(2)
  expect(result.season.observation.results_through).toBe('2026-11-07')
  expect(result.season.generatedAt).toBe('2026-11-08T10:00:00Z')
})

it.each([
  ['state alone', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observed_table = [] }],
  ['partial rows', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observed_table.pop() }],
  ['future observation', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.observed_at = '2026-11-09T09:00:00Z' }],
  ['future schedule proof', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.schedule_last_verified_at = '2026-11-09T09:00:00Z' }],
  ['timezone missing', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.observed_at = '2026-11-08T09:00:00' }],
  ['observation before completion', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.observed_at = '2026-11-07T23:59:00Z' }],
  ['build before observation', (data: ReturnType<typeof completedArtifact>) => { data.generated_at = '2026-11-08T08:00:00Z' }],
  ['early result cutoff', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.results_through = '2026-11-06' }],
  ['missing reconciliation time', (data: ReturnType<typeof completedArtifact>) => { Reflect.deleteProperty(data.leagues[0].observation, 'proof_checked_at') }],
  ['missing result kickoff', (data: ReturnType<typeof completedArtifact>) => { Reflect.deleteProperty(data.leagues[0].observation, 'latest_result_kickoff_at') }],
  ['reconciliation before observation', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.proof_checked_at = '2026-11-08T08:59:59Z' }],
  ['reconciliation after build', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.proof_checked_at = '2026-11-08T10:00:01Z' }],
  ['future reconciliation', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.proof_checked_at = '2026-11-08T12:00:01Z' }],
  ['reconciliation timezone missing', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.proof_checked_at = '2026-11-08T09:30:00' }],
  ['kickoff after observation', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.latest_result_kickoff_at = '2026-11-08T09:00:01Z' }],
  ['kickoff after reconciliation', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.latest_result_kickoff_at = '2026-11-08T09:30:01Z' }],
  ['future same-day kickoff', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.latest_result_kickoff_at = '2026-11-08T12:00:01Z' }],
  ['kickoff timezone missing', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.latest_result_kickoff_at = '2026-11-08T00:00:00' }],
  ['wrong year', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].season = 2025 }],
  ['wrong source scope', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.scope = 'playoffs' }],
  ['missing source endpoint', (data: ReturnType<typeof completedArtifact>) => { Reflect.deleteProperty(data.leagues[0].observation, 'endpoint') }],
  ['kickoff before the final reviewed dates', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.latest_result_kickoff_at = '2026-11-06T23:59:59Z' }],
  ['kickoff outside the reviewed dates in UTC', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.latest_result_kickoff_at = '2026-11-07T00:30:00+02:00' }],
  ['wrong source endpoint', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.endpoint += '&seasontype=3' }],
  ['incomplete reconciliation', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.matches_reconciled = 509 }],
  ['impossible result date', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.results_through = '2026-02-30' }],
  ['future result date', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observation.results_through = '2026-11-09' }],
  ['duplicate club', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observed_table[0].team_id = data.leagues[0].observed_table[1].team_id }],
  ['duplicate conference position', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observed_table[0].position = data.leagues[0].observed_table[1].position }],
  ['invalid match total', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observed_table[0].played = 33 }],
  ['invalid result totals', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observed_table[0].wins = 11 }],
  ['invalid points', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observed_table[0].points = 99 }],
  ['invalid qualification', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observed_table[0].qualified = true }],
  ['unknown conference', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observed_table[0].group = 'Combined' }],
  ['invalid goals', (data: ReturnType<typeof completedArtifact>) => { data.leagues[0].observed_table[0].gd = 5 }],
  ['forecast field', (data: ReturnType<typeof completedArtifact>) => { Object.assign(data.leagues[0].observed_table[0], { p_title: 1 }) }],
  ['expected-points field', (data: ReturnType<typeof completedArtifact>) => { Object.assign(data.leagues[0].observed_table[0], { exp_points: 44 }) }],
  ['duplicate league', (data: ReturnType<typeof completedArtifact>) => { data.leagues.push(data.leagues[0]) }],
])('fails closed for %s', (_name, mutate) => {
  const data = completedArtifact()
  mutate(data)
  expect(readCompletedRegularSeason(data, context)).toEqual({ kind: 'unavailable' })
  expect(comparisonFromArtifact(data, 'usa.1')).toBeNull()
})

it.each([{ gender: 'F' }, { season: 2025 }, { season: 2027 }, { competitionId: 'eng.1' }])('withholds observed data outside the bounded context %p', (overrides) => {
  expect(readCompletedRegularSeason(completedArtifact(), { ...context, ...overrides })).toEqual({ kind: 'outside_scope' })
})

it('preserves ordinary active and legacy forecast records', () => {
  const data = { leagues: [{ competition_id: 'usa.1', season: 2026, table: [{ team: 'Club', played: 20, points: 40, exp_points: 65 }] }] }
  expect(readCompletedRegularSeason(data, context)).toEqual({ kind: 'active' })
  expect(comparisonFromArtifact(data, 'usa.1')?.clubs[0].projectedPoints).toBe(65)
})

it('provides observed comparison values and conference positions with no projected values', () => {
  const data = comparisonFromArtifact(completedArtifact(), 'usa.1')!
  expect(data.completed).toBeDefined()
  expect(data.clubs).toHaveLength(30)
  expect(data.clubs[0]).toEqual({ team: 'East Club 01', played: 34, points: 44, projectedPoints: null, group: 'Eastern Conference', position: 1 })
  expect(data.clubs.every((club) => club.projectedPoints === null)).toBe(true)
})


it.each(['0', '00', '00100', '-1', '1.0'])('rejects noncanonical ESPN team ID %s', (teamId) => {
  const data = completedArtifact()
  data.leagues[0].observed_table[0].team_id = teamId
  expect(readCompletedRegularSeason(data, context)).toEqual({ kind: 'unavailable' })
})

it.each(['2026-11-07T23:00:00Z', '2026-11-08T00:00:00Z', '2026-11-07T23:30:00-02:00'])('accepts a final kickoff on the reviewed UTC dates: %s', (kickoff) => {
  const data = completedArtifact()
  data.leagues[0].observation.latest_result_kickoff_at = kickoff
  expect(readCompletedRegularSeason(data, context).kind).toBe('completed')
})

it.each(['points', 'wins', 'gd', 'gf'] as const)('rejects authoritative positions contradicting %s without relying on aggregate-stat errors', (field) => {
  const data = completedArtifact()
  const rows = data.leagues[0].observed_table
  const higher = rows.find((club) => club.group === 'Eastern Conference' && club.position === 2)!
  const lower = rows.find((club) => club.group === 'Eastern Conference' && club.position === 15)!
  if (field === 'points') {
    Object.assign(higher, { wins: 11, losses: 9, points: 47 })
    Object.assign(lower, { wins: 9, losses: 11, points: 41 })
  } else if (field === 'wins') {
    Object.assign(higher, { wins: 11, draws: 11, losses: 12 })
    Object.assign(lower, { wins: 9, draws: 17, losses: 8 })
  } else if (field === 'gd') {
    Object.assign(higher, { gf: 35, gd: 1 })
    Object.assign(lower, { gf: 33, gd: -1 })
  } else {
    Object.assign(higher, { gf: 35, ga: 35 })
    Object.assign(lower, { gf: 33, ga: 33 })
  }
  expect(rows.reduce((sum, club) => sum + club.wins - club.losses, 0)).toBe(0)
  expect(rows.reduce((sum, club) => sum + club.gf - club.ga, 0)).toBe(0)
  expect(rows.every((club) => club.wins + club.draws + club.losses === 34 && club.points === club.wins * 3 + club.draws)).toBe(true)
  expect(readCompletedRegularSeason(data, context)).toEqual({ kind: 'unavailable' })
})

it('preserves provider positions when the entire known tiebreak prefix is equal', () => {
  const data = completedArtifact()
  const result = readCompletedRegularSeason(data, context)
  expect(result.kind).toBe('completed')
  if (result.kind !== 'completed') throw new Error('Expected tied completed record')
  expect(result.season.clubs.map((club) => [club.team_id, club.group, club.position]))
    .toEqual(data.leagues[0].observed_table.map((club) => [club.team_id, club.group, club.position]))
})
