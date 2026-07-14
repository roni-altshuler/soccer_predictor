'use client'

import { useEffect, useMemo, useState } from 'react'

import { Check, History, Link2 } from 'lucide-react'

import { getLeagueAccent } from '@/lib/leagueAccents'

import type { MatchDetails } from './types'

/**
 * Rarity stamp — an exact-count historical claim about the most dramatic
 * state this match actually reached ("Down 2-0 at the 70th minute — teams in
 * this position have won 16 of 10,412 such matches, 0.2%").
 *
 * Honesty rules: the claim is only rendered when (a) the match verifiably
 * reached a notable deficit that was later overcome or held, (b) the goal
 * events reproduce the final score exactly, and (c) the historical sample
 * has at least MIN_SAMPLE matches. Otherwise this renders nothing at all.
 */

const MIN_SAMPLE = 50
const BOUNDARIES = Array.from({ length: 19 }, (_, i) => i * 5) // 0, 5, …, 90

interface NotableState {
  side: 'home' | 'away'
  bucket: number
  /** Goals for the trailing side at the bucket boundary. */
  own: number
  /** Goals for the opposition at the bucket boundary. */
  opp: number
  deficit: number
}

interface RarityApiResponse {
  n: number
  w: number
  d: number
  l: number
  examples?: Array<{
    match_id: string
    home: string
    away: string
    final_score: string
    date: string
    side: 'home' | 'away'
    outcome: 'w' | 'd'
  }>
}

function isGoalEvent(type: string): boolean {
  return type === 'goal' || type === 'own_goal' || type === 'penalty_goal'
}

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/**
 * Find the largest deficit a non-losing side sat in at a 5-minute boundary
 * (the same grid the artifact counts on): the comeback that was completed
 * (won) or held (drew). Deficits must be 2+ — or 1+ from the 70th minute on —
 * to count as notable; anything less is not worth a claim.
 */
export function detectNotableState(match: MatchDetails): NotableState | null {
  if (match.home_score === null || match.away_score === null) return null

  // Goals credited to the scoring side (own goals included — the payload
  // already attributes them to the side whose score increments).
  const goals = match.events
    .filter((e) => isGoalEvent(e.type as string))
    .map((e) => ({ minute: e.minute + (e.addedTime ?? 0), team: e.team }))
    .sort((a, b) => a.minute - b.minute)

  // Integrity guard: if the event feed does not reproduce the final score,
  // any minute-level claim would be a guess — render nothing instead.
  const homeGoals = goals.filter((g) => g.team === 'home').length
  const awayGoals = goals.length - homeGoals
  if (homeGoals !== match.home_score || awayGoals !== match.away_score) return null

  const outcome = (own: number, opp: number) => (own > opp ? 'w' : own < opp ? 'l' : 'd')

  let best: NotableState | null = null
  for (const side of ['home', 'away'] as const) {
    const ownFinal = side === 'home' ? match.home_score : match.away_score
    const oppFinal = side === 'home' ? match.away_score : match.home_score
    if (outcome(ownFinal, oppFinal) === 'l') continue

    let idx = 0
    let home = 0
    let away = 0
    for (const bucket of BOUNDARIES) {
      while (idx < goals.length && goals[idx].minute <= bucket) {
        if (goals[idx].team === 'home') home += 1
        else away += 1
        idx += 1
      }
      const own = side === 'home' ? home : away
      const opp = side === 'home' ? away : home
      const deficit = opp - own
      const notable = deficit >= 2 || (deficit >= 1 && bucket >= 70)
      if (!notable) continue
      if (!best || deficit > best.deficit || (deficit === best.deficit && bucket > best.bucket)) {
        best = { side, bucket, own, opp, deficit }
      }
    }
  }
  return best
}

