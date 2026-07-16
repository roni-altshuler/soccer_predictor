import { NextRequest, NextResponse } from 'next/server'

import { simulateFrom, type MatchState, type OutcomeDistribution } from '@/lib/engine/kernel'
import { getMatchAnchor, type MatchAnchor } from '@/lib/engine/params'
import { resolveEntry } from '@/lib/match2vec'

/**
 * Fork a match from a mid-match state — the counterfactual seed.
 *
 * POST /api/v1/engine/fork
 * body: { matchId, state: { minute, homeGoals, awayGoals, homeReds,
 *         awayReds }, league?, date?, home?, away? }
 * → { available: boolean, distribution?: OutcomeDistribution }
 *
 * `matchId` is the live match-page id (an ESPN event id for ESPN-sourced
 * pages) or a warehouse match id; the optional fixture context
 * (league/date/home/away) lets pages resolve the way the similar-matches
 * route does (`src/lib/match2vec.ts`). Reads only committed artifacts —
 * works on Vercel where the warehouse SQLite is absent.
 *
 * Honesty rules: a match without a walk-forward anchor (uncovered, or too
 * little prior history for an honest fit) returns `available: false` —
 * never a guess. Every probability comes from the committed kernel run
 * from the exact state the caller supplied.
 */

interface ForkRequestBody {
  matchId?: unknown
  state?: Partial<Record<keyof MatchState, unknown>>
  league?: unknown
  date?: unknown
  home?: unknown
  away?: unknown
}

const STATE_FIELDS: Array<keyof MatchState> = [
  'minute',
  'homeGoals',
  'awayGoals',
  'homeReds',
  'awayReds',
]

function parseState(raw: ForkRequestBody['state']): MatchState | null {
  if (!raw || typeof raw !== 'object') return null
  const state = {} as MatchState
  for (const field of STATE_FIELDS) {
    const value = raw[field]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return null
    }
    state[field] = value
  }
  return state
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function resolveAnchor(body: ForkRequestBody, matchId: string): MatchAnchor | null {
  // Direct hit first (warehouse ids, incl. espn_* event rows) …
  const direct = getMatchAnchor(matchId)
  if (direct) return direct
  // … then the match2vec resolution path (page id + fixture context).
  const entry = resolveEntry({
    matchId,
    league: optionalString(body.league),
    date: optionalString(body.date),
    home: optionalString(body.home),
    away: optionalString(body.away),
  })
  return entry ? getMatchAnchor(entry.id) : null
}

export async function POST(request: NextRequest) {
  let body: ForkRequestBody
  try {
    body = (await request.json()) as ForkRequestBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const matchId = typeof body.matchId === 'string' ? body.matchId.trim() : ''
  const state = parseState(body.state)
  if (!matchId || !state) {
    return NextResponse.json(
      { error: 'matchId and a numeric state are required' },
      { status: 400 }
    )
  }

  const anchor = resolveAnchor(body, matchId)
  if (!anchor) {
    // Unresolvable or unanchored → honestly unavailable, never an error.
    return NextResponse.json({ available: false })
  }

  let distribution: OutcomeDistribution
  try {
    distribution = simulateFrom(anchor, state)
  } catch {
    // Kernel artifact missing/incompatible on this deployment.
    return NextResponse.json({ available: false })
  }
  return NextResponse.json({ available: true, distribution })
}
