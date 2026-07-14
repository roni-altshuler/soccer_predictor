'use client'

import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown, Filter, Minus, X } from 'lucide-react'

import { LeagueBadge } from '@/components/match/LeagueBadge'
import { Prob1X2, TeamBadge } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Recent-picks feed — settled predictions rendered as FotMob-grammar
 * fixture rows: status ring, stacked team lines with the final score
 * (winner emphasised), league + date, and the committed 1X2 probabilities
 * on the right with the predicted scoreline chip. The AI zone renders only
 * from real committed probabilities — never fabricated.
 *
 * Filter chips (All / Hits / Misses) sit above the list so users can drill
 * straight into the wrong picks — the most useful audit.
 */

export interface RecentPick {
  match_id: string
  home_team: string
  away_team: string
  league: string
  match_date: string
  predicted_winner: 'home' | 'draw' | 'away'
  actual_winner?: 'home' | 'draw' | 'away' | null
  winner_correct?: boolean | null
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  predicted_scoreline?: string
  actual_home_goals?: number | null
  actual_away_goals?: number | null
  confidence: number
  gender: 'M' | 'F'
}

interface RecentPicksFeedProps {
  picks: RecentPick[]
  className?: string
}

type StatusFilter = 'all' | 'hits' | 'misses'

function shortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function RecentPicksFeed({ picks, className }: RecentPicksFeedProps) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [showAll, setShowAll] = useState(false)

  const counts = useMemo(() => {
    let hits = 0
    let misses = 0
    let pending = 0
    for (const p of picks) {
      if (p.winner_correct === true) hits++
      else if (p.winner_correct === false) misses++
      else pending++
    }
    return { hits, misses, pending, total: picks.length }
  }, [picks])

  const filtered = useMemo(() => {
    if (filter === 'hits') return picks.filter((p) => p.winner_correct === true)
    if (filter === 'misses') return picks.filter((p) => p.winner_correct === false)
    return picks
  }, [picks, filter])

  const visible = showAll ? filtered : filtered.slice(0, 10)

  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3 md:px-5">
        <div>
          <h3 className="text-h4 font-bold text-[var(--text-primary)]">Recent picks</h3>
          <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
            {counts.total > 0 ? (
              <>
                <span className="text-[var(--accent-primary)]">{counts.hits} hits</span> ·{' '}
                <span className="text-[var(--accent-loss)]">{counts.misses} misses</span>
                {counts.pending > 0 && (
                  <>
                    {' '}·{' '}
                    <span className="text-[var(--text-tertiary)]">{counts.pending} pending</span>
                  </>
                )}
              </>
            ) : (
              <>Last settled predictions appear here as matches finish</>
            )}
          </p>
        </div>

        {/* Filter chips */}
        <div
          role="tablist"
          aria-label="Filter recent picks"
          className="inline-flex items-center gap-0.5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]/70 p-0.5"
        >
          {(
            [
              { value: 'all' as const, label: 'All', count: counts.total },
              { value: 'hits' as const, label: 'Hits', count: counts.hits, tone: 'primary' as const },
              { value: 'misses' as const, label: 'Misses', count: counts.misses, tone: 'loss' as const },
            ]
          ).map((f) => (
            <button
              key={f.value}
              role="tab"
              type="button"
              aria-selected={filter === f.value}
              onClick={() => {
                setFilter(f.value)
                setShowAll(false)
              }}
              className={cn(
                'flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors',
                filter === f.value
                  ? f.tone === 'primary'
                    ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                    : f.tone === 'loss'
                      ? 'bg-[var(--accent-loss)]/15 text-[var(--accent-loss)]'
                      : 'bg-[var(--accent-ai)]/15 text-[var(--accent-ai)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              )}
            >
              {filter === f.value && <Filter className="h-2.5 w-2.5" aria-hidden="true" />}
              {f.label}
              <span className="tabular-nums opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Rows */}
      {picks.length === 0 ? (
        <div className="flex h-32 items-center justify-center px-4 text-sm text-[var(--text-tertiary)]">
          No settled predictions to show yet.
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-24 items-center justify-center px-4 text-sm text-[var(--text-tertiary)]">
          No picks match this filter.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-color)]/60">
          {visible.map((pick, idx) => (
            <li key={pick.match_id ?? idx}>
              <PickRow pick={pick} idx={idx} />
            </li>
          ))}
        </ul>
      )}

      {/* Show more / less */}
      {filtered.length > 10 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="flex min-h-[44px] w-full items-center justify-center gap-1 border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] font-semibold text-[var(--text-tertiary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', showAll && 'rotate-180')}
            aria-hidden="true"
          />
          {showAll ? 'Show fewer' : `Show ${filtered.length - 10} more`}
        </button>
      )}
    </Card>
  )
}

