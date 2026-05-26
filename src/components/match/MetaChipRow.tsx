'use client'

import { Calendar, Clock, MapPin, User, Users, CloudSun } from 'lucide-react'

import { MetaChip } from '@/components/primitives'
import { cn } from '@/lib/utils'

interface MetaChipRowProps {
  venue?: string | null
  /** Match kickoff (any pre-formatted string). */
  kickoff?: string | null
  /** Compact date label ("Sat 18 May"). */
  dateLabel?: string | null
  attendance?: number | null
  capacity?: number | null
  refereeName?: string | null
  /** Short weather summary ("14°C · cloudy"). */
  weatherSummary?: string | null
  className?: string
}

function formatNumber(value: number | null | undefined): string | null {
  if (value == null) return null
  return value.toLocaleString()
}

/**
 * MetaChipRow — horizontal row of FotMob-style metadata chips above the match
 * hero. Replaces today's ad-hoc 10–11px uppercase tracking spans with the
 * `meta` typography tier (13px non-uppercase) + `--meta-chip-bg` token.
 *
 * Every chip is optional; the row hides itself when nothing resolves.
 */
export function MetaChipRow({
  venue,
  kickoff,
  dateLabel,
  attendance,
  capacity,
  refereeName,
  weatherSummary,
  className,
}: MetaChipRowProps) {
  const attendanceLabel = attendance ? `${formatNumber(attendance)} attendance` : null
  const capacityLabel = capacity && !attendance ? `${formatNumber(capacity)} capacity` : null

  const chips: React.ReactNode[] = []
  if (dateLabel) chips.push(<MetaChip key="date" icon={Calendar}>{dateLabel}</MetaChip>)
  if (kickoff) chips.push(<MetaChip key="kickoff" icon={Clock}>{kickoff}</MetaChip>)
  if (venue) {
    chips.push(
      <MetaChip
        key="venue"
        icon={MapPin}
        href={`https://www.google.com/maps/search/${encodeURIComponent(venue)}`}
        external
      >
        {venue}
      </MetaChip>,
    )
  }
  if (attendanceLabel) chips.push(<MetaChip key="att" icon={Users}>{attendanceLabel}</MetaChip>)
  if (capacityLabel) chips.push(<MetaChip key="cap" icon={Users}>{capacityLabel}</MetaChip>)
  if (refereeName) chips.push(<MetaChip key="ref" icon={User}>{`Ref. ${refereeName}`}</MetaChip>)
  if (weatherSummary) chips.push(<MetaChip key="wx" icon={CloudSun}>{weatherSummary}</MetaChip>)

  if (chips.length === 0) return null

  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{chips}</div>
}
