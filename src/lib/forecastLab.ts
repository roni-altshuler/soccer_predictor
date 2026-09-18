import type { FixtureForecast } from '@/components/forecast/FixtureCard'
import { isValidProbabilityTriple } from '@/lib/probabilityValidation'

export type LabFixture = FixtureForecast & { fixture_uid: string }
export type LabData = {
  available: boolean
  fixtures: LabFixture[]
  generatedAt: string | null
  trainedThrough: string | null
  modelVersion: string | null
  from: string
  through: string
  excluded: number
}

/** A published model output is data, not a trusted UI prop. */
export function validLabFixture(value: unknown): value is LabFixture {
  if (!value || typeof value !== 'object') return false
  const f = value as LabFixture
  const date = typeof f.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.date) &&
    !Number.isNaN(Date.parse(`${f.date}T12:00:00Z`))
  return Boolean(date && typeof f.fixture_uid === 'string' && /^[a-zA-Z0-9_-]+$/.test(f.fixture_uid) &&
    typeof f.competition_id === 'string' && /^[a-z0-9.]+$/.test(f.competition_id) &&
    typeof f.home === 'string' && f.home.trim() && typeof f.away === 'string' && f.away.trim() &&
    isValidProbabilityTriple({ home: f.p_home, draw: f.p_draw, away: f.p_away }) &&
    Math.abs(f.p_home + f.p_draw + f.p_away - 1) < 0.001 &&
    Number.isFinite(f.xg_home) && f.xg_home >= 0 && Number.isFinite(f.xg_away) && f.xg_away >= 0 &&
    Array.isArray(f.scorelines) && f.scorelines.every((s) =>
      typeof s.score === 'string' && /^\d+-\d+$/.test(s.score) && Number.isFinite(s.p) && s.p >= 0 && s.p <= 1) &&
    new Set(f.scorelines.map((s) => s.score)).size === f.scorelines.length &&
    f.scorelines.reduce((sum, s) => sum + s.p, 0) <= 1.001)
}

export function pointsScenario(f: LabFixture, outcome: 'H' | 'D' | 'A' | null) {
  const expected = [3 * f.p_home + f.p_draw, 3 * f.p_away + f.p_draw]
  const conditional = outcome === 'H' ? [3, 0] : outcome === 'D' ? [1, 1] : outcome === 'A' ? [0, 3] : expected
  return { expected, conditional, deltas: conditional.map((p, i) => p - expected[i]) }
}

export function labFromArtifact(artifact: unknown, now = new Date(), requested?: string): LabData {
  const from = now.toISOString().slice(0, 10)
  const through = new Date(now.getTime() + 28 * 86400000).toISOString().slice(0, 10)
  const empty: LabData = { available: false, fixtures: [], generatedAt: null, trainedThrough: null, modelVersion: null, from, through, excluded: 0 }
  if (!artifact || typeof artifact !== 'object') return empty
  const p = artifact as { fixtures?: unknown[]; generated_at?: string; method?: { model_version?: string; trained_through?: string } }
  if (!Array.isArray(p.fixtures) || !p.generated_at || Number.isNaN(Date.parse(p.generated_at))) return empty
  const valid = p.fixtures.filter(validLabFixture)
  const fixtures = valid.filter((f) => f.date >= from && (f.date <= through || f.fixture_uid === requested))
    .sort((a, b) => a.date.localeCompare(b.date) || a.fixture_uid.localeCompare(b.fixture_uid))
  return { ...empty, available: true, fixtures, excluded: p.fixtures.length - valid.length,
    generatedAt: p.generated_at, trainedThrough: p.method?.trained_through ?? null, modelVersion: p.method?.model_version ?? null }
}
