'use client'

import { useMemo, useState } from 'react'

interface GroupWhatIfExplorerProps {
  groupId: string
  remainingMatches: Array<{
    matchId: string
    homeTeam: { id: string; name: string }
    awayTeam: { id: string; name: string }
    kickoff: string
  }>
  baselineTeams: Array<{ teamId: string; name: string; pAdvanceEither: number }>
}

type WhatIfTeam = {
  team_id: number | null
  name: string
  p_advance_first: number
  p_advance_second: number
  p_advance_either: number
  p_eliminated: number
  expected_points: number
  expected_gd: number
  current_points: number
  current_gf: number
  current_ga: number
  current_played: number
}

type WhatIfResponse = {
  group_id: string
  generated_at: string
  n_simulations: number
  teams: WhatIfTeam[]
  forced_results?: Record<string, [number, number]>
  error?: string
}

type ScoreInput = { home: string; away: string }

const COLORS = {
  bg: 'var(--background)',
  card: 'var(--card-bg)',
  border: 'var(--border-color)',
  accent: 'var(--accent-market)',
  positive: 'var(--accent-primary)',
  negative: 'var(--accent-loss)',
  muted: 'var(--text-tertiary)',
}

function parseGoal(value: string): number | null {
  if (value === '' || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 20) return null
  return Math.floor(n)
}

export default function GroupWhatIfExplorer({
  groupId,
  remainingMatches,
  baselineTeams,
}: GroupWhatIfExplorerProps) {
  const [inputs, setInputs] = useState<Record<string, ScoreInput>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WhatIfResponse | null>(null)

  const baselineByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of baselineTeams) map.set(t.name, t.pAdvanceEither)
    return map
  }, [baselineTeams])

  const forcedReady = useMemo(() => {
    return Object.entries(inputs).filter(([, v]) => {
      const h = parseGoal(v?.home ?? '')
      const a = parseGoal(v?.away ?? '')
      return h !== null && a !== null
    }).length
  }, [inputs])

  const setField = (matchId: string, side: 'home' | 'away', value: string) => {
    setInputs((prev) => ({
      ...prev,
      [matchId]: { home: '', away: '', ...prev[matchId], [side]: value },
    }))
  }

  const clearRow = (matchId: string) => {
    setInputs((prev) => {
      const next = { ...prev }
      delete next[matchId]
      return next
    })
  }

  const resetAll = () => {
    setInputs({})
    setResult(null)
    setError(null)
  }

  const runScenario = async () => {
    setLoading(true)
    setError(null)
    try {
      const forcedResults: Record<string, [number, number]> = {}
      for (const [matchId, v] of Object.entries(inputs)) {
        const h = parseGoal(v?.home ?? '')
        const a = parseGoal(v?.away ?? '')
        if (h !== null && a !== null) {
          forcedResults[matchId] = [h, a]
        }
      }
      const res = await fetch(`/api/world-cup/groups/${encodeURIComponent(groupId)}/what-if`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forcedResults }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail?.detail || detail?.error || `Request failed (${res.status})`)
      }
      const data = (await res.json()) as WhatIfResponse
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const deltas = useMemo(() => {
    if (!result) return []
    return result.teams
      .map((t) => {
        const base = baselineByName.get(t.name) ?? 0
        return {
          name: t.name,
          baseline: base,
          scenario: t.p_advance_either,
          delta: t.p_advance_either - base,
        }
      })
      .sort((a, b) => b.delta - a.delta)
  }, [result, baselineByName])

  const maxAbsDelta = useMemo(() => {
    if (deltas.length === 0) return 0
    return Math.max(0.01, ...deltas.map((d) => Math.abs(d.delta)))
  }, [deltas])

  if (remainingMatches.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          Scenario explorer
        </h2>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          All group matches have been played — nothing left to simulate.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            Scenario explorer
          </h2>
          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            Lock in hypothetical scorelines for any remaining match and re-run the simulator.
          </p>
        </div>
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--accent-market)]">
          What-if · AI
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {remainingMatches.map((m) => {
          const row = inputs[m.matchId] ?? { home: '', away: '' }
          return (
            <div
              key={m.matchId}
              className="flex flex-col gap-2 rounded-md border border-[var(--border-color)] bg-[var(--background)] p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="font-bold text-[var(--text-primary)]">
                  {m.homeTeam.name} <span className="text-[var(--text-tertiary)]">vs</span> {m.awayTeam.name}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                  {m.kickoff ? new Date(m.kickoff).toLocaleString() : 'TBD'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20}
                  placeholder="H"
                  value={row.home}
                  onChange={(e) => setField(m.matchId, 'home', e.target.value)}
                  className="w-14 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5 text-center font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-market)]"
                  aria-label={`${m.homeTeam.name} goals`}
                />
                <span className="text-[var(--text-tertiary)]">–</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20}
                  placeholder="A"
                  value={row.away}
                  onChange={(e) => setField(m.matchId, 'away', e.target.value)}
                  className="w-14 rounded-md border border-[var(--border-color)] bg-[var(--input-bg)] px-2 py-1.5 text-center font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-market)]"
                  aria-label={`${m.awayTeam.name} goals`}
                />
                <button
                  type="button"
                  onClick={() => clearRow(m.matchId)}
                  className="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
                >
                  Clear
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="sticky bottom-2 z-10 mt-4 flex flex-col gap-2 rounded-md border border-[var(--border-color)] bg-[var(--background)]/95 p-2 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-[var(--text-secondary)]">
          {forcedReady} match{forcedReady === 1 ? '' : 'es'} forced
          {loading ? ' · running simulation…' : ''}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={resetAll}
            disabled={loading}
            className="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={runScenario}
            disabled={loading || forcedReady === 0}
            className="flex items-center gap-2 rounded-md bg-[var(--accent-market)] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <span
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden
                />
                Simulating…
              </>
            ) : (
              'Simulate scenario'
            )}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-[var(--accent-loss)]/40 bg-[var(--accent-loss)]/10 p-3 text-xs text-[var(--accent-loss)]">
          {error}
        </div>
      ) : null}

      {result && !error ? (
        <div className="mt-4 rounded-md border border-[var(--border-color)] bg-[var(--background)] p-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              Advancement Δ vs baseline
            </h3>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {result.n_simulations.toLocaleString()} sims
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {deltas.map((d) => {
              const widthPct = Math.min(100, (Math.abs(d.delta) / maxAbsDelta) * 50)
              const positive = d.delta >= 0
              return (
                <li key={d.name} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[var(--text-primary)]">{d.name}</span>
                    <span className="font-mono text-[var(--text-secondary)]">
                      {(d.baseline * 100).toFixed(1)}% →{' '}
                      <span className="text-[var(--text-primary)]">{(d.scenario * 100).toFixed(1)}%</span>
                      <span
                        className="ml-2 font-bold"
                        style={{ color: positive ? COLORS.positive : COLORS.negative }}
                      >
                        {positive ? '+' : ''}
                        {(d.delta * 100).toFixed(1)} pp
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 flex h-2 w-full overflow-hidden rounded-sm bg-[var(--card-bg)]">
                    <div className="flex w-1/2 justify-end">
                      {!positive ? (
                        <div
                          className="h-full"
                          style={{ width: `${widthPct}%`, backgroundColor: COLORS.negative }}
                        />
                      ) : null}
                    </div>
                    <div className="w-px bg-[var(--border-color)]" />
                    <div className="flex w-1/2 justify-start">
                      {positive ? (
                        <div
                          className="h-full"
                          style={{ width: `${widthPct}%`, backgroundColor: COLORS.positive }}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
