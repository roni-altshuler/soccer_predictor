'use client'

import { useEffect, useMemo, useState } from 'react'

interface BettingIntelligenceProps {
  matchId: string
  leagueId?: string
  modelProbs: { homeWin: number; draw: number; awayWin: number }
  kickoff: string
  status: string
}

interface LiveOddsEdge {
  outcome: 'home_win' | 'draw' | 'away_win'
  market_probability: number
  model_probability?: number
  fair_decimal_odds: number
  edge?: number
  label: string
}

interface LiveOddsPayload {
  no_vig_probabilities: { home_win: number; draw: number; away_win: number }
  edges: LiveOddsEdge[]
}

type RowKey = 'home_win' | 'draw' | 'away_win'
type EdgeLabel = 'value' | 'lean' | 'none'

const DISCLAIMER =
  'Informational only. Probabilities are model estimates, not guarantees. Do not bet on this match.'

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function pctString(value: number, decimals = 1): string {
  return `${(clamp01(value) * 100).toFixed(decimals)}%`
}

function ppString(value: number): string {
  const pp = value * 100
  const sign = pp > 0 ? '+' : ''
  return `${sign}${pp.toFixed(1)}pp`
}

function classifyEdge(edgePp: number): EdgeLabel {
  if (edgePp >= 4) return 'value'
  if (edgePp >= 1.5) return 'lean'
  return 'none'
}

function edgeStyle(label: EdgeLabel): { color: string; background: string; border: string } {
  if (label === 'value') return { color: 'var(--accent-market-soft)', background: 'color-mix(in srgb, var(--accent-market) 18%, transparent)', border: 'color-mix(in srgb, var(--accent-market) 55%, transparent)' }
  if (label === 'lean') return { color: 'var(--text-secondary)', background: 'color-mix(in srgb, var(--text-tertiary) 12%, transparent)', border: 'color-mix(in srgb, var(--text-tertiary) 35%, transparent)' }
  return { color: 'var(--text-tertiary)', background: 'color-mix(in srgb, var(--text-tertiary) 8%, transparent)', border: 'color-mix(in srgb, var(--text-tertiary) 22%, transparent)' }
}

function isFinalStatus(status: string): boolean {
  const s = (status || '').toUpperCase()
  return ['FT', 'AET', 'PEN', 'POST', 'POSTPONED', 'CANCELLED', 'CANCELED', 'STATUS_FINAL', 'FINISHED'].some((tag) => s.includes(tag))
}

