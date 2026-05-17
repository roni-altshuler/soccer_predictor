import { NextResponse } from 'next/server'
import { getJsonStoreMeta, readJsonStore } from '@/lib/serverJsonStore'

export const dynamic = 'force-dynamic'

interface BracketRoomStore {
  rooms: Record<string, {
    roomCode: string
    createdAt: string
    updatedAt: string
    lastSyncedBy: string
    group: unknown
  }>
}

const STORE_FILE = 'bracket-rooms.json'

function normalizeRoomCode(value?: string): string {
  return (value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  const { roomCode: rawRoomCode } = await params
  const roomCode = normalizeRoomCode(rawRoomCode)
  const store = readJsonStore<BracketRoomStore>(STORE_FILE, { rooms: {} })
  const room = store.rooms[roomCode]

  if (!room) {
    return NextResponse.json({ error: 'Bracket room not found.' }, { status: 404 })
  }

  return NextResponse.json({
    roomCode: room.roomCode,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    lastSyncedBy: room.lastSyncedBy,
    group: room.group,
    storage: getJsonStoreMeta(),
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
