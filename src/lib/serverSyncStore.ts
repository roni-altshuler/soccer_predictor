import fs from 'fs'
import os from 'os'
import path from 'path'
import { Pool } from 'pg'

export interface BracketRoomRecord {
  roomCode: string
  ownerPinHash: string
  createdAt: string
  updatedAt: string
  lastSyncedBy: string
  group: unknown
}

export interface WatchlistAlertRoomRecord {
  syncCode: string
  createdAt: string
  updatedAt: string
  sourceDevice: string
  trackedTeams: unknown[]
  settings: unknown
  alerts: unknown[]
}

type BracketRoomStore = {
  rooms: Record<string, BracketRoomRecord>
}

type WatchlistAlertStore = {
  rooms: Record<string, WatchlistAlertRoomRecord>
}

type GlobalWithPg = typeof globalThis & {
  __fotpredictPgPool?: Pool
  __fotpredictPgSchemaReady?: Promise<void>
}

const STORE_DIR = process.env.FOTPREDICT_STORE_DIR || path.join(os.tmpdir(), 'fotpredict-server-store')
const BRACKET_STORE_FILE = 'bracket-rooms.json'
const ALERT_STORE_FILE = 'watchlist-alerts.json'

function databaseUrl(): string | null {
  return process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    null
}

function hasManagedPostgres(): boolean {
  return Boolean(databaseUrl())
}

function ensureStoreDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true })
  }
}

function storePath(fileName: string): string {
  ensureStoreDir()
  return path.join(STORE_DIR, fileName)
}

function readJsonStore<T>(fileName: string, fallback: T): T {
  const filePath = storePath(fileName)
  if (!fs.existsSync(filePath)) return fallback

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJsonStore<T>(fileName: string, value: T): void {
  const filePath = storePath(fileName)
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2))
  fs.renameSync(tempPath, filePath)
}

function getPool(): Pool {
  const url = databaseUrl()
  if (!url) {
    throw new Error('DATABASE_URL or POSTGRES_URL is required for managed Postgres storage.')
  }

  const globalRef = globalThis as GlobalWithPg
  if (!globalRef.__fotpredictPgPool) {
    const needsSsl = !url.includes('localhost') &&
      !url.includes('127.0.0.1') &&
      process.env.PGSSLMODE !== 'disable'

    globalRef.__fotpredictPgPool = new Pool({
      connectionString: url,
      max: Number(process.env.PGPOOL_MAX || 3),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
    })
  }

  return globalRef.__fotpredictPgPool
}

async function ensureSchema(): Promise<void> {
  if (!hasManagedPostgres()) return

  const globalRef = globalThis as GlobalWithPg
  if (!globalRef.__fotpredictPgSchemaReady) {
    globalRef.__fotpredictPgSchemaReady = (async () => {
      const pool = getPool()
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fotpredict_bracket_rooms (
          room_code TEXT PRIMARY KEY,
          owner_pin_hash TEXT NOT NULL,
          group_payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_synced_by TEXT NOT NULL DEFAULT 'Commissioner'
        );
      `)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fotpredict_watchlist_alert_rooms (
          sync_code TEXT PRIMARY KEY,
          tracked_teams JSONB NOT NULL DEFAULT '[]'::jsonb,
          settings JSONB NOT NULL DEFAULT '{}'::jsonb,
          alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_device TEXT NOT NULL DEFAULT 'Browser session',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `)
      await pool.query('CREATE INDEX IF NOT EXISTS idx_fotpredict_bracket_rooms_updated_at ON fotpredict_bracket_rooms (updated_at DESC);')
      await pool.query('CREATE INDEX IF NOT EXISTS idx_fotpredict_watchlist_alert_rooms_updated_at ON fotpredict_watchlist_alert_rooms (updated_at DESC);')
    })()
  }

  await globalRef.__fotpredictPgSchemaReady
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

export function getSyncStoreMeta() {
  if (hasManagedPostgres()) {
    return {
      storage: 'managed_postgres',
      durable: true,
      database: databaseUrl()?.includes('vercel-storage.com') ? 'vercel_postgres' : 'postgres',
      note: 'Server sync is backed by a managed Postgres database through DATABASE_URL/POSTGRES_URL.',
    }
  }

  return {
    storage: process.env.FOTPREDICT_STORE_DIR ? 'configured_file_store' : 'ephemeral_file_store',
    durable: Boolean(process.env.FOTPREDICT_STORE_DIR),
    database: null,
    note: process.env.FOTPREDICT_STORE_DIR
      ? 'Server sync is backed by FOTPREDICT_STORE_DIR for local/staging use.'
      : 'Server sync is using the runtime temp directory. Set DATABASE_URL/POSTGRES_URL before public launch.',
  }
}

export async function checkSyncStoreHealth() {
  const meta = getSyncStoreMeta()

  if (hasManagedPostgres()) {
    const startedAt = Date.now()
    try {
      await ensureSchema()
      await getPool().query('SELECT 1')
      return {
        ok: true,
        managed: true,
        durable: true,
        storage: meta.storage,
        database: meta.database,
        latency_ms: Date.now() - startedAt,
        message: 'Managed Postgres is reachable and sync tables are ready.',
      }
    } catch (error) {
      return {
        ok: false,
        managed: true,
        durable: true,
        storage: meta.storage,
        database: meta.database,
        latency_ms: Date.now() - startedAt,
        message: error instanceof Error ? error.message : 'Managed Postgres health check failed.',
      }
    }
  }

  try {
    ensureStoreDir()
    return {
      ok: true,
      managed: false,
      durable: meta.durable,
      storage: meta.storage,
      database: meta.database,
      latency_ms: 0,
      message: meta.durable
        ? 'Configured file store is available for local or staging sync.'
        : 'Ephemeral file store is available for local development only. Configure DATABASE_URL/POSTGRES_URL for public launch.',
    }
  } catch (error) {
    return {
      ok: false,
      managed: false,
      durable: false,
      storage: meta.storage,
      database: meta.database,
      latency_ms: 0,
      message: error instanceof Error ? error.message : 'Local sync store health check failed.',
    }
  }
}

