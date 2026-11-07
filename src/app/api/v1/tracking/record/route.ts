import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { readOptionalArtifact } from '@/lib/server/readOptionalArtifact'
import { parsePublishedRecord } from '@/lib/publishedTrackRecord'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('gender') === 'F') return NextResponse.json({ available: false, reason: 'No verified women’s match ledger has been published.' })
  try {
    const raw = await readOptionalArtifact(path.join(process.cwd(), 'backend/data/evaluation/track_record.json'))
    if (!raw) return NextResponse.json({ available: false, reason: 'The verified game-level record has not been published yet.' })
    const record = parsePublishedRecord(raw)
    return NextResponse.json({ available: true, record, readAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ available: false, reason: 'The verified game-level record could not be read. No accuracy has been estimated.' }, { status: 503 })
  }
}
