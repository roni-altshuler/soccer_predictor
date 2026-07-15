import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/**
 * Justice Ledger — luck-adjusted season tables (VISION_2030 §4.4).
 *
 * GET /api/v1/justice?competition=eng.1&season=2025 → that season's block:
 * per-team actual points vs the points their chance quality deserved (xPts),
 * sorted by xPts. Reads the committed artifact under `backend/data/justice/`
 * (fs read + mtime-keyed cache — the same pattern as the tracking/rarity
 * routes, so this works on Vercel where the warehouse SQLite is absent).
 *
 * Honesty contract: the artifact only contains competition-seasons that
 * cleared the ≥90% xG-coverage gates at build time. A season absent from the
 * artifact returns 200 with an empty team list — never fabricated rows.
 */

interface JusticeTeamRow {
  team: string
  pts: number
  xpts: number
  delta: number
  matches: number
}

interface JusticeSeasonBlock {
  coverage: number
  teams: JusticeTeamRow[]
}

interface JusticeArtifact {
  schema: number
  generated_at: string
  seasons: Record<string, JusticeSeasonBlock>
}

const LEDGER_FILE = path.join(process.cwd(), 'backend', 'data', 'justice', 'ledger.json')

let cache: { mtimeMs: number; data: JusticeArtifact | null } | null = null

function loadLedger(): JusticeArtifact | null {
  try {
    const stat = fs.statSync(LEDGER_FILE)
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.data
    const parsed = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8')) as JusticeArtifact
    cache = { mtimeMs: stat.mtimeMs, data: parsed }
    return parsed
  } catch {
    cache = { mtimeMs: -1, data: null }
    return null
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const competition = (searchParams.get('competition') ?? '').trim()
  const seasonRaw = (searchParams.get('season') ?? '').trim()
  const season = Number.parseInt(seasonRaw, 10)

  if (!competition || !Number.isFinite(season)) {
    return NextResponse.json(
      { error: 'expected competition (e.g. eng.1) and integer season (e.g. 2025)' },
      { status: 400 }
    )
  }

  const ledger = loadLedger()
  const block = ledger?.seasons?.[`${competition}:${season}`] ?? null

  return NextResponse.json(
    {
      competition,
      season,
      coverage: block?.coverage ?? null,
      teams: block?.teams ?? [],
    },
    // The artifact only changes on deploy — safe to cache briefly.
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } }
  )
}
