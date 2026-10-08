import { NextRequest, NextResponse } from 'next/server'
import { matchEvidence, validEvidenceDate } from '@/lib/matchEvidence'
import { readPredictionArchive } from '@/lib/server/recordedForecast'

export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const today = new Date().toISOString().slice(0, 10)
  const asOf = q.get('asOf') ?? today
  if (!validEvidenceDate(asOf) || asOf > today) return NextResponse.json({ error: 'Use a valid past or current UTC date.' }, { status: 400 })
  const from = q.get('from') ?? new Date(Date.parse(`${asOf}T00:00:00Z`) - 90 * 86400000).toISOString().slice(0, 10)
  if (!validEvidenceDate(asOf) || !validEvidenceDate(from) || from > asOf || asOf > today || Date.parse(asOf) - Date.parse(from) > 366 * 86400000) {
    return NextResponse.json({ error: 'Use a valid past or current UTC date window of at most 366 days.' }, { status: 400 })
  }
  const archive = await readPredictionArchive()
  return NextResponse.json(matchEvidence(archive.entries, q.get('league') ?? '', q.get('gender') ?? '', asOf, from, archive.failedFiles), { headers: { 'Cache-Control': 'no-store' } })
}