export async function bracketRoomExists(roomCode: string): Promise<boolean> {
  if (hasManagedPostgres()) {
    await ensureSchema()
    const result = await getPool().query('SELECT 1 FROM fotpredict_bracket_rooms WHERE room_code = $1 LIMIT 1', [roomCode])
    return (result.rowCount ?? 0) > 0
  }

  const store = readJsonStore<BracketRoomStore>(BRACKET_STORE_FILE, { rooms: {} })
  return Boolean(store.rooms[roomCode])
}

export async function getBracketRoom(roomCode: string): Promise<BracketRoomRecord | null> {
  if (hasManagedPostgres()) {
    await ensureSchema()
    const result = await getPool().query(
      `SELECT room_code, owner_pin_hash, group_payload, created_at, updated_at, last_synced_by
       FROM fotpredict_bracket_rooms
       WHERE room_code = $1
       LIMIT 1`,
      [roomCode],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      roomCode: row.room_code,
      ownerPinHash: row.owner_pin_hash,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      lastSyncedBy: row.last_synced_by,
      group: row.group_payload,
    }
  }

  const store = readJsonStore<BracketRoomStore>(BRACKET_STORE_FILE, { rooms: {} })
  return store.rooms[roomCode] || null
}

export async function saveBracketRoom(record: BracketRoomRecord): Promise<void> {
  if (hasManagedPostgres()) {
    await ensureSchema()
    await getPool().query(
      `INSERT INTO fotpredict_bracket_rooms (
         room_code, owner_pin_hash, group_payload, created_at, updated_at, last_synced_by
       )
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       ON CONFLICT (room_code) DO UPDATE SET
         owner_pin_hash = EXCLUDED.owner_pin_hash,
         group_payload = EXCLUDED.group_payload,
         updated_at = EXCLUDED.updated_at,
         last_synced_by = EXCLUDED.last_synced_by`,
      [
        record.roomCode,
        record.ownerPinHash,
        JSON.stringify(record.group),
        record.createdAt,
        record.updatedAt,
        record.lastSyncedBy,
      ],
    )
    return
  }

  const store = readJsonStore<BracketRoomStore>(BRACKET_STORE_FILE, { rooms: {} })
  store.rooms[record.roomCode] = record
  writeJsonStore(BRACKET_STORE_FILE, store)
}

export async function watchlistAlertRoomExists(syncCode: string): Promise<boolean> {
  if (hasManagedPostgres()) {
    await ensureSchema()
    const result = await getPool().query('SELECT 1 FROM fotpredict_watchlist_alert_rooms WHERE sync_code = $1 LIMIT 1', [syncCode])
    return (result.rowCount ?? 0) > 0
  }

  const store = readJsonStore<WatchlistAlertStore>(ALERT_STORE_FILE, { rooms: {} })
  return Boolean(store.rooms[syncCode])
}

export async function getWatchlistAlertRoom(syncCode: string): Promise<WatchlistAlertRoomRecord | null> {
  if (hasManagedPostgres()) {
    await ensureSchema()
    const result = await getPool().query(
      `SELECT sync_code, tracked_teams, settings, alerts, source_device, created_at, updated_at
       FROM fotpredict_watchlist_alert_rooms
       WHERE sync_code = $1
       LIMIT 1`,
      [syncCode],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      syncCode: row.sync_code,
      trackedTeams: row.tracked_teams || [],
      settings: row.settings || {},
      alerts: row.alerts || [],
      sourceDevice: row.source_device,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    }
  }

  const store = readJsonStore<WatchlistAlertStore>(ALERT_STORE_FILE, { rooms: {} })
  return store.rooms[syncCode] || null
}

export async function saveWatchlistAlertRoom(record: WatchlistAlertRoomRecord): Promise<void> {
  if (hasManagedPostgres()) {
    await ensureSchema()
    await getPool().query(
      `INSERT INTO fotpredict_watchlist_alert_rooms (
         sync_code, tracked_teams, settings, alerts, source_device, created_at, updated_at
       )
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7)
       ON CONFLICT (sync_code) DO UPDATE SET
         tracked_teams = EXCLUDED.tracked_teams,
         settings = EXCLUDED.settings,
         alerts = EXCLUDED.alerts,
         source_device = EXCLUDED.source_device,
         updated_at = EXCLUDED.updated_at`,
      [
        record.syncCode,
        JSON.stringify(record.trackedTeams),
        JSON.stringify(record.settings),
        JSON.stringify(record.alerts),
        record.sourceDevice,
        record.createdAt,
        record.updatedAt,
      ],
    )
    return
  }

  const store = readJsonStore<WatchlistAlertStore>(ALERT_STORE_FILE, { rooms: {} })
  store.rooms[record.syncCode] = record
  writeJsonStore(ALERT_STORE_FILE, store)
}
