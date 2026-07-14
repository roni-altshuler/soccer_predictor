'use client'

import { Fragment } from 'react'

import { TeamBadge } from '@/components/primitives'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Standing } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
  ordinal,
  zoneForPosition,
  ZONE_COLOR,
  ZONE_LABEL,
  type TeamMeta,
} from './shared'

/**
 * PositionDistributionMatrix — the signature season-simulation grid:
 * teams (rows, ordered by average final position) × final position
 * (columns 1…N). Cell intensity is proportional to how often the team
 * finished in that position across the simulated seasons; each team's
 * modal finish is outlined. Finishing-zone bands (title / Champions
 * League / Europa / relegation) tint the column headers with hairline
 * separators at the zone edges. FiveThirtyEight grammar, Matchday tokens.
 */

const LABEL_COL = 'minmax(148px, 172px)'

function zoneBoundaries(numTeams: number): Set<number> {
  // Hairline drawn on the LEFT edge of these 1-based positions.
  const bounds = new Set<number>([2, 5])
  if (numTeams > 10) bounds.add(8)
  bounds.add(numTeams - 2)
  return bounds
}

function cellFill(prob: number, maxProb: number): string {
  if (prob <= 0) return 'color-mix(in srgb, var(--muted-bg) 45%, transparent)'
  const t = maxProb > 0 ? prob / maxProb : 0
  return `color-mix(in srgb, var(--accent-ai) ${Math.round(Math.max(4, t * 82))}%, var(--card-bg))`
}

interface DistributionCellProps {
  teamName: string
  position: number
  probability: number
  maxProb: number
  isPeak: boolean
  hasBoundary: boolean
}

function DistributionCell({
  teamName,
  position,
  probability,
  maxProb,
  isPeak,
  hasBoundary,
}: DistributionCellProps) {
  const t = maxProb > 0 ? probability / maxProb : 0
  const label = `${teamName} — ${ordinal(position)} in ${(probability * 100).toFixed(probability >= 0.095 ? 0 : 1)}% of simulations`

  const cell = (
    <div
      role="cell"
      aria-label={label}
      className={cn(
        'relative flex h-[30px] items-center justify-center border-t border-[var(--border-color)]/50 text-[10px] font-bold tabular-nums',
        hasBoundary && 'border-l border-l-[var(--border-color)]',
      )}
      style={{
        background: cellFill(probability, maxProb),
        boxShadow: isPeak ? 'inset 0 0 0 1px var(--accent-ai)' : undefined,
        color: t >= 0.55 ? 'var(--accent-on-primary)' : 'var(--text-secondary)',
      }}
    >
      {(isPeak || t >= 0.55) && probability > 0 && (
        <span className="pointer-events-none">
          {(probability * 100).toFixed(probability >= 0.095 ? 0 : 1)}
        </span>
      )}
    </div>
  )

  if (probability <= 0) return cell

  return (
    <Tooltip delayDuration={80}>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent className="tabular-nums text-[12px]">{label}</TooltipContent>
    </Tooltip>
  )
}

interface HeaderCellsProps {
  numTeams: number
}

function HeaderCells({ numTeams }: HeaderCellsProps) {
  const bounds = zoneBoundaries(numTeams)
  return (
    <>
      {Array.from({ length: numTeams }, (_, i) => {
        const pos = i + 1
        const zone = zoneForPosition(pos, numTeams)
        const color = zone === 'mid' ? undefined : ZONE_COLOR[zone]
        return (
          <div
            key={pos}
            role="columnheader"
            className={cn(
              'flex h-7 items-center justify-center text-[10px] font-semibold tabular-nums',
              bounds.has(pos) && 'border-l border-[var(--border-color)]',
            )}
            style={{
              color: color ?? 'var(--text-tertiary)',
              background: color
                ? `color-mix(in srgb, ${color} 12%, transparent)`
                : undefined,
            }}
          >
            {pos}
          </div>
        )
      })}
    </>
  )
}

