'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { ChevronLeft, Footprints, Star, Target, Timer, Trophy } from 'lucide-react'

import { FormSparkline } from '@/components/charts/FormSparkline'
import { BentoCard, BentoGrid } from '@/components/magicui/bento-grid'
import { BorderBeam } from '@/components/magicui/border-beam'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { Spotlight } from '@/components/magicui/spotlight'
import { PlayerAvatar } from '@/components/primitives/PlayerAvatar'
import { TeamBadge } from '@/components/primitives/TeamBadge'
import { StatCard } from '@/components/cards/StatCard'
import { TableSkeleton } from '@/components/skeletons/TableSkeleton'
import { ChartSkeleton } from '@/components/skeletons/ChartSkeleton'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { usePlayer, usePlayerStats } from '@/hooks/usePlayer'

export default function PlayerPage() {
  const routeParams = useParams<{ id: string }>()
  const id = Number(routeParams?.id ?? '')

  const { data: player, isLoading: playerLoading } = usePlayer(Number.isFinite(id) ? id : null)
  const { data: stats, isLoading: statsLoading } = usePlayerStats(Number.isFinite(id) ? id : null)

  const formValues = useMemo<number[] | undefined>(() => stats?.form ?? undefined, [stats])

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 pb-12">
      <Link
        href="/matches"
        className="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-primary)]"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Back to matches
      </Link>

      {/* Hero */}
      <Spotlight
        className="mt-3 block rounded-2xl"
        size={420}
        color="color-mix(in srgb, var(--accent-ai) 18%, transparent)"
      >
        <Card className="relative overflow-hidden p-6">
          <BorderBeam size={1} duration={12} borderRadius={16} />
          <div className="relative z-10 flex flex-col items-start gap-5 md:flex-row md:items-center">
            <PlayerAvatar
              playerId={Number.isFinite(id) ? id : undefined}
              name={player?.name}
              imageUrl={player?.imageUrl}
              size={96}
              teamColor={player?.teamColor}
            />
            <div className="min-w-0 flex-1">
              <p className="text-caption font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                Player profile
              </p>
              <h1 className="mt-1 text-display font-extrabold tracking-tight text-[var(--text-primary)]">
                {player?.name ?? (playerLoading ? 'Loading…' : 'Unknown player')}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-small text-[var(--text-secondary)]">
                {player?.position ? (
                  <span className="rounded-md bg-[var(--muted-bg)] px-2 py-0.5 font-mono uppercase tracking-[0.1em]">
                    {player.position}
                  </span>
                ) : null}
                {player?.shirtNumber != null ? <span>#{player.shirtNumber}</span> : null}
                {player?.teamName ? (
                  <Link
                    href={player.teamId ? `/teams/${player.teamId}` : '#'}
                    className="inline-flex items-center gap-1.5 hover:text-[var(--accent-primary)]"
                  >
                    <TeamBadge
                      teamId={player.teamId}
                      name={player.teamName}
                      size={20}
                      teamColor={player.teamColor}
                    />
                    {player.teamName}
                  </Link>
                ) : null}
                {player?.nationality ? <span>· {player.nationality}</span> : null}
                {typeof player?.age === 'number' ? <span>· {player.age} y/o</span> : null}
              </div>
            </div>
          </div>
        </Card>
      </Spotlight>

      {/* Stats bento */}
      <BentoGrid className="mt-5 auto-rows-[8rem]">
        <BentoCard className="col-span-3 md:col-span-1">
          <div className="flex h-full flex-col justify-between p-5">
            <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              <Footprints className="h-3.5 w-3.5 text-[var(--accent-primary)]" /> Appearances
            </div>
            <NumberTicker
              value={stats?.appearances ?? 0}
              className="text-h1 font-extrabold tabular-nums text-[var(--text-primary)]"
            />
            <span className="text-caption text-[var(--text-tertiary)]">this season</span>
          </div>
        </BentoCard>
        <BentoCard className="col-span-3 md:col-span-1">
          <div className="flex h-full flex-col justify-between p-5">
            <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              <Target className="h-3.5 w-3.5 text-[var(--accent-loss)]" /> Goals
            </div>
            <NumberTicker
              value={stats?.goals ?? 0}
              className="text-h1 font-extrabold tabular-nums text-[var(--accent-loss)]"
            />
            <span className="text-caption text-[var(--text-tertiary)]">
              xG {stats?.xG?.toFixed(1) ?? '—'}
            </span>
          </div>
        </BentoCard>
        <BentoCard className="col-span-3 md:col-span-1">
          <div className="flex h-full flex-col justify-between p-5">
            <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              <Trophy className="h-3.5 w-3.5 text-[var(--accent-ai)]" /> Assists
            </div>
            <NumberTicker
              value={stats?.assists ?? 0}
              className="text-h1 font-extrabold tabular-nums text-[var(--accent-ai)]"
            />
            <span className="text-caption text-[var(--text-tertiary)]">
              xA {stats?.xA?.toFixed(1) ?? '—'}
            </span>
          </div>
        </BentoCard>
      </BentoGrid>

      {/* Form + minutes */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              <Star className="h-3.5 w-3.5 text-[var(--accent-warn)]" /> Last 10 form
            </div>
            {typeof stats?.rating === 'number' ? (
              <span className="text-caption text-[var(--text-tertiary)]">
                avg rating <span className="font-mono text-[var(--text-primary)]">{stats.rating.toFixed(2)}</span>
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex items-center justify-center">
            {formValues && formValues.length > 0 ? (
              <FormSparkline values={formValues} width={420} height={64} accent="ai" />
            ) : statsLoading ? (
              <ChartSkeleton height="h-16" withLegend={false} className="w-full max-w-md" />
            ) : (
              <p className="text-caption text-[var(--text-tertiary)]">No recent form data.</p>
            )}
          </div>
        </Card>
        <StatCard
          label="Minutes played"
          value={stats?.minutes ?? 0}
          caption={`${stats?.appearances ?? 0} appearances`}
          Icon={Timer}
          accent="primary"
        />
      </div>

      {/* Match log placeholder */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-h3 text-[var(--text-primary)]">Recent matches</h2>
          <span className="text-caption uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            last 5
          </span>
        </div>
        {statsLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : (
          <EmptyState
            illustration="no-matches"
            title="Match log not available yet"
            description="The player match log endpoint will populate this section once the backend route lands."
          />
        )}
      </div>
    </div>
  )
}
