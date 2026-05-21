'use client'

import { motion } from 'framer-motion'
import { Check, Minus, X } from 'lucide-react'

import { LeagueBadge } from '@/components/match/LeagueBadge'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn, formatPct } from '@/lib/utils'

/**
 * Recent-picks feed — last 20 settled predictions with a green tick
 * (correct) or red cross (incorrect). Designed for the public
 * accuracy page so users can audit individual calls and build trust
 * in the headline number.
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

const winnerLabel: Record<'home' | 'draw' | 'away', (home: string, away: string) => string> = {
  home: (home) => home,
  draw: () => 'Draw',
  away: (_h, away) => away,
}

export function RecentPicksFeed({ picks, className }: RecentPicksFeedProps) {
  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-h4 font-bold text-[var(--text-primary)]">Recent picks</h3>
        <p className="text-[10px] text-[var(--text-tertiary)]">Last {picks.length} settled predictions</p>
      </div>

      {picks.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-[var(--border-color)] text-sm text-[var(--text-tertiary)]">
          No settled predictions to show yet.
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-color)]/40">
          {picks.map((pick, idx) => (
            <PickRow key={pick.match_id ?? idx} pick={pick} idx={idx} />
          ))}
        </div>
      )}
    </Card>
  )
}

function PickRow({ pick, idx }: { pick: RecentPick; idx: number }) {
  const resolved = pick.winner_correct === true
  const wrong = pick.winner_correct === false
  const pending = pick.winner_correct === null || pick.winner_correct === undefined
  const picked = winnerLabel[pick.predicted_winner](pick.home_team, pick.away_team)
  const actual = pick.actual_winner
    ? winnerLabel[pick.actual_winner](pick.home_team, pick.away_team)
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: idx * 0.025, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 py-2.5"
    >
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          resolved && 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40',
          wrong && 'bg-red-500/15 text-red-300 ring-1 ring-red-500/40',
          pending && 'bg-[var(--surface-muted)]/30 text-[var(--text-tertiary)] ring-1 ring-[var(--border-color)]'
        )}
        aria-label={resolved ? 'Correct' : wrong ? 'Incorrect' : 'Pending'}
      >
        {resolved && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        {wrong && <X className="h-3.5 w-3.5" strokeWidth={3} />}
        {pending && <Minus className="h-3.5 w-3.5" strokeWidth={3} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {pick.home_team} <span className="text-[var(--text-tertiary)]">vs</span> {pick.away_team}
          </span>
          <LeagueBadge league={pick.league} size="sm" />
        </div>
        <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
          AI picked <span className="font-semibold text-[var(--text-secondary)]">{picked}</span>
          {pick.predicted_scoreline && (
            <>
              {' '}({pick.predicted_scoreline}, conf {formatPct(pick.confidence, 0)})
            </>
          )}
          {actual && (
            <>
              {' '}
              → finished{' '}
              <span className={cn('font-semibold', resolved ? 'text-emerald-300' : 'text-red-300')}>
                {actual}
              </span>
              {typeof pick.actual_home_goals === 'number' && typeof pick.actual_away_goals === 'number' && (
                <span className="text-[var(--text-tertiary)]"> ({pick.actual_home_goals}-{pick.actual_away_goals})</span>
              )}
            </>
          )}
        </p>
      </div>

      <Badge
        variant="outline"
        className="hidden border-[var(--border-color)] text-[10px] uppercase tracking-wider sm:inline-flex"
      >
        {pick.gender === 'F' ? "Women's" : "Men's"}
      </Badge>
    </motion.div>
  )
}
