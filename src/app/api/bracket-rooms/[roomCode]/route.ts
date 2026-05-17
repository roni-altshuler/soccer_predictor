import { NextResponse } from 'next/server'
import { getBracketRoom, getSyncStoreMeta } from '@/lib/serverSyncStore'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
  const room = await getBracketRoom(roomCode)

  if (!room) {
    return NextResponse.json({ error: 'Bracket room not found.' }, { status: 404 })
  }

  return NextResponse.json({
    roomCode: room.roomCode,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    lastSyncedBy: room.lastSyncedBy,
    group: room.group,
    storage: getSyncStoreMeta(),
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
