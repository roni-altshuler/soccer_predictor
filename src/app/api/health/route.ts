import { NextResponse } from 'next/server'
import {
  checkDatabase,
  checkFastApiBackend,
  checkModelArtifacts,
  checkPredictionsFreshness,
  resolveVersion,
} from '@/lib/health-checks'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Status = 'ok' | 'degraded' | 'down'

export async function GET() {
  // Run every check in parallel — each helper is guaranteed not to throw and
  // honours its own timeout, so Promise.all here is safe.
  const [db, modelArtifacts, predictionsFreshness, fastapiBackend] = await Promise.all([
    checkDatabase(1000),
    checkModelArtifacts(10),
    checkPredictionsFreshness(8),
    checkFastApiBackend(1500),
  ])

  let status: Status = 'ok'
  if (!db.ok || !modelArtifacts.ok) {
    status = 'down'
  } else if (!predictionsFreshness.ok || !fastapiBackend.ok) {
    status = 'degraded'
  }

  const body = {
    status,
    checks: {
      db,
      model_artifacts: modelArtifacts,
      predictions_freshness: predictionsFreshness,
      fastapi_backend: fastapiBackend,
    },
    version: resolveVersion(),
    checked_at: new Date().toISOString(),
  }

  return NextResponse.json(body, {
    status: status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
