'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import SeasonSimulator from '@/components/prediction/SeasonSimulator'

interface TeamSearchResult { name: string; league: string }

interface PredictionResult {
  success?: boolean
  predictions?: { home_win?: number; draw?: number; away_win?: number }
  home_team?: string; away_team?: string
  home_league?: string; away_league?: string
  is_cross_league?: boolean
  predicted_home_goals?: number; predicted_away_goals?: number
  confidence?: number
  ratings?: { home_elo: number; away_elo: number; elo_difference: number }
  analysis?: { predicted_winner: string; home_advantage_applied: boolean; factors_considered: string[]; note: string }
  error?: string
}

function TeamSearchInput({
  label, value, onSelect, placeholder, icon
}: {
  label: string; value: { name: string; league: string } | null
  onSelect: (team: { name: string; league: string } | null) => void
  placeholder: string; icon: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TeamSearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const searchTeams = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/search-teams?q=${encodeURIComponent(q)}`)
      if (res.ok) { const data = await res.json(); setResults(data.teams || []) }
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { if (query && !value) searchTeams(query) }, 300)
    return () => clearTimeout(timer)
  }, [query, value, searchTeams])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) && !inputRef.current?.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">{label}</label>
      {value ? (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)]">
          <span className="text-lg">{icon}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{value.name}</p>
            <p className="text-[10px] text-[var(--text-tertiary)]">{value.league}</p>
          </div>
          <button onClick={() => { onSelect(null); setQuery(''); setResults([]) }} className="p-1 rounded hover:bg-[var(--card-hover)] text-[var(--text-tertiary)]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-lg">{icon}</div>
          <input
            ref={inputRef} type="text" value={query}
            onChange={(e) => { setQuery(e.target.value); setIsOpen(true) }}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-ai)] focus:border-[var(--accent-ai)]"
          />
          {loading && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[var(--accent-ai)] border-t-transparent rounded-full animate-spin" />}
        </div>
      )}
      {isOpen && results.length > 0 && !value && (
        <div ref={dropdownRef} className="absolute z-50 w-full mt-1 max-h-48 overflow-y-auto rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] shadow-xl">
          {results.map((team, idx) => (
            <button key={`${team.name}-${idx}`} onClick={() => { onSelect(team); setQuery(''); setResults([]); setIsOpen(false) }}
              className="w-full px-3 py-2 flex items-center gap-2 hover:bg-[var(--card-hover)] text-left text-sm">
              <span className="text-xs">⚽</span>
              <div><p className="text-[var(--text-primary)] font-medium">{team.name}</p><p className="text-[10px] text-[var(--text-tertiary)]">{team.league}</p></div>
            </button>
          ))}
        </div>
      )}
      {isOpen && query.length >= 2 && results.length === 0 && !loading && !value && (
        <div className="absolute z-50 w-full mt-1 p-3 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] text-center text-xs text-[var(--text-tertiary)]">
          No teams found
        </div>
      )}
    </div>
  )
}

function PredictPageContent() {
  const [activeTab, setActiveTab] = useState<'match' | 'season'>('match')
  const [homeTeam, setHomeTeam] = useState<{ name: string; league: string } | null>(null)
  const [awayTeam, setAwayTeam] = useState<{ name: string; league: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PredictionResult | null>(null)

  useEffect(() => { setResult(null) }, [homeTeam, awayTeam])

  const handlePredict = async () => {
    if (!homeTeam || !awayTeam) return
    if (homeTeam.name === awayTeam.name) { setResult({ error: 'Please select different teams' }); return }
    setLoading(true); setResult(null)
    try {
      const response = await fetch('/api/predict/any-teams', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ home_team: homeTeam.name, away_team: awayTeam.name, home_league: homeTeam.league, away_league: awayTeam.league }),
      })
      if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || 'Prediction failed') }
      setResult(await response.json())
    } catch (error) { setResult({ error: error instanceof Error ? error.message : 'Prediction failed' }) }
    finally { setLoading(false) }
  }

  const canPredict = homeTeam && awayTeam && homeTeam.name !== awayTeam.name

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Tab Switcher */}
      <div className="sticky top-12 md:top-14 z-40 bg-[var(--nav-bg)] border-b border-[var(--border-color)] backdrop-blur-md">
        <div className="max-w-2xl mx-auto flex">
          {(['match', 'season'] as const).map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                activeTab === t
                  ? 'border-[var(--accent-ai)] text-[var(--accent-ai)]'
                  : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              }`}>
              {t === 'match' ? '🎯 Match Predictor' : '🏆 Season Simulator'}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {activeTab === 'season' ? <SeasonSimulator /> : (
          <>
            {/* Team Selection Card */}
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 mb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TeamSearchInput label="Home Team" value={homeTeam} onSelect={setHomeTeam} placeholder="Search home team..." icon="🏠" />
                <TeamSearchInput label="Away Team" value={awayTeam} onSelect={setAwayTeam} placeholder="Search away team..." icon="✈️" />
              </div>

              {homeTeam && awayTeam && homeTeam.league !== awayTeam.league && (
                <div className="mt-3 text-center text-[10px] text-amber-500 font-medium">🌍 Cross-league: {homeTeam.league} vs {awayTeam.league}</div>
              )}

              <button onClick={handlePredict} disabled={loading || !canPredict}
                className="w-full mt-4 py-3 rounded-lg font-semibold text-sm text-white bg-[var(--accent-ai)] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2">
                {loading ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Analyzing...</>
                ) : (
                  <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v4" /><path d="M20 12h-4" /><path d="M12 18v4" /><path d="M4 12h4" /></svg> Get AI Prediction</>
                )}
              </button>
            </div>

            {/* Results */}
            {result && !result.error && result.predictions && (() => {
              const hWin = (result.predictions.home_win || 0) * 100
              const d = (result.predictions.draw || 0) * 100
              const aWin = (result.predictions.away_win || 0) * 100
              let winner = { team: 'Draw', prob: d }
              if (hWin > d && hWin > aWin) winner = { team: result.home_team || '', prob: hWin }
              else if (aWin > d && aWin > hWin) winner = { team: result.away_team || '', prob: aWin }

              return (
                <div className="space-y-3 animate-fade-in">
                  {/* Scoreline Card */}
                  <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] overflow-hidden">
                    <div className="px-4 py-3 bg-[var(--accent-ai)]/10 border-b border-[var(--accent-ai)]/20 text-center">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-ai)]">AI Prediction</span>
                    </div>
                    <div className="p-6">
                      <div className="flex items-center justify-center gap-6">
                        <div className="text-center flex-1">
                          <p className="text-xs text-[var(--text-tertiary)] mb-0.5">{result.home_league}</p>
                          <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">{result.home_team}</p>
                          <span className="text-4xl font-bold text-[var(--text-primary)]">{result.predicted_home_goals?.toFixed(0) || '-'}</span>
                        </div>
                        <span className="text-lg text-[var(--text-tertiary)]">-</span>
                        <div className="text-center flex-1">
                          <p className="text-xs text-[var(--text-tertiary)] mb-0.5">{result.away_league}</p>
                          <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">{result.away_team}</p>
                          <span className="text-4xl font-bold text-[var(--text-primary)]">{result.predicted_away_goals?.toFixed(0) || '-'}</span>
                        </div>
                      </div>
                      <div className="text-center mt-4">
                        <span className="text-xs text-[var(--text-tertiary)]">Predicted winner:</span>
                        <p className="text-sm font-bold text-[var(--accent-ai)]">{winner.team} ({winner.prob.toFixed(1)}%)</p>
                      </div>
                    </div>
                  </div>

                  {/* Probability Bars */}
                  <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Win Probability</p>
                    {[
                      { label: result.home_team || 'Home', pct: hWin, color: 'bg-green-500' },
                      { label: 'Draw', pct: d, color: 'bg-amber-500' },
                      { label: result.away_team || 'Away', pct: aWin, color: 'bg-red-500' },
                    ].map((bar) => (
                      <div key={bar.label} className="mb-2.5 last:mb-0">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-[var(--text-primary)] font-medium">{bar.label}</span>
                          <span className="font-bold text-[var(--text-primary)]">{bar.pct.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-[var(--muted-bg)] rounded-full overflow-hidden">
                          <div className={`h-full ${bar.color} rounded-full transition-all duration-700`} style={{ width: `${bar.pct}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ELO & Analysis */}
                  {result.ratings && (
                    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">ELO Ratings</p>
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="p-2.5 rounded-lg bg-[var(--muted-bg)]">
                          <p className="text-lg font-bold text-[var(--text-primary)]">{result.ratings.home_elo}</p>
                          <p className="text-[10px] text-[var(--text-tertiary)]">{result.home_team}</p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[var(--muted-bg)]">
                          <p className={`text-lg font-bold ${result.ratings.elo_difference >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {result.ratings.elo_difference >= 0 ? '+' : ''}{result.ratings.elo_difference}
                          </p>
                          <p className="text-[10px] text-[var(--text-tertiary)]">Difference</p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-[var(--muted-bg)]">
                          <p className="text-lg font-bold text-[var(--text-primary)]">{result.ratings.away_elo}</p>
                          <p className="text-[10px] text-[var(--text-tertiary)]">{result.away_team}</p>
                        </div>
                      </div>
                      {result.confidence && (
                        <div className="mt-3">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-[var(--text-tertiary)]">Model Confidence</span>
                            <span className="font-semibold text-[var(--accent-ai)]">{result.confidence.toFixed(0)}%</span>
                          </div>
                          <div className="h-1.5 bg-[var(--muted-bg)] rounded-full overflow-hidden">
                            <div className="h-full bg-[var(--accent-ai)] rounded-full" style={{ width: `${result.confidence}%` }} />
                          </div>
                        </div>
                      )}
                      {result.analysis?.factors_considered && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {result.analysis.factors_considered.map((f, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full bg-[var(--muted-bg)] text-[10px] text-[var(--text-tertiary)]">{f}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-center text-[10px] text-[var(--text-tertiary)] py-2">
                    ⚠️ Predictions are for educational/entertainment purposes only.
                  </p>
                </div>
              )
            })()}

            {result?.error && (
              <div className="bg-[var(--card-bg)] rounded-xl border border-red-500/30 p-4 flex items-center gap-3">
                <span className="text-lg">❌</span>
                <div><p className="text-sm font-semibold text-[var(--text-primary)]">Prediction Failed</p><p className="text-xs text-[var(--text-secondary)]">{result.error}</p></div>
              </div>
            )}

            {/* How It Works — only shown when no result */}
            {!result && (
              <div className="mt-6">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3 px-1">How It Works</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { icon: '📈', title: 'ELO Ratings', desc: 'Dynamic ratings updated after every match' },
                    { icon: '🧠', title: 'Neural Ensemble', desc: '7-model stack with 66 features per match' },
                    { icon: '🌍', title: 'Cross-League', desc: 'League strength coefficients for comparisons' },
                  ].map((item) => (
                    <div key={item.title} className="bg-[var(--card-bg)] rounded-lg border border-[var(--border-color)] p-3 text-center">
                      <span className="text-xl block mb-1">{item.icon}</span>
                      <p className="text-xs font-semibold text-[var(--text-primary)] mb-0.5">{item.title}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)]">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function PredictPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[var(--accent-ai)] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <PredictPageContent />
    </Suspense>
  )
}
