'use client'

import { useEffect, useState } from 'react'

interface ThreeWay {
  home_win: number
  draw: number
  away_win: number
}

interface LiveProbabilityResponse {
  pre_match: ThreeWay
  current: ThreeWay
  minute?: number
  score?: [number, number]
  state?: string
}

interface LiveProbabilityBarProps {
  matchId: string
  homeTeam: string
  awayTeam: string
  status: string
  league?: string
}

const FINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'POST', 'finished', 'cancelled', 'postponed'])

function pct(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

export default function LiveProbabilityBar({
  matchId,
  homeTeam,
  awayTeam,
  status,
  league,
}: LiveProbabilityBarProps) {
  const [data, setData] = useState<LiveProbabilityResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const finalStatus = FINAL_STATUSES.has(status)

    async function load() {
      try {
        const qs = league ? `?league=${encodeURIComponent(league)}` : ''
        const res = await fetch(`/api/match/${matchId}/live-probability${qs}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json: LiveProbabilityResponse = await res.json()
        if (cancelled) return
        setData(json)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load probability')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    if (finalStatus) {
      return () => {
        cancelled = true
      }
    }
    const id = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [matchId, status, league])

  if (loading && !data) {
    return (
      <div
        className="rounded-2xl border px-4 py-3 text-sm text-[var(--text-tertiary)]"
        style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
      >
        Loading live probability…
      </div>
    )
  }

  if (error && !data) {
    return (
      <div
        className="rounded-2xl border px-4 py-3 text-sm text-[var(--accent-loss)]"
        style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
      >
        Live probability unavailable ({error})
      </div>
    )
  }

  if (!data) return null

  const live = data.current
  const homePct = pct(live.home_win)
  const drawPct = pct(live.draw)
  const awayPct = Math.max(0, 100 - homePct - drawPct)

  const pre = data.pre_match
  const preHome = pct(pre.home_win)
  const preDraw = pct(pre.draw)
  const preAway = Math.max(0, 100 - preHome - preDraw)

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
    >
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-primary)' }} />
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">
            Live win probability
          </span>
          {typeof data.minute === 'number' && (
            <span className="text-[11px] text-[var(--text-tertiary)]">{data.minute}&apos;</span>
          )}
        </div>
        <span className="text-[11px] text-[var(--text-tertiary)]">
          Updated every 30s
        </span>
      </div>

      <div className="px-4">
        <div
          className="flex h-3.5 w-full overflow-hidden rounded-full ring-1 ring-[var(--border-color)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.25)]"
          role="img"
          aria-label="Live win probability"
        >
          <div
            className="prob-segment"
            style={{ width: `${homePct}%`, background: 'linear-gradient(90deg, color-mix(in srgb, var(--team-tint-home) 70%, transparent), var(--team-tint-home))' }}
            title={`${homeTeam} ${homePct}%`}
          />
          <div
            className="prob-segment"
            style={{ width: `${drawPct}%`, background: 'linear-gradient(90deg, color-mix(in srgb, var(--accent-warn) 70%, transparent), var(--accent-warn))' }}
            title={`Draw ${drawPct}%`}
          />
          <div
            className="prob-segment"
            style={{ width: `${awayPct}%`, background: 'linear-gradient(90deg, var(--team-tint-away), color-mix(in srgb, var(--team-tint-away) 70%, transparent))' }}
            title={`${awayTeam} ${awayPct}%`}
          />
        </div>

        <div className="mt-2 flex justify-between text-[11px] text-[var(--text-secondary)]">
          <span className="font-semibold" style={{ color: 'var(--team-tint-home)' }}>
            {homeTeam} {homePct}%
          </span>
          <span className="font-semibold text-[var(--text-secondary)]">Draw {drawPct}%</span>
          <span className="font-semibold" style={{ color: 'var(--team-tint-away)' }}>
            {awayTeam} {awayPct}%
          </span>
        </div>
      </div>

      <div className="px-4 py-2 text-[11px] text-[var(--text-tertiary)] border-t" style={{ borderColor: 'var(--border-color)' }}>
        Pre-match: {preHome}% / {preDraw}% / {preAway}%
      </div>
    </div>
  )
}
