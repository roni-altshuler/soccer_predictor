import { NextRequest, NextResponse } from 'next/server'

import { getRarityExamples, queryRarity, type RarityGender } from '@/lib/rarity'

/**
 * Rarity Engine v1 — exact-count historical state lookup.
 *
 * GET /api/v1/rarity?gender=M&diff=-2&minute=79            → counts
 * GET /api/v1/rarity?gender=M&diff=-2&minute=79&examples=1 → counts + precedents
 *
 * `diff` is the queried side's score difference at `minute` (negative =
 * trailing); the minute floors onto the artifact's 5-minute grid (90+ and
 * extra time clamp to the 90 bucket). Reads the committed artifacts under
 * `backend/data/rarity/` — the same pattern as the tracking routes, so this
 * works on Vercel where the warehouse SQLite is absent. A valid query never
 * errors: unseen states return `n: 0`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  const genderRaw = (searchParams.get('gender') ?? 'M').trim().toUpperCase()
  const gender: RarityGender | null =
    genderRaw === 'M' || genderRaw === 'MEN' ? 'M' : genderRaw === 'F' || genderRaw === 'WOMEN' ? 'F' : null

  const diff = Number.parseInt(searchParams.get('diff') ?? '', 10)
  const minute = Number.parseInt(searchParams.get('minute') ?? '', 10)

  if (gender === null || !Number.isFinite(diff) || !Number.isFinite(minute)) {
    return NextResponse.json(
      { error: 'expected gender=M|F, integer diff and integer minute' },
      { status: 400 }
    )
  }

  const result = queryRarity(gender, diff, minute)
  const wantExamples = searchParams.get('examples') === '1'

  return NextResponse.json(
    wantExamples ? { ...result, examples: getRarityExamples(gender, diff, minute) } : result,
    // The artifact only changes on deploy — safe to cache briefly.
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } }
  )
}
