import { NextResponse } from 'next/server'
import { checkSyncStoreHealth, getSyncStoreMeta } from '@/lib/serverSyncStore'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const syncStore = await checkSyncStoreHealth()
  const launchReady = syncStore.ok && syncStore.managed && syncStore.durable

  return NextResponse.json({
    status: launchReady ? 'ready' : 'needs_configuration',
    launch_ready: launchReady,
    generated_at: new Date().toISOString(),
    checks: {
      sync_store: syncStore,
    },
    storage: getSyncStoreMeta(),
    required_environment: [
      'DATABASE_URL or POSTGRES_URL',
    ],
    production_notes: [
      'Bracket challenge rooms and watchlist alert queues require managed Postgres for public launch.',
      'Local file storage remains available only for development and staging fallbacks.',
      'Native Web Push delivery, authentication, and licensed odds-provider configuration remain separate production hardening steps.',
    ],
  }, {
    status: launchReady ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
