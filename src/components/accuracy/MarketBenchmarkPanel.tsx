'use client'

import { useEffect, useState } from 'react'

/**
 * The scoreboard: how the model does against the bookmaker closing line.
 *
 * This panel exists because every other accuracy number on the site is
 * unreadable without it. "46% correct" means nothing until you know a constant
 * that ignores the fixture scores .6468 Brier and the closing line scores
 * .5666. The gap between those two is the entire space a model can win in, and
 * this panel says how much of it we have taken.
 *
 * Design notes (dataviz skill):
 *   - Two forms, chosen by job. Magnitude comparison across four named
 *     forecasters is a horizontal bar chart. The calibration claim is a
 *     reliability diagram — it is the only chart that can support the word
 *     "calibrated", so it earns its space.
 *   - Colour is achromatic-plus-one: the market is WHITE because it is the
 *     reference standard, the model is green. An achromatic/chromatic pair has
 *     no CVD failure mode at all, which is why it beats two hues here. The
 *     Bugatti rule holds — colour carries meaning, never decoration.
 *   - Lower is better on every metric shown, which is counterintuitive, so it
 *     is stated in words rather than implied by bar direction.
 */

const MARKET = '#ffffff'
const MODEL = '#5fa657'

type Metrics = {
  n: number
  brier: number
  log_loss: number
  rps: number
  accuracy: number
  ece?: number
  reliability?: ReliabilityBucket[]
}

type ReliabilityBucket = {
  lower: number
  upper: number
  count: number
  mean_predicted: number | null
  observed_frequency: number | null
}

type LeagueRow = {
  league: string
  n: number
  metrics: { model: Metrics; market_shin?: Metrics; market?: Metrics }
}

type Payload = {
  available: boolean
  market_corpus?: {
    overall?: { n?: number; metrics?: Record<string, Metrics> }
    by_league?: LeagueRow[]
  }
  paired_benchmark?: {
    coverage?: Record<string, number | string>
    overall?: { n: number; metrics?: Record<string, Metrics> }
    by_league?: LeagueRow[]
  }
}

function pct(v: number | null | undefined, digits = 1) {
  return v == null ? '—' : `${(v * 100).toFixed(digits)}%`
}
function num(v: number | null | undefined, digits = 4) {
  return v == null ? '—' : v.toFixed(digits)
}

/** Horizontal bars. Brier is negatively oriented, so the shortest bar wins. */
function BrierBars({
  rows,
}: {
  rows: { label: string; value: number; color: string; note?: string }[]
}) {
  const max = Math.max(...rows.map((r) => r.value)) * 1.08
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[9.5rem_1fr_3.5rem] items-center gap-3">
          <span className="truncate text-[11px] text-[var(--text-secondary)]">{r.label}</span>
          <div className="relative h-3 rounded-sm bg-[var(--muted-bg)]">
            <div
              className="absolute inset-y-0 left-0 rounded-sm"
              style={{ width: `${(r.value / max) * 100}%`, backgroundColor: r.color }}
              role="img"
              aria-label={`${r.label}: Brier ${num(r.value)}`}
            />
          </div>
          <span className="text-right font-mono text-[11px] tabular-nums text-[var(--text-primary)]">
            {num(r.value, 3)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Reliability diagram. x = stated probability, y = observed frequency.
 * The diagonal is perfect calibration; distance from it is the error.
 */
function ReliabilityChart({
  model,
  market,
}: {
  model?: ReliabilityBucket[]
  market?: ReliabilityBucket[]
}) {
  const W = 260
  const H = 200
  const pad = 28
  const sx = (v: number) => pad + v * (W - pad - 6)
  const sy = (v: number) => H - pad - v * (H - pad - 6)

  const line = (buckets?: ReliabilityBucket[]) =>
    (buckets ?? [])
      .filter((b) => b.count > 0 && b.mean_predicted != null && b.observed_frequency != null)
      .map((b) => `${sx(b.mean_predicted as number)},${sy(b.observed_frequency as number)}`)

  const modelPts = line(model)
  const marketPts = line(market)

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Reliability diagram: stated probability against observed frequency, for the model and the closing line"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={sx(t)} y1={sy(0)} x2={sx(t)} y2={sy(1)}
              stroke="var(--border-color)" strokeWidth="1"
            />
            <line
              x1={sx(0)} y1={sy(t)} x2={sx(1)} y2={sy(t)}
              stroke="var(--border-color)" strokeWidth="1"
            />
          </g>
        ))}
        {/* Perfect calibration */}
        <line
          x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)}
          stroke="var(--text-tertiary)" strokeWidth="1" strokeDasharray="3 3"
        />
        {marketPts.length > 1 && (
          <polyline points={marketPts.join(' ')} fill="none" stroke={MARKET} strokeWidth="2" />
        )}
        {modelPts.length > 1 && (
          <polyline points={modelPts.join(' ')} fill="none" stroke={MODEL} strokeWidth="2" />
        )}
        {marketPts.map((p, i) => {
          const [x, y] = p.split(',')
          return <circle key={`k${i}`} cx={x} cy={y} r="3.5" fill={MARKET} stroke="var(--card-bg)" strokeWidth="2" />
        })}
        {modelPts.map((p, i) => {
          const [x, y] = p.split(',')
          return <circle key={`m${i}`} cx={x} cy={y} r="3.5" fill={MODEL} stroke="var(--card-bg)" strokeWidth="2" />
        })}
        <text x={sx(0)} y={H - 8} className="fill-[var(--text-tertiary)]" fontSize="9">0%</text>
        <text x={sx(1) - 18} y={H - 8} className="fill-[var(--text-tertiary)]" fontSize="9">100%</text>
        <text x={2} y={sy(1) + 4} className="fill-[var(--text-tertiary)]" fontSize="9">100%</text>
        <text x={6} y={sy(0)} className="fill-[var(--text-tertiary)]" fontSize="9">0%</text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ backgroundColor: MARKET }} /> Closing line
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ backgroundColor: MODEL }} /> Model
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-[var(--text-tertiary)]" /> Perfect
        </span>
        <span>Stated chance (x) against what actually happened (y)</span>
      </figcaption>
    </figure>
  )
}

