import { NextRequest, NextResponse } from 'next/server'

import {
  matchHref,
  resolveEntry,
  selectNeighbors,
  type Match2VecEntry,
} from '@/lib/match2vec'

/**
 * Similar matches — VISION_2030's retrieval verb.
 *
 * GET /api/v1/similar/[matchId]?league=eng.1&date=...&home=...&away=...
 *
 * `matchId` is the live match-page id (an ESPN event id); the optional
 * fixture context (league/date/home/away) lets matches that the warehouse
 * covered under a different source id resolve too, and corroborates the
 * direct id hit. Reads the committed artifact under
 * `backend/data/match2vec/` — works on Vercel where the warehouse SQLite
 * is absent.
 *
 * Honesty rules: an unresolvable match returns an empty neighbour list
 * (the rail renders nothing); similarity values are ranking machinery and
 * are NEVER included in the response — every number here (scores, facts,
 * dates) is an exact warehouse count.
 */

const NEIGHBOR_COUNT = 6

interface NeighborPayload {
  id: string
  home: string
  away: string
  score: string
  competitionId: string
  season: number | null
  date: string
  gender: 'M' | 'F'
  facts: Match2VecEntry['facts']
  /** Live match-page href, or null when the match has no routable page. */
  href: string | null
}

function toPayload(entry: Match2VecEntry): NeighborPayload {
  return {
    id: entry.id,
    home: entry.home,
    away: entry.away,
    score: entry.score,
    competitionId: entry.competitionId,
    season: entry.season,
    date: entry.date,
    gender: entry.gender,
    facts: entry.facts,
    href: matchHref(entry),
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params
  const { searchParams } = new URL(request.url)

  const entry = resolveEntry({
    matchId,
    league: searchParams.get('league') ?? undefined,
    date: searchParams.get('date') ?? undefined,
    home: searchParams.get('home') ?? undefined,
    away: searchParams.get('away') ?? undefined,
  })

  // Not in the index → an honest empty list, never an error or a guess.
  if (!entry) {
    return NextResponse.json(
      { neighbors: [] },
      { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } }
    )
  }

  const neighbors = selectNeighbors(entry, NEIGHBOR_COUNT).map(toPayload)

  return NextResponse.json(
    { neighbors },
    // The artifact only changes on deploy — safe to cache briefly.
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } }
  )
}