function TeamLine({
  name,
  score,
  emphasis,
}: {
  name: string
  score: number | null
  emphasis: 'winner' | 'loser' | 'neutral'
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <TeamBadge name={name} size={18} className="shrink-0" />
      <span
        className={cn(
          'min-w-0 truncate text-[13px]',
          emphasis === 'winner'
            ? 'font-semibold text-[var(--text-primary)]'
            : emphasis === 'loser'
              ? 'font-medium text-[var(--text-tertiary)]'
              : 'font-medium text-[var(--text-primary)]'
        )}
      >
        {name}
      </span>
      {score !== null && (
        <span
          className={cn(
            'ml-auto shrink-0 pl-2 text-[13px] font-bold tabular-nums',
            emphasis === 'loser' ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'
          )}
        >
          {score}
        </span>
      )}
    </div>
  )
}

function PickRow({ pick, idx }: { pick: RecentPick; idx: number }) {
  const reduce = useReducedMotion()
  const isHit = pick.winner_correct === true
  const isMiss = pick.winner_correct === false
  const isPending = !isHit && !isMiss

  const homeScore = typeof pick.actual_home_goals === 'number' ? pick.actual_home_goals : null
  const awayScore = typeof pick.actual_away_goals === 'number' ? pick.actual_away_goals : null
  const haveScore = homeScore !== null && awayScore !== null

  let homeEmphasis: 'winner' | 'loser' | 'neutral' = 'neutral'
  let awayEmphasis: 'winner' | 'loser' | 'neutral' = 'neutral'
  if (haveScore && homeScore !== awayScore) {
    homeEmphasis = homeScore > awayScore ? 'winner' : 'loser'
    awayEmphasis = awayScore > homeScore ? 'winner' : 'loser'
  }

  const hasProbs =
    Number.isFinite(pick.predicted_home_win) &&
    Number.isFinite(pick.predicted_draw) &&
    Number.isFinite(pick.predicted_away_win) &&
    pick.predicted_home_win + pick.predicted_draw + pick.predicted_away_win > 0

  const hasScorelinePick =
    typeof pick.predicted_scoreline === 'string' && pick.predicted_scoreline.length > 0

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: idx * 0.02, ease: [0.22, 1, 0.36, 1] }}
      className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 md:px-5"
    >
      {/* Status ring */}
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isHit &&
            'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/30',
          isMiss &&
            'bg-[var(--accent-loss)]/12 text-[var(--accent-loss)] ring-1 ring-[var(--accent-loss)]/30',
          isPending && 'bg-[var(--muted-bg)] text-[var(--text-tertiary)] ring-1 ring-[var(--border-color)]'
        )}
        role="img"
        aria-label={isHit ? 'Correct pick' : isMiss ? 'Missed pick' : 'Pending result'}
      >
        {isHit && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        {isMiss && <X className="h-3.5 w-3.5" strokeWidth={3} />}
        {isPending && <Minus className="h-3.5 w-3.5" strokeWidth={3} />}
      </div>

      {/* Stacked team lines with the final score */}
      <div className="min-w-0 flex-1 space-y-1 border-l border-[var(--border-color)]/60 py-0.5 pl-3">
        <TeamLine name={pick.home_team} score={homeScore} emphasis={homeEmphasis} />
        <TeamLine name={pick.away_team} score={awayScore} emphasis={awayEmphasis} />
      </div>

      {/* League + date */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <LeagueBadge league={pick.league} size="sm" />
        <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">
          {shortDate(pick.match_date)}
        </span>
      </div>

      {/* AI zone — committed probabilities + scoreline pick */}
      {hasProbs && (
        <div className="flex shrink-0 items-center gap-2">
          <Prob1X2
            home={pick.predicted_home_win}
            draw={pick.predicted_draw}
            away={pick.predicted_away_win}
            className="hidden sm:flex"
          />
          <Prob1X2
            home={pick.predicted_home_win}
            draw={pick.predicted_draw}
            away={pick.predicted_away_win}
            compact
            className="sm:hidden"
          />
          {hasScorelinePick && (
            <span className="hidden shrink-0 items-center rounded-md bg-[var(--accent-ai)]/10 px-1.5 py-1 text-[10px] font-semibold tabular-nums text-[var(--accent-ai)] lg:inline-flex">
              AI {pick.predicted_scoreline}
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
}
