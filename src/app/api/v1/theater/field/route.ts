import { NextRequest, NextResponse } from 'next/server'

import { queryRarity, RARITY_MIN_SAMPLE, type RarityGender } from '@/lib/rarity'

/**
 * The full counted win-chance field for one universe — the surface behind
 * `src/components/theater/MatchTheater.tsx`.
 *
 * GET /api/v1/theater/field?gender=M
 *   → { gender, matchesCovered, minSample, cells: [{ diff, minute, n, w, d, l }] }
 *
 * Every cell is one exact-count state of the committed rarity artifact: the
 * home side's score difference (-3..+3) at a 5-minute mark (0..90), with the
 * warehouse's {w,d,l}/n outcome counts for every match that reached it.
 * States counted fewer than {@link RARITY_MIN_SAMPLE} times are OMITTED, not
 * zero-filled or interpolated — the surface is allowed to have holes, and the
 * client renders only what is counted.
 *
 * One request delivers the whole grid (~130 rows) because the client needs
 * every cell at once to build a continuous mesh; the per-state
 * `/api/v1/rarity` route stays the right call for point lookups.
 */

const DIFF_MIN = -3
const DIFF_MAX = 3
const BUCKET_STEP = 5
const BUCKET_MAX = 90

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  const genderRaw = (searchParams.get('gender') ?? 'M').trim().toUpperCase()
  const gender: RarityGender | null =
    genderRaw === 'M' || genderRaw === 'MEN'
      ? 'M'
      : genderRaw === 'F' || genderRaw === 'WOMEN'
        ? 'F'
        : null

  if (gender === null) {
    return NextResponse.json({ error: 'expected gender=M|F' }, { status: 400 })
  }

  const cells: Array<{ diff: number; minute: number; n: number; w: number; d: number; l: number }> =
    []
  let matchesCovered = 0

  for (let diff = DIFF_MIN; diff <= DIFF_MAX; diff++) {
    for (let minute = 0; minute <= BUCKET_MAX; minute += BUCKET_STEP) {
      const state = queryRarity(gender, diff, minute)
      matchesCovered = Math.max(matchesCovered, state.matches_covered)
      // Thin states are omitted entirely — a hole in the surface is honest,
      // an interpolated height is not.
      if (state.n < RARITY_MIN_SAMPLE) continue
      cells.push({ diff, minute, n: state.n, w: state.w, d: state.d, l: state.l })
    }
  }

  return NextResponse.json(
    { gender, matchesCovered, minSample: RARITY_MIN_SAMPLE, cells },
    // The artifact only changes on deploy — safe to cache.
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } }
  )
}
