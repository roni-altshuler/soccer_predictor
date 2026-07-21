import { NextRequest, NextResponse } from 'next/server'

import { simulateFrom, type MatchState, type OutcomeDistribution } from '@/lib/engine/kernel'
import { deriveLiveAnchor } from '@/lib/engine/liveAnchor'

/**
 * Run the Match Engine's roll-forward kernel on an IN-PROGRESS fixture.
 *
 * POST /api/v1/engine/live
 * body: { competition, homeTeam, awayTeam,
 *         state: { minute, homeGoals, awayGoals, homeReds, awayReds } }
 * → { available: boolean, distribution?: OutcomeDistribution, gender?: 'M'|'F' }
 *
 * Unlike POST /api/v1/engine/fork (which resolves a FINISHED match id to a
 * committed walk-forward anchor), this route DERIVES the anchor for a live
 * fixture from the committed team-strength artifact — the live fixture is not
 * in the per-match anchor export. Reads only committed artifacts, so it works
 * on Vercel where the warehouse SQLite is absent.
 *
 * Honesty rules: an uncovered competition, an unresolved/ambiguous team, or a
 * missing kernel artifact returns `available: false` — never a guess. Every
 * probability comes from the exact kernel run from the state supplied.
 */

interface LiveRequestBody {
  competition?: unknown
  homeTeam?: unknown
  awayTeam?: unknown
  state?: Partial<Record<keyof MatchState, unknown>>
}

const STATE_FIELDS: Array<keyof MatchState> = [
  'minute',
  'homeGoals',
  'awayGoals',
  'homeReds',
  'awayReds',
]

function parseState(raw: LiveRequestBody['state']): MatchState | null {
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

function requiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(request: NextRequest) {
  let body: LiveRequestBody
  try {
    body = (await request.json()) as LiveRequestBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const competition = requiredString(body.competition)
  const homeTeam = requiredString(body.homeTeam)
  const awayTeam = requiredString(body.awayTeam)
  const state = parseState(body.state)
  if (!competition || !homeTeam || !awayTeam || !state) {
    return NextResponse.json(
      { error: 'competition, homeTeam, awayTeam and a numeric state are required' },
      { status: 400 },
    )
  }

  const anchor = deriveLiveAnchor({ competition, homeTeam, awayTeam })
  if (!anchor) {
    // Uncovered competition or unresolvable team → honestly unavailable.
    return NextResponse.json({ available: false })
  }

  let distribution: OutcomeDistribution
  try {
    distribution = simulateFrom(anchor, state)
  } catch {
    // Kernel artifact missing/incompatible on this deployment.
    return NextResponse.json({ available: false })
  }
  return NextResponse.json({ available: true, distribution, gender: anchor.gender })
}