export function RarityStamp({ match, isFinished }: { match: MatchDetails; isFinished: boolean }) {
  const [data, setData] = useState<RarityApiResponse | null>(null)
  const [copied, setCopied] = useState(false)

  const state = useMemo(
    () => (isFinished ? detectNotableState(match) : null),
    [match, isFinished]
  )
  const gender = getLeagueAccent(match.leagueId || match.league).gender

  useEffect(() => {
    if (!state) return
    const controller = new AbortController()
    const url = `/api/v1/rarity?gender=${gender}&diff=${-state.deficit}&minute=${state.bucket}&examples=1`
    fetch(url, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: RarityApiResponse | null) => {
        if (json && typeof json.n === 'number') setData(json)
      })
      .catch(() => {
        /* no artifact / offline — render nothing */
      })
    return () => controller.abort()
  }, [state, gender])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  // Hard rules: no notable state, thin sample, or missing artifact → nothing.
  if (!state || !data || data.n < MIN_SAMPLE) return null

  const teamName = state.side === 'home' ? match.home_team : match.away_team
  const ownFinal = state.side === 'home' ? match.home_score : match.away_score
  const oppFinal = state.side === 'home' ? match.away_score : match.home_score
  const verb = ownFinal !== null && oppFinal !== null && ownFinal > oppFinal ? 'won' : 'drew'

  // The artifact clamps diffs at -3, so a 4+ deficit is counted in the
  // "three or more" pool — the sentence must say what was actually counted.
  const positionNoun =
    state.deficit >= 3 ? 'three or more goals down' : state.deficit === 2 ? 'two goals down' : 'a goal down'
  const winPct = ((data.w / data.n) * 100).toFixed(1)
  const precedents = (data.examples ?? []).slice(0, 3)

  const handleCopy = async () => {
    const params = new URLSearchParams({
      down: `${state.opp}-${state.own}`,
      minute: String(state.bucket),
      n: String(data.n),
      w: String(data.w),
      home: match.home_team,
      away: match.away_team,
      hg: String(match.home_score ?? ''),
      ag: String(match.away_score ?? ''),
      league: match.league,
    })
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/api/og/rarity?${params.toString()}`)
      setCopied(true)
    } catch {
      /* clipboard unavailable — leave the button as-is */
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-1.5">
        <History className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Rarity</h3>
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 px-2 text-xs font-medium text-[var(--accent-primary)] transition-opacity hover:opacity-80"
          aria-label="Copy a shareable card link for this stat"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Share card'}
        </button>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">
            Down <span className="tabular-nums">{state.opp}-{state.own}</span> at the {ordinal(state.bucket)} minute
          </span>
          {' — teams '}
          {positionNoun}
          {' at this point have won '}
          <span className="font-semibold tabular-nums text-[var(--text-primary)]">
            {data.w.toLocaleString()} of {data.n.toLocaleString()}
          </span>
          {' such matches ('}
          <span className="font-semibold tabular-nums text-[var(--text-primary)]">{winPct}%</span>
          {').'}
        </p>

        <p className="text-xs text-[var(--text-tertiary)]">
          <span className="font-medium text-[var(--text-secondary)]">{teamName}</span>
          {` ${verb} this one `}
          <span className="tabular-nums">{ownFinal}-{oppFinal}</span>
          {'. '}
          <span className="tabular-nums">
            W {data.w.toLocaleString()} · D {data.d.toLocaleString()} · L {data.l.toLocaleString()}
          </span>
        </p>

        {precedents.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              Precedents
            </p>
            <div className="space-y-1.5">
              {precedents.map((ex) => (
                <div
                  key={`${ex.match_id}-${ex.side}`}
                  className="flex items-center justify-between rounded-lg bg-[var(--muted-bg)] px-3 py-2 text-xs"
                >
                  <span className="min-w-0 truncate text-[var(--text-secondary)]">
                    <span className={ex.side === 'home' ? 'font-semibold text-[var(--text-primary)]' : undefined}>
                      {ex.home}
                    </span>
                    <span className="px-1.5 font-semibold tabular-nums text-[var(--text-primary)]">
                      {ex.final_score}
                    </span>
                    <span className={ex.side === 'away' ? 'font-semibold text-[var(--text-primary)]' : undefined}>
                      {ex.away}
                    </span>
                  </span>
                  <span className="ml-3 shrink-0 tabular-nums text-[var(--text-tertiary)]">
                    {new Date(ex.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
