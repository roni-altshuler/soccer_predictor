import { NextRequest, NextResponse } from 'next/server'
import { getJsonStoreMeta, readJsonStore, writeJsonStore } from '@/lib/serverJsonStore'

export const dynamic = 'force-dynamic'

type WinnerPick = 'home' | 'away'

interface BracketChallengeEntry {
  id: string
  userName: string
  createdAt: string
  updatedAt: string
  picks: Record<string, WinnerPick>
  source?: 'manual' | 'model'
  modelLabel?: string
  generatedPicks?: number
  averagePickConfidence?: number
}

interface BracketChallengeGroup {
  id: string
  tournamentId: string
  season: string
  name: string
  ownerName: string
  inviteCode: string
  createdAt: string
  scoring?: Record<string, number>
  entries: BracketChallengeEntry[]
}

interface BracketRoomRecord {
  roomCode: string
  ownerPinHash: string
  createdAt: string
  updatedAt: string
  lastSyncedBy: string
  group: BracketChallengeGroup
}

interface BracketRoomStore {
  rooms: Record<string, BracketRoomRecord>
}

const STORE_FILE = 'bracket-rooms.json'

function loadStore(): BracketRoomStore {
  return readJsonStore<BracketRoomStore>(STORE_FILE, { rooms: {} })
}

function saveStore(store: BracketRoomStore): void {
  writeJsonStore(STORE_FILE, store)
}

function normalizeRoomCode(value?: string): string {
  return (value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
}

function createRoomCode(existing: Record<string, BracketRoomRecord>): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase()
    if (!existing[code]) return code
  }
  return `${Date.now().toString(36).slice(-6)}`.toUpperCase()
}

function hashPin(pin: string): string {
  let hash = 2166136261
  for (let i = 0; i < pin.length; i += 1) {
    hash ^= pin.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function sanitizePin(value: unknown): string {
  const pin = typeof value === 'string' ? value.trim() : ''
  if (pin.length < 4 || pin.length > 32) {
    throw new Error('Room PIN must be 4-32 characters.')
  }
  return pin
}

function sanitizeGroup(value: unknown): BracketChallengeGroup {
  if (!value || typeof value !== 'object') throw new Error('Missing bracket group payload.')
  const group = value as Partial<BracketChallengeGroup>
  if (
    typeof group.id !== 'string' ||
    typeof group.tournamentId !== 'string' ||
    typeof group.season !== 'string' ||
    typeof group.name !== 'string' ||
    !Array.isArray(group.entries)
  ) {
    throw new Error('Invalid bracket group payload.')
  }

  return {
    id: group.id,
    tournamentId: group.tournamentId,
    season: group.season,
    name: group.name,
    ownerName: group.ownerName || 'Commissioner',
    inviteCode: group.inviteCode || normalizeRoomCode(group.id) || createRoomCode({}),
    createdAt: group.createdAt || new Date().toISOString(),
    scoring: group.scoring || {},
    entries: group.entries.filter((entry): entry is BracketChallengeEntry => {
      if (!entry || typeof entry !== 'object') return false
      const candidate = entry as Partial<BracketChallengeEntry>
      return typeof candidate.id === 'string' &&
        typeof candidate.userName === 'string' &&
        !!candidate.picks &&
        typeof candidate.picks === 'object'
    }),
  }
}

function serializeRoom(room: BracketRoomRecord) {
  return {
    roomCode: room.roomCode,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    lastSyncedBy: room.lastSyncedBy,
    group: room.group,
    storage: getJsonStoreMeta(),
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const ownerPin = sanitizePin(body.ownerPin)
    const group = sanitizeGroup(body.group)
    const now = new Date().toISOString()
    const store = loadStore()
    const requestedCode = normalizeRoomCode(body.roomCode)
    const roomCode = requestedCode || createRoomCode(store.rooms)
    const existing = store.rooms[roomCode]

    if (existing && existing.ownerPinHash !== hashPin(ownerPin)) {
      return NextResponse.json(
        {
          error: 'Room PIN did not match. Pull the room or enter the commissioner PIN before overwriting.',
          guarantee: false,
        },
        { status: 403 },
      )
    }

    const record: BracketRoomRecord = {
      roomCode,
      ownerPinHash: existing?.ownerPinHash || hashPin(ownerPin),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastSyncedBy: typeof body.syncedBy === 'string' && body.syncedBy.trim() ? body.syncedBy.trim().slice(0, 60) : group.ownerName,
      group: {
        ...group,
        inviteCode: roomCode,
      },
    }

    store.rooms[roomCode] = record
    saveStore(store)

    return NextResponse.json(serializeRoom(record), {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid bracket room request.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
