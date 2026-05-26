import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export const runtime = 'nodejs'

type WhatIfBody = {
  forcedResults?: Record<string, [number, number]>
  nSimulations?: number
  seed?: number | null
}

/**
 * POST /api/world-cup/groups/[groupId]/what-if
 *
 * Forwards `{ forcedResults }` to the FastAPI what-if endpoint and
 * returns the same schema as the simulate route.  Default
 * `n_simulations` is 20,000 (snappier for interactive use).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params
  let body: WhatIfBody = {}
  try {
    body = (await request.json()) as WhatIfBody
  } catch {
    body = {}
  }

  const forcedResults = body.forcedResults || {}
  const nSimulations = Math.min(
    100_000,
    Math.max(500, Number(body.nSimulations) || 20_000),
  )

  try {
    const upstream = await fetch(
      `${BACKEND_URL}/api/v1/world-cup/groups/${encodeURIComponent(groupId)}/what-if`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          forced_results: forcedResults,
          n_simulations: nSimulations,
          seed: body.seed ?? null,
        }),
      },
    )

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return NextResponse.json(
        { error: 'Upstream what-if simulation failed', detail: text || upstream.statusText },
        { status: upstream.status },
      )
    }

    const data = await upstream.json()
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to contact simulation backend', detail: String(error) },
      { status: 502 },
    )
  }
}