export function MarketBenchmarkPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/v1/accuracy/market')
      .then((r) => r.json())
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  if (failed || (data && !data.available)) return null
  if (!data) {
    return <div className="h-64 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]" />
  }

  const corpus = data.market_corpus?.overall?.metrics ?? {}
  const paired = data.paired_benchmark?.overall?.metrics ?? {}
  const marketCorpus = corpus['market_shin'] ?? corpus['market_proportional']

  // Everything compared below comes from the PAIRED block, so every bar is
  // scored on the same fixtures. Mixing the corpus market number with a paired
  // model number would flatter or punish the model by whichever slice it drew.
  const pModel = paired['model']
  const pMarket = paired['market_shin'] ?? paired['market_proportional']
  const pBase = paired['baseline_base_rate']
  const pUniform = paired['baseline_uniform']

  const gap = pModel && pMarket ? pModel.brier - pMarket.brier : null
  // Share of the constant→market distance the model has actually taken.
  const captured =
    pModel && pMarket && pBase
      ? (pBase.brier - pModel.brier) / (pBase.brier - pMarket.brier)
      : null

  const bars = [
    pMarket && { label: 'Closing line', value: pMarket.brier, color: MARKET },
    pModel && { label: 'Our model', value: pModel.brier, color: MODEL },
    pBase && { label: 'Constant base rate', value: pBase.brier, color: 'var(--text-tertiary)' },
    pUniform && { label: 'Blind 1-in-3 guess', value: pUniform.brier, color: 'var(--text-tertiary)' },
  ].filter(Boolean) as { label: string; value: number; color: string }[]

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold tracking-wide text-[var(--text-primary)]">
          Against the closing line
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          The bookmaker&rsquo;s closing price is the best public forecast of a football match, so it
          is the yardstick we score against. Every number here is Brier &mdash; squared error on the
          probabilities &mdash; where <strong className="text-[var(--text-secondary)]">lower is
          better</strong> and a blind three-way guess scores .667.
        </p>
      </header>

      {gap != null && (
        <div className="mb-5 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-[var(--border-color)] pb-4">
          <div>
            <div className="font-mono text-3xl tabular-nums text-[var(--text-primary)]">
              {gap > 0 ? '+' : ''}{num(gap, 4)}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Brier behind the close
            </div>
          </div>
          {captured != null && (
            <div>
              <div className="font-mono text-3xl tabular-nums text-[var(--text-primary)]">
                {pct(captured, 0)}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                of the available signal captured
              </div>
            </div>
          )}
          {pModel && (
            <div>
              <div className="font-mono text-3xl tabular-nums text-[var(--text-primary)]">
                {pModel.n}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                fixtures priced by both
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
            Brier score &mdash; shorter is better
          </h3>
          <BrierBars rows={bars} />
          <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            All four scored on the same {pModel?.n ?? 0} fixtures, so the comparison is exact.
            {marketCorpus && (
              <>
                {' '}Over the full{' '}
                {data.market_corpus?.overall?.n?.toLocaleString() ?? ''}-fixture history the closing
                line scores {num(marketCorpus.brier, 4)}, so this slice is a representative one.
              </>
            )}
          </p>
        </div>

        <div>
          <h3 className="mb-3 text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
            Is the confidence honest?
          </h3>
          <ReliabilityChart model={pModel?.reliability} market={pMarket?.reliability} />
        </div>
      </div>

      <p className="mt-5 border-t border-[var(--border-color)] pt-3 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        A model can only add value in the space between a constant that ignores the fixture and the
        market price. Anything short of the closing line means no betting edge &mdash; which is why
        value flags stay switched off until a league closes this gap.
      </p>
    </section>
  )
}
