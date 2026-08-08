'use client'

import { useEffect, useState } from 'react'

/**
 * Season-by-season track record for one league — the "is this working?" chart.
 *
 * WHY THE PLOTTED SERIES IS THE GAP, NOT RAW ACCURACY
 * ---------------------------------------------------
 * How predictable a season was is a property of the season, not the model. A
 * campaign with a runaway leader is easy for everyone; a chaotic one is hard
 * for everyone. Plotting raw accuracy makes a normal season look like a
 * regression and a boring season look like genius.
 *
 * So this plots model Brier MINUS market Brier — the same idea as measuring a
 * fund against its index rather than in absolute dollars. Zero is market
 * parity. Down is better. A flat line through a chaotic season is a good
 * result, and only this framing can show that.
 *
 * The numbers are a walk-forward backtest, not live picks: for each season the
 * model is fit on prior seasons only and never sees the one it is scored on.
 * That is stated on the chart, because presenting a backtest as a live record
 * is the most common way these pages lie.
 */

const MODEL = '#5fa657'
const PARITY = '#ffffff'

type Season = {
  season: number
  label: string
  n: number
  model_brier: number
  market_brier: number
  base_rate_brier: number
  gap_to_market: number
  model_accuracy: number
  market_accuracy: number
  signal_captured: number | null
}

type League = {
  competition_id: string
  name: string
  seasons: Season[]
  summary: {
    n_seasons: number
    total_fixtures: number
    mean_gap_to_market: number
    best_season: string
    worst_season: string
    gap_trend_per_season: number | null
    trend_reading: string | null
  }
}

export function LeagueTrackRecord({ leagueId }: { leagueId: string }) {
  const [league, setLeague] = useState<League | null>(null)
  const [dead, setDead] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/v1/accuracy/track-record?league=${encodeURIComponent(leagueId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        const hit = d?.available ? (d.leagues ?? [])[0] : null
        if (hit) {
          setLeague(hit)
        } else {
          setDead(true)
        }
      })
      .catch(() => alive && setDead(true))
    return () => {
      alive = false
    }
  }, [leagueId])

  if (dead) return null
  if (!league) {
    return <div className="h-56 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]" />
  }

  const s = league.seasons
  if (s.length < 2) return null

  const W = 640
  const H = 210
  const padL = 44
  // Right pad has to clear half a season label ("2025/26"), not just the last
  // dot, or the final tick clips off the viewBox.
  const padR = 30
  const padB = 30
  const padT = 14

  const gaps = s.map((d) => d.gap_to_market)
  const hi = Math.max(...gaps, 0.005)
  const lo = Math.min(...gaps, 0)
  const span = hi - lo || 0.01
  const yMax = hi + span * 0.25
  const yMin = lo - span * 0.25

  const sx = (i: number) => padL + (i / Math.max(1, s.length - 1)) * (W - padL - padR)
  const sy = (v: number) => padT + ((yMax - v) / (yMax - yMin)) * (H - padT - padB)

  const pts = s.map((d, i) => `${sx(i)},${sy(d.gap_to_market)}`)
  const trend = league.summary.trend_reading

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
      <header className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-[var(--text-primary)]">
          Season by season vs the closing line
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">
          {league.summary.total_fixtures.toLocaleString()} fixtures &middot;{' '}
          {league.summary.n_seasons} seasons
        </span>
      </header>
      <p className="mb-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Distance from the bookmaker&rsquo;s closing price each season. <strong className="text-[var(--text-secondary)]">Zero
        is market parity; lower is better.</strong> Plotting the gap rather than raw accuracy
        removes how predictable each season happened to be &mdash; a quiet title race is easy for
        everyone, and a model should not get credit for it.
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${league.name}: Brier gap to the closing line, by season`}
      >
        {/* Market parity */}
        <line x1={padL} y1={sy(0)} x2={W - padR} y2={sy(0)} stroke={PARITY} strokeWidth="1.5" />
        <text x={padL - 6} y={sy(0) + 3} textAnchor="end" fontSize="9" className="fill-[var(--text-secondary)]">
          0
        </text>
        <text x={W - padR} y={sy(0) - 6} textAnchor="end" fontSize="9" className="fill-[var(--text-tertiary)]">
          market parity
        </text>

        {[yMin, (yMin + yMax) / 2, yMax].map((t, i) =>
          Math.abs(t) < 1e-9 ? null : (
            <g key={i}>
              <line x1={padL} y1={sy(t)} x2={W - padR} y2={sy(t)} stroke="var(--border-color)" strokeWidth="1" />
              <text x={padL - 6} y={sy(t) + 3} textAnchor="end" fontSize="9" className="fill-[var(--text-tertiary)]">
                {t > 0 ? '+' : ''}{t.toFixed(3)}
              </text>
            </g>
          ),
        )}

        <polyline points={pts.join(' ')} fill="none" stroke={MODEL} strokeWidth="2" />
        {s.map((d, i) => (
          <g key={d.season}>
            <circle
              cx={sx(i)} cy={sy(d.gap_to_market)} r="4"
              fill={MODEL} stroke="var(--card-bg)" strokeWidth="2"
            >
              <title>
                {`${d.label} — gap ${d.gap_to_market > 0 ? '+' : ''}${d.gap_to_market.toFixed(4)} · `}
                {`model ${d.model_brier.toFixed(3)} vs market ${d.market_brier.toFixed(3)} · ${d.n} fixtures`}
              </title>
            </circle>
            <text x={sx(i)} y={H - 10} textAnchor="middle" fontSize="9" className="fill-[var(--text-tertiary)]">
              {d.label}
            </text>
          </g>
        ))}
      </svg>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--border-color)] pt-3 sm:grid-cols-4">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Mean gap</dt>
          <dd className="font-mono text-sm tabular-nums text-[var(--text-primary)]">
            {league.summary.mean_gap_to_market > 0 ? '+' : ''}
            {league.summary.mean_gap_to_market.toFixed(4)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Trend</dt>
          <dd className="text-sm text-[var(--text-primary)]">{trend ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Best season</dt>
          <dd className="font-mono text-sm tabular-nums text-[var(--text-primary)]">
            {league.summary.best_season}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Worst season</dt>
          <dd className="font-mono text-sm tabular-nums text-[var(--text-primary)]">
            {league.summary.worst_season}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        Walk-forward backtest, not live picks: for each season the model is fit on earlier seasons
        only and never sees the one it is scored on. Live picks are tracked separately on the
        accuracy page.
      </p>
    </section>
  )
}