function RowCells({
  standing,
  numTeams,
  maxProb,
}: {
  standing: Standing
  numTeams: number
  maxProb: number
}) {
  const dist = standing.position_distribution ?? {}
  let peakPos = 0
  let peakProb = 0
  for (const [pos, p] of Object.entries(dist)) {
    if (p > peakProb) {
      peakProb = p
      peakPos = Number(pos)
    }
  }
  const bounds = zoneBoundaries(numTeams)
  return (
    <>
      {Array.from({ length: numTeams }, (_, i) => {
        const pos = i + 1
        return (
          <DistributionCell
            key={pos}
            teamName={standing.team_name}
            position={pos}
            probability={dist[pos] ?? 0}
            maxProb={maxProb}
            isPeak={pos === peakPos && peakProb > 0}
            hasBoundary={bounds.has(pos)}
          />
        )
      })}
    </>
  )
}

function ZoneLegend({ numTeams }: { numTeams: number }) {
  const zones: Array<keyof typeof ZONE_LABEL> =
    numTeams > 10 ? ['title', 'cl', 'europa', 'releg'] : ['title', 'cl', 'releg']
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] text-[var(--text-tertiary)]">
      {zones.map((zone) => (
        <span key={zone} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: `color-mix(in srgb, ${ZONE_COLOR[zone]} 45%, transparent)` }}
          />
          {ZONE_LABEL[zone]}
        </span>
      ))}
      <span className="ml-auto hidden sm:inline">Darker cell = finishes there more often</span>
    </div>
  )
}

/**
 * Single-team variant — position headers + one distribution row. Reused by
 * the predicted-standings table when a row is expanded.
 */
export function SingleTeamDistribution({
  standing,
  numTeams,
}: {
  standing: Standing
  numTeams: number
}) {
  const rowMax = Math.max(
    0,
    ...Object.values(standing.position_distribution ?? {}),
  )
  return (
    <TooltipProvider>
      <div className="overflow-x-auto">
        <div
          role="table"
          aria-label={`${standing.team_name} finishing-position distribution`}
          className="grid min-w-[560px] overflow-hidden rounded-lg border border-[var(--border-color)]"
          style={{ gridTemplateColumns: `repeat(${numTeams}, minmax(24px, 1fr))` }}
        >
          <div role="row" className="contents">
            <HeaderCells numTeams={numTeams} />
          </div>
          <div role="row" className="contents">
            <RowCells standing={standing} numTeams={numTeams} maxProb={rowMax} />
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

interface PositionDistributionMatrixProps {
  standings: Standing[]
  teamMeta?: Record<string, TeamMeta>
  className?: string
}

export default function PositionDistributionMatrix({
  standings,
  teamMeta = {},
  className,
}: PositionDistributionMatrixProps) {
  const ordered = [...standings].sort(
    (a, b) => a.avg_final_position - b.avg_final_position,
  )
  const numTeams = ordered.length
  if (numTeams === 0) return null

  let maxProb = 0
  for (const team of ordered) {
    for (const p of Object.values(team.position_distribution ?? {})) {
      if (p > maxProb) maxProb = p
    }
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className,
      )}
    >
      <TooltipProvider>
        <div className="overflow-x-auto">
          <div
            role="table"
            aria-label="Finishing-position probabilities by team"
            className="grid min-w-[720px]"
            style={{
              gridTemplateColumns: `${LABEL_COL} repeat(${numTeams}, minmax(26px, 1fr))`,
            }}
          >
            <div role="row" className="contents">
              <div
                role="columnheader"
                className="sticky left-0 z-10 flex h-7 items-center bg-[var(--card-bg)] px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]"
              >
                Team · final position
              </div>
              <HeaderCells numTeams={numTeams} />
            </div>
            {ordered.map((standing) => (
              <Fragment key={standing.team_name}>
                <div role="row" className="contents">
                  <div
                    role="rowheader"
                    className="sticky left-0 z-10 flex h-[30px] items-center gap-2 border-t border-[var(--border-color)]/50 bg-[var(--card-bg)] px-3"
                  >
                    <TeamBadge
                      teamId={teamMeta[standing.team_name]?.id}
                      name={standing.team_name}
                      teamColor={teamMeta[standing.team_name]?.color}
                      size={16}
                    />
                    <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                      {standing.team_name}
                    </span>
                  </div>
                  <RowCells standing={standing} numTeams={numTeams} maxProb={maxProb} />
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      </TooltipProvider>
      <ZoneLegend numTeams={numTeams} />
    </div>
  )
}
