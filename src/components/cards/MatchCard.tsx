'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'

import { BorderBeam } from '@/components/magicui/border-beam'
import { MagicCard } from '@/components/magicui/magic-card'
import { ConfidencePill } from '@/components/primitives/ConfidencePill'
import { LiveBadge } from '@/components/primitives/LiveBadge'
import { TeamBadge } from '@/components/primitives/TeamBadge'
import { cn } from '@/lib/utils'

export interface MatchCardData {
  id: string | number
  homeTeam: { id?: string | number; name: string; color?: string }
  awayTeam: { id?: string | number; name: string; color?: string }
  homeScore?: number | null
  awayScore?: number | null
  minute?: number | string | null
  status?: 'live' | 'upcoming' | 'finished' | 'scheduled'
  /** Kickoff time formatted by caller (e.g. "20:45"). */
  kickoffLabel?: string
  league?: string
  /** Optional model confidence 0..1 for the AI pick. */
  confidence?: number
  /** Optional pick label (e.g. "Arsenal W 62%"). */
  pickLabel?: string
}

interface MatchCardProps {
  match: MatchCardData
  /** Visual variant. `list` is the dense table-row style; `featured` is a hero card with BorderBeam. */
  variant?: 'list' | 'featured' | 'live' | 'upcoming'
  href?: string
  className?: string
}

/**
 * Reusable match card. Wraps a row of team badges, score/kickoff, and an
 * optional AI pick chip. Featured + live variants get magic-ui flair.
 */
export function MatchCard({ match, variant = 'list', href, className }: MatchCardProps) {
  const isLive = variant === 'live' || match.status === 'live'
  const isFeatured = variant === 'featured'

  const body = (
    <div className="relative z-10 flex items-center gap-3 p-4">
      <div className="flex flex-1 flex-col gap-1.5">
        <TeamRow
          team={match.homeTeam}
          score={match.homeScore}
          highlight={
            typeof match.homeScore === 'number' &&
            typeof match.awayScore === 'number' &&
            match.homeScore > match.awayScore
          }
        />
        <TeamRow
          team={match.awayTeam}
          score={match.awayScore}
          highlight={
            typeof match.homeScore === 'number' &&
            typeof match.awayScore === 'number' &&
            match.awayScore > match.homeScore
          }
        />
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        {isLive ? (
          <LiveBadge minute={match.minute ?? undefined} />
        ) : match.kickoffLabel ? (
          <span className="font-mono text-small tabular-nums text-[var(--text-tertiary)]">
            {match.kickoffLabel}
          </span>
        ) : null}
        {match.league ? (
          <span className="text-caption uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            {match.league}
          </span>
        ) : null}
        {match.pickLabel && typeof match.confidence === 'number' ? (
          <ConfidencePill value={match.confidence} compact label={match.pickLabel} />
        ) : null}
      </div>
    </div>
  )

  const inner = isFeatured ? (
    <MagicCard
      gradientFrom="var(--accent-primary)"
      gradientTo="var(--accent-ai)"
      gradientColor="color-mix(in srgb, var(--accent-primary) 10%, transparent)"
      className={cn('relative', className)}
    >
      {body}
      <BorderBeam size={1} duration={10} borderRadius={12} />
    </MagicCard>
  ) : (
    <motion.div
      whileHover={{ y: -1 }}
      className={cn(
        'relative overflow-hidden rounded-xl border bg-[var(--card-bg)] transition-colors',
        isLive
          ? 'border-[var(--accent-loss)]/30 ring-1 ring-[var(--accent-loss)]/12'
          : 'border-[var(--border-color)] hover:border-[var(--border-color-hover)]',
        className
      )}
    >
      {body}
    </motion.div>
  )

  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  )
}

function TeamRow({
  team,
  score,
  highlight,
}: {
  team: MatchCardData['homeTeam']
  score?: number | null
  highlight?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5">
      <TeamBadge teamId={team.id} name={team.name} size={22} teamColor={team.color} />
      <span
        className={cn(
          'flex-1 truncate text-small',
          highlight ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
        )}
      >
        {team.name}
      </span>
      {typeof score === 'number' ? (
        <span
          className={cn(
            'min-w-[1.5rem] text-right font-mono text-h4 tabular-nums',
            highlight ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
          )}
        >
          {score}
        </span>
      ) : null}
    </div>
  )
}
