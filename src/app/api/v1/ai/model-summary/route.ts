import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/**
 * Model transparency summary for the /ai dashboard.
 *
 * Reads the committed per-gender training summary written by
 * `backend/scripts/train_unified.py` into `backend/data/diagnostics/`
 * (`unified_men_summary.json` / `unified_women_summary.json`). The model
 * artefacts themselves are gitignored, but the summary is committed so the
 * Vercel deployment can show honest holdout metrics without FastAPI.
 *
 * Returns `{ available: false }` (200) when the file hasn't been generated
 * yet — the summary only appears after the next retrain — so callers can
 * render an honest empty state instead of fabricating numbers.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const gender = request.nextUrl.searchParams.get('gender') === 'F' ? 'F' : 'M'
  const file = path.join(
    process.cwd(),
    'backend',
    'data',
    'diagnostics',
    gender === 'F' ? 'unified_women_summary.json' : 'unified_men_summary.json'
  )

  if (!fs.existsSync(file)) {
    return NextResponse.json({ available: false, gender })
  }

  try {
    const summary = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return NextResponse.json({ available: true, gender, summary })
  } catch {
    return NextResponse.json({ available: false, gender })
  }
}
