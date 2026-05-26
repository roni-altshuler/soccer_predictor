/**
 * Lightweight health check helpers used by /api/health.
 *
 * Each helper is defensive: it MUST resolve (never throw) and MUST honour a
 * caller-supplied timeout. The result shape is intentionally simple so the
 * route handler can compose it into an aggregate payload without further
 * massaging.
 *
 * Where possible we reuse infrastructure already wired up in
 * src/lib/serverSyncStore.ts (the Postgres pool used by /api/bracket-rooms)
 * so we don't open a second connection pool just for health probes.
 */
import fs from 'fs/promises'
import path from 'path'

// Reuse the same DATABASE_URL discovery + pooled client used by bracket-rooms.
// We import lazily inside the helper so the bundle stays slim when /api/health
// is the only thing being rendered.
type PgPoolLike = {
  query: (text: string) => Promise<unknown>
}

type GlobalWithPg = typeof globalThis & {
  __fotpredictPgPool?: PgPoolLike
}

const DATA_DIR = path.join(process.cwd(), 'backend', 'data')
const MODELS_DIR = path.join(DATA_DIR, 'models')
const PREDICTIONS_DIR = path.join(DATA_DIR, 'predictions')

export interface CheckOk {
  ok: true
  [key: string]: unknown
}

export interface CheckFail {
  ok: false
  error: string
  [key: string]: unknown
}

export type CheckResult = CheckOk | CheckFail

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function shortError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 200)
  return fallback
}

/**
 * Postgres `SELECT 1` probe with a hard timeout. We deliberately go through the
 * cached global pool created by serverSyncStore.ts so we don't open a parallel
 * pool (which would leak connections during hot reload). If the pool hasn't
 * been initialised yet (e.g. first request after boot) we ask serverSyncStore
 * to spin it up via its existing path.
 */
export async function checkDatabase(timeoutMs = 1000): Promise<CheckResult> {
  const startedAt = Date.now()
  try {
    const hasUrl = Boolean(
      process.env.DATABASE_URL ||
        process.env.POSTGRES_URL ||
        process.env.POSTGRES_PRISMA_URL ||
        process.env.POSTGRES_URL_NON_POOLING,
    )
    if (!hasUrl) {
      return {
        ok: false,
        error: 'no DATABASE_URL configured',
        latency_ms: Date.now() - startedAt,
      }
    }

    // Touch serverSyncStore so its global pool gets initialised once and is
    // shared with /api/bracket-rooms. We don't await its schema creation here
    // because that's a heavier check; serverSyncStore caches its own schema
    // bootstrap promise on globalThis.
    await import('@/lib/serverSyncStore')
    const pool = (globalThis as GlobalWithPg).__fotpredictPgPool
    if (!pool) {
      return {
        ok: false,
        error: 'postgres pool not initialised',
        latency_ms: Date.now() - startedAt,
      }
    }

    await withTimeout(pool.query('SELECT 1') as Promise<unknown>, timeoutMs, 'db')
    return { ok: true, latency_ms: Date.now() - startedAt }
  } catch (error) {
    return {
      ok: false,
      error: shortError(error, 'db check failed'),
      latency_ms: Date.now() - startedAt,
    }
  }
}

/**
 * Count subdirectories under backend/data/models. The training pipeline emits
 * one folder per league/competition, so a healthy installation has >= 10.
 */
export async function checkModelArtifacts(minCount = 10): Promise<CheckResult> {
  try {
    const entries = await fs.readdir(MODELS_DIR, { withFileTypes: true })
    const count = entries.filter((entry) => entry.isDirectory()).length
    if (count < minCount) {
      return { ok: false, error: `only ${count} model directories (need >= ${minCount})`, count }
    }
    return { ok: true, count }
  } catch (error) {
    return { ok: false, error: shortError(error, 'model artifact scan failed') }
  }
}

/**
 * Walk backend/data/predictions and return the freshness of the newest file.
 * The site is "degraded" if the latest predictions file is older than `maxAgeHours`.
 */
export async function checkPredictionsFreshness(maxAgeHours = 8): Promise<CheckResult> {
  try {
    const entries = await fs.readdir(PREDICTIONS_DIR, { withFileTypes: true })
    let newest = 0
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const stat = await fs.stat(path.join(PREDICTIONS_DIR, entry.name))
      if (stat.mtimeMs > newest) newest = stat.mtimeMs
    }
    if (newest === 0) {
      return { ok: false, error: 'no prediction files found' }
    }
    const ageHours = (Date.now() - newest) / 36e5
    const lastUpdated = new Date(newest).toISOString()
    if (ageHours >= maxAgeHours) {
      return {
        ok: false,
        error: `predictions ${ageHours.toFixed(1)}h old (max ${maxAgeHours}h)`,
        last_updated: lastUpdated,
        age_hours: Number(ageHours.toFixed(2)),
      }
    }
    return {
      ok: true,
      last_updated: lastUpdated,
      age_hours: Number(ageHours.toFixed(2)),
    }
  } catch (error) {
    return { ok: false, error: shortError(error, 'predictions freshness check failed') }
  }
}

/**
 * Probe the FastAPI backend with a short GET. We use /api/v1/leagues/ — it's a
 * cheap router-level handler that doesn't fan out to model code.
 */
export async function checkFastApiBackend(timeoutMs = 1500): Promise<CheckResult> {
  const startedAt = Date.now()
  const baseUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000'
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/leagues/`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })
    const latency = Date.now() - startedAt
    if (!response.ok) {
      return { ok: false, error: `backend returned ${response.status}`, latency_ms: latency }
    }
    return { ok: true, latency_ms: latency }
  } catch (error) {
    return {
      ok: false,
      error: shortError(error, 'backend unreachable'),
      latency_ms: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timer)
  }
}

export function resolveVersion(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)
  if (process.env.GIT_SHA) return process.env.GIT_SHA.slice(0, 12)
  if (process.env.npm_package_version) return process.env.npm_package_version
  return '0.1.0'
}