export default function BettingIntelligence({ matchId, leagueId, modelProbs, status }: BettingIntelligenceProps) {
  const [loading, setLoading] = useState(true)
  const [providerDisabled, setProviderDisabled] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [payload, setPayload] = useState<LiveOddsPayload | null>(null)

  const skip = isFinalStatus(status) || !matchId
  const normalizedModel = useMemo(
    () => ({
      home_win: clamp01(modelProbs?.homeWin ?? 0),
      draw: clamp01(modelProbs?.draw ?? 0),
      away_win: clamp01(modelProbs?.awayWin ?? 0),
    }),
    [modelProbs?.homeWin, modelProbs?.draw, modelProbs?.awayWin],
  )

  useEffect(() => {
    if (skip) { setLoading(false); return }
    let cancelled = false
    const controller = new AbortController()
    async function load() {
      setLoading(true); setErrorMessage(null); setProviderDisabled(false)
      try {
        const params = new URLSearchParams()
        params.set('eventId', matchId)
        if (leagueId) params.set('league', leagueId)
        params.set('model_home', String(normalizedModel.home_win))
        params.set('model_draw', String(normalizedModel.draw))
        params.set('model_away', String(normalizedModel.away_win))
        const res = await fetch(`/api/market-intelligence/live?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.status === 501 || body?.configured === false || body?.provider_disabled === true) {
          setProviderDisabled(true); setPayload(null); return
        }
        if (!res.ok) {
          setErrorMessage(typeof body?.error === 'string' ? body.error : 'Live odds unavailable.')
          setPayload(null); return
        }
        const events = Array.isArray(body?.events) ? body.events : []
        const match = events.find((event: { id?: string }) => event?.id === matchId) || events[0]
        const intel = match?.market_intelligence
        if (intel?.no_vig_probabilities && Array.isArray(intel?.edges)) {
          setPayload({ no_vig_probabilities: intel.no_vig_probabilities, edges: intel.edges })
        } else {
          setProviderDisabled(true); setPayload(null)
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === 'AbortError')) return
        setErrorMessage('Live odds unavailable.'); setPayload(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true; controller.abort() }
  }, [matchId, leagueId, normalizedModel, skip])

  if (skip) return null

  const rows: Array<{ key: RowKey; label: string }> = [
    { key: 'home_win', label: 'Home' },
    { key: 'draw', label: 'Draw' },
    { key: 'away_win', label: 'Away' },
  ]
  const showFallback = providerDisabled || (!loading && !payload && !!errorMessage)
  const gridCols = 'grid grid-cols-[1fr_minmax(60px,auto)_minmax(60px,auto)_minmax(72px,auto)_minmax(70px,auto)] items-center gap-2'

  return (
    <section
      className="fm-card overflow-hidden"
      style={{ background: 'var(--card-bg)', borderColor: 'color-mix(in srgb, var(--accent-market) 32%, var(--border-color))' }}
      aria-label="Betting intelligence"
    >
      <header className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent-market)' }} />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Betting Intelligence</h3>
        <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">model vs market (no-vig)</span>
      </header>

      <div className="p-4 space-y-3" style={{ background: 'var(--card-bg)' }}>
        {loading && <p className="text-xs text-[var(--text-tertiary)]">Loading market data…</p>}

        {!loading && showFallback && (
          <div className="rounded-xl p-3" style={{ background: 'var(--muted-bg)', border: '1px dashed var(--border-color)' }}>
            <p className="text-xs text-[var(--text-secondary)]">Live odds unavailable. Showing model probabilities only.</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
              {rows.map((row) => (
                <div key={row.key} className="rounded-lg py-2" style={{ background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}>
                  <p className="text-[10px] text-[var(--text-tertiary)] uppercase">{row.label}</p>
                  <p className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">{pctString(normalizedModel[row.key], 1)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && payload && (
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--muted-bg)', border: '1px solid var(--border-color)' }}>
            <div className={`${gridCols} px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] border-b`} style={{ borderColor: 'var(--border-color)' }}>
              <span>Outcome</span>
              <span className="text-right">Model</span>
              <span className="text-right">Market</span>
              <span className="text-right">Edge</span>
              <span className="text-right">Kelly</span>
            </div>
            {rows.map((row) => {
              const edge = payload.edges.find((e) => e.outcome === row.key)
              const marketProb = clamp01(edge?.market_probability ?? payload.no_vig_probabilities[row.key] ?? 0)
              const modelProb = clamp01(edge?.model_probability ?? normalizedModel[row.key])
              const edgeFraction = edge?.edge ?? (modelProb - marketProb)
              const edgePp = edgeFraction * 100
              const decimalOdds = edge?.fair_decimal_odds && edge.fair_decimal_odds > 1
                ? edge.fair_decimal_odds
                : marketProb > 0 ? 1 / marketProb : 0
              const kelly = decimalOdds > 1 && edgeFraction > 0
                ? Math.max(0, Math.min(0.25, edgeFraction / (decimalOdds - 1)))
                : 0
              const label = classifyEdge(edgePp)
              const style = edgeStyle(label)
              return (
                <div key={row.key} className={`${gridCols} px-3 py-2 text-xs border-b last:border-b-0`} style={{ borderColor: 'var(--border-color)' }}>
                  <span className="font-semibold text-[var(--text-primary)]">{row.label}</span>
                  <span className="text-right tabular-nums text-[var(--text-secondary)]">{pctString(modelProb)}</span>
                  <span className="text-right tabular-nums text-[var(--text-secondary)]">{pctString(marketProb)}</span>
                  <span className="flex justify-end">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
                      style={{ color: style.color, background: style.background, border: `1px solid ${style.border}` }}
                      title={`${label} edge`}
                    >
                      {ppString(edgeFraction)}
                    </span>
                  </span>
                  <span className="flex justify-end">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
                      style={{ color: 'var(--accent-market-soft)', background: 'color-mix(in srgb, var(--accent-market) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-market) 35%, transparent)' }}
                    >
                      {kelly.toFixed(2)}u
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">{DISCLAIMER}</p>
      </div>
    </section>
  )
}
