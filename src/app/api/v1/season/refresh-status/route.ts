import path from 'path'
import { NextResponse } from 'next/server'
import { readOptionalArtifact } from '@/lib/server/readOptionalArtifact'
import { parseScheduleRefresh, UNKNOWN_SCHEDULE } from '@/lib/scheduleRefresh'

export const dynamic = 'force-dynamic'
const ARTIFACT = path.join(process.cwd(), 'backend/data/predictions/season_refresh_status.json')

export async function GET() {
  try {
    const artifact = await readOptionalArtifact(ARTIFACT)
    if (!artifact) return NextResponse.json(UNKNOWN_SCHEDULE)
    const status = parseScheduleRefresh(artifact)
    if (!status) throw new Error('Invalid schedule status')
    return NextResponse.json(status)
  } catch {
    return NextResponse.json(UNKNOWN_SCHEDULE, { status: 503 })
  }
}
