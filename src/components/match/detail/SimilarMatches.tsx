'use client'

import { useEffect, useState } from 'react'

import { Library } from 'lucide-react'
import Link from 'next/link'

import { getLeagueAccent } from '@/lib/leagueAccents'

import type { MatchDetails } from './types'

/**
 * Similar matches rail — "Matches that unfolded like this one".
 *
 * Lists finished warehouse matches whose score-state trajectory rhymed
 * with this one, retrieved from `/api/v1/similar/[matchId]`. Honesty
 * rules: renders nothing while loading, on error, or when the match is
 * not in the index (no skeletons, no placeholders); the descriptors under
 * each row are template renderings of exact stored counts (lead changes,
 * comeback depth, goal minutes) — never generated text; no similarity
 * numbers of any kind are shown; rows link to a match page only when one
 * actually exists for that match.
 */

interface NeighborFacts {
  leadChanges: number
  equalizers: number
  comebackDepth: number
  deciderMinute: number
  firstGoalMinute: number
  lastGoalMinute: number
  redsHome: number
  redsAway: number
}

export interface SimilarNeighbor {
  id: string
  home: string
  away: string
  score: string
  competitionId: string
  season: number | null
  date: string
  gender: 'M' | 'F'
  facts: NeighborFacts
  href: string | null
}

/**
 * Up to two terse descriptors built from the neighbour's stored facts.
 * Every clause is a countable claim; minutes are the counted effective
 * minutes of real goals. Exported for tests.
 */
export function describeNeighbor(neighbor: SimilarNeighbor): string[] {
  const { facts } = neighbor
  const [homeGoals, awayGoals] = neighbor.score.split('-').map((s) => Number.parseInt(s, 10))
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return []
  const totalGoals = homeGoals + awayGoals
  const decided = homeGoals !== awayGoals
  const redsTotal = facts.redsHome + facts.redsAway

  const out: string[] = []
  if (decided && facts.comebackDepth >= 2) out.push(`came back from ${facts.comebackDepth} down`)
  else if (decided && facts.comebackDepth === 1) out.push('came from behind')
  else if (!decided && facts.comebackDepth >= 2) out.push(`recovered from ${facts.comebackDepth} down`)

  if (decided && facts.deciderMinute >= 85) out.push(`winner in the ${facts.deciderMinute}'`)
  else if (!decided && totalGoals > 0 && facts.lastGoalMinute >= 85)
    out.push(`leveller in the ${facts.lastGoalMinute}'`)

  if (facts.leadChanges >= 2) out.push(`lead changed ${facts.leadChanges} times`)
  if (redsTotal >= 2) out.push(`${redsTotal} red cards`)
  else if (redsTotal === 1) out.push('a red card')
  if (totalGoals >= 6) out.push(`${totalGoals} goals`)
  if (totalGoals === 0) out.push('goalless')
  else if (facts.firstGoalMinute >= 70) out.push(`goalless until the ${facts.firstGoalMinute}'`)

  return out.slice(0, 2)
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function NeighborRow({ neighbor }: { neighbor: SimilarNeighbor }) {
  const [homeGoals, awayGoals] = neighbor.score.split('-').map((s) => Number.parseInt(s, 10))
  const homeWon = homeGoals > awayGoals
  const awayWon = awayGoals > homeGoals
  const competition = getLeagueAccent(neighbor.competitionId).displayName
  const descriptors = describeNeighbor(neighbor)
  const meta = [competition, ...descriptors].filter(Boolean).join(' · ')

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-[var(--text-secondary)]">
          <span className={homeWon ? 'font-semibold text-[var(--text-primary)]' : undefined}>
            {neighbor.home}
          </span>
          <span className="px-1.5 font-semibold tabular-nums text-[var(--text-primary)]">
            {neighbor.score}
          </span>
          <span className={awayWon ? 'font-semibold text-[var(--text-primary)]' : undefined}>
            {neighbor.away}
          </span>
        </p>
        <p className="truncate text-[11px] text-[var(--text-tertiary)]">{meta}</p>
      </div>
      <span className="ml-3 shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">
        {formatDate(neighbor.date)}
      </span>
    </>
  )

  // Link only when a live match page actually exists — never a dead link.
  if (neighbor.href) {
    return (
      <Link
        href={neighbor.href}
        className="flex min-h-[44px] items-center px-4 py-2.5 transition-colors hover:bg-[var(--muted-bg)]"
      >
        {body}
      </Link>
    )
  }
  return <div className="flex min-h-[44px] items-center px-4 py-2.5">{body}</div>
}

export function SimilarMatches({ match, isFinished }: { match: MatchDetails; isFinished: boolean }) {
  const [neighbors, setNeighbors] = useState<SimilarNeighbor[] | null>(null)

  const ready = isFinished && match.home_score !== null && match.away_score !== null

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (match.leagueId) params.set('league', match.leagueId)
    if (match.date) params.set('date', match.date)
    params.set('home', match.home_team)
    params.set('away', match.away_team)
    fetch(`/api/v1/similar/${encodeURIComponent(match.id)}?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { neighbors?: SimilarNeighbor[] } | null) => {
        if (json && Array.isArray(json.neighbors)) setNeighbors(json.neighbors)
      })
      .catch(() => {
        /* not in the index / offline — render nothing */
      })
    return () => controller.abort()
  }, [ready, match.id, match.leagueId, match.date, match.home_team, match.away_team])

  if (!ready || !neighbors || neighbors.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
        <Library className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Matches that unfolded like this one
        </h3>
      </div>
      <div className="divide-y divide-[var(--border-color)]">
        {neighbors.map((neighbor) => (
          <NeighborRow key={neighbor.id} neighbor={neighbor} />
        ))}
      </div>
    </div>
  )
}
