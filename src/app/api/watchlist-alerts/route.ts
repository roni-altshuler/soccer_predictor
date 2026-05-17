import { NextRequest, NextResponse } from 'next/server'
import { getJsonStoreMeta, readJsonStore, writeJsonStore } from '@/lib/serverJsonStore'

export const dynamic = 'force-dynamic'

interface WatchTeam {
  name: string
  league: string
}

interface AlertSettings {
  kickoffReminders: boolean
  confidenceAlerts: boolean
  reminderMinutes: number
  confidenceThreshold: number
}

interface AlertItem {
  id: string
  type: 'kickoff' | 'confidence'
  title: string
  detail: string
  tone: string
}

interface WatchlistAlertRoom {
  syncCode: string
  createdAt: string
  updatedAt: string
  sourceDevice: string
  trackedTeams: WatchTeam[]
  settings: AlertSettings
  alerts: AlertItem[]
}

interface WatchlistAlertStore {
  rooms: Record<string, WatchlistAlertRoom>
}

const STORE_FILE = 'watchlist-alerts.json'

function normalizeSyncCode(value?: string): string {
  return (value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10)
}

function createSyncCode(existing: Record<string, WatchlistAlertRoom>): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = Math.random().toString(36).slice(2, 9).toUpperCase()
    if (!existing[code]) return code
  }
  return Date.now().toString(36).slice(-7).toUpperCase()
}

function sanitizeTeams(value: unknown): WatchTeam[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is WatchTeam => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<WatchTeam>
      return typeof candidate.name === 'string' && typeof candidate.league === 'string'
    })
    .map((team) => ({
      name: team.name.trim().slice(0, 80),
      league: team.league.trim().slice(0, 80),
    }))
    .filter((team) => team.name.length > 0 && team.league.length > 0)
    .slice(0, 80)
}

function sanitizeAlerts(value: unknown): AlertItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is AlertItem => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<AlertItem>
      return typeof candidate.id === 'string' &&
        (candidate.type === 'kickoff' || candidate.type === 'confidence') &&
        typeof candidate.title === 'string' &&
        typeof candidate.detail === 'string'
    })
    .map((alert) => ({
      id: alert.id.slice(0, 120),
      type: alert.type,
      title: alert.title.slice(0, 140),
      detail: alert.detail.slice(0, 220),
      tone: typeof alert.tone === 'string' ? alert.tone.slice(0, 32) : '#38bdf8',
    }))
    .slice(0, 30)
}

function sanitizeSettings(value: unknown): AlertSettings {
  const settings = value && typeof value === 'object' ? value as Partial<AlertSettings> : {}
  return {
    kickoffReminders: settings.kickoffReminders !== false,
    confidenceAlerts: settings.confidenceAlerts !== false,
    reminderMinutes: Math.max(5, Math.min(240, Number(settings.reminderMinutes) || 45)),
    confidenceThreshold: Math.max(0.35, Math.min(0.9, Number(settings.confidenceThreshold) || 0.62)),
  }
}

function loadStore(): WatchlistAlertStore {
  return readJsonStore<WatchlistAlertStore>(STORE_FILE, { rooms: {} })
}

function saveStore(store: WatchlistAlertStore): void {
  writeJsonStore(STORE_FILE, store)
}

export async function GET(request: NextRequest) {
  const syncCode = normalizeSyncCode(request.nextUrl.searchParams.get('syncCode') || '')
  if (!syncCode) {
    return NextResponse.json({ error: 'syncCode is required.' }, { status: 400 })
  }

  const store = loadStore()
  const room = store.rooms[syncCode]
  if (!room) {
    return NextResponse.json({ error: 'Watchlist alert sync code not found.' }, { status: 404 })
  }

  return NextResponse.json({
    ...room,
    storage: getJsonStoreMeta(),
    push_delivery: {
      enabled: false,
      note: 'This endpoint provides server-backed alert sync. Native Web Push delivery should be enabled with a dedicated push provider before production launch.',
    },
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const store = loadStore()
    const now = new Date().toISOString()
    const requestedCode = normalizeSyncCode(body.syncCode)
    const syncCode = requestedCode || createSyncCode(store.rooms)
    const existing = store.rooms[syncCode]

    const room: WatchlistAlertRoom = {
      syncCode,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      sourceDevice: typeof body.sourceDevice === 'string' && body.sourceDevice.trim()
        ? body.sourceDevice.trim().slice(0, 80)
        : 'Browser session',
      trackedTeams: sanitizeTeams(body.trackedTeams),
      settings: sanitizeSettings(body.settings),
      alerts: sanitizeAlerts(body.alerts),
    }

    store.rooms[syncCode] = room
    saveStore(store)

    return NextResponse.json({
      ...room,
      storage: getJsonStoreMeta(),
      push_delivery: {
        enabled: false,
        note: 'Server alert sync is active. Configure native Web Push separately before relying on background delivery.',
      },
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid watchlist alert sync request.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
