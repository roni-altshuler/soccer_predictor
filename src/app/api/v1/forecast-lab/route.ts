import { NextRequest, NextResponse } from 'next/server'
import { readForecastLab } from '@/lib/server/forecastLab'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const data = await readForecastLab(request.nextUrl.searchParams.get('fixture') ?? undefined)
  return NextResponse.json(data, { status: data.available ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}
