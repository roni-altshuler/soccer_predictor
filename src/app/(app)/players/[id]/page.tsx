'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { ChevronLeft, Crosshair, Footprints, Star, Target, Timer, Trophy } from 'lucide-react'

import { FormSparkline } from '@/components/charts/FormSparkline'
import { BentoCard, BentoGrid } from '@/components/magicui/bento-grid'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { Spotlight } from '@/components/magicui/spotlight'
import { PlayerAvatar, SectionHeader, StatCard, TeamBadge } from '@/components/primitives'
import { TableSkeleton } from '@/components/skeletons/TableSkeleton'
import { ChartSkeleton } from '@/components/skeletons/ChartSkeleton'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { usePlayer, usePlayerStats } from '@/hooks/usePlayer'

const RESULT_ACCENTS: Record<'W' | 'D' | 'L', string> = {
  W: 'var(--accent-primary)',
  D: 'var(--accent-warn)',
  L: 'var(--accent-loss)',
}

function ResultChip({ result }: { result: 'W' | 'D' | 'L' }) {
  const accent = RESULT_ACCENTS[result]
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded-md font-mono text-[10px] font-bold"
      style={{
        color: accent,
        backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)`,
      }}
    >
      {result}
    </span>
  )
}

function formatMatchDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function PlayerPage() {
  const routeParams = useParams<{ id: string }>()
  const id = Number(routeParams?.id ?? '')

  const { data: player, isLoading: playerLoading } = usePlayer(Number.isFinite(id) ? id : null)
  const { data: stats, isLoading: statsLoading } = usePlayerStats(Number.isFinite(id) ? id : null)

  const formValues = useMemo<number[] | undefined>(() => stats?.form ?? undefined, [stats])
  const matchLog = useMemo(() => stats?.matches ?? [], [stats])

  // Guarded degradation: an unknown player id (or an unreachable data
  // service) renders one honest EmptyState — never a zeroed-out profile.
  if (!playerLoading && !player) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-6 pb-12">
        <Link
          href="/matches"
          className="inline-flex min-h-[40px] items-center gap-1 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-primary)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back to matches
        </Link>
        <EmptyState
          illustration="data-error"
          title="Player profile unavailable"
          description="We couldn't load this player right now. They may not be covered yet, or the data service is briefly unreachable."
          action={
            <Link
              href="/matches"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--border-color)] px-4 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
            >
              Browse matches
            </Link>
          }
        />
      </div>
    )
  }

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
        <Card className="surface-elevated relative overflow-hidden p-6">
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
                {player?.name ?? 'Loading…'}
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
              <Footprints className="h-3.5 w-3.5 text-[var(--accent-primary)]" />{' '}
              {stats?.appearances != null ? 'Appearances' : 'Starts'}
            </div>
            <NumberTicker
              value={stats?.appearances ?? stats?.starts ?? 0}
              className="text-h1 font-extrabold tabular-nums text-[var(--text-primary)]"
            />
            <span className="truncate text-caption text-[var(--text-tertiary)]">
              {stats?.competition || 'this season'}
            </span>
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
        {stats?.minutes != null ? (
          <StatCard
            label="Minutes played"
            value={stats.minutes.toLocaleString()}
            sub={
              <span className="inline-flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5" aria-hidden />
                {stats?.appearances ?? stats?.starts ?? 0} matches
              </span>
            }
            accent="primary"
          />
        ) : (
          <StatCard
            label="Shots"
            value={stats?.shots ?? 0}
            sub={
              <span className="inline-flex items-center gap-1.5">
                <Crosshair className="h-3.5 w-3.5" aria-hidden />
                {stats?.shotsOnTarget ?? 0} on target
              </span>
            }
            accent="primary"
          />
        )}
      </div>

      {/* Match log */}
      <div className="mt-5">
        <SectionHeader
          kicker="Game log"
          title="Recent matches"
          className="mb-2"
          action={
            <span className="text-caption uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              last {matchLog.length || 10}
            </span>
          }
        />
        {statsLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : matchLog.length > 0 ? (
          <Card className="overflow-hidden p-0">
            <table className="w-full text-small">
              <thead className="sticky top-0 z-10 bg-[var(--card-bg)]">
                <tr className="border-b border-[var(--border-color)] text-left text-caption uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Opponent</th>
                  <th className="px-2 py-2.5 text-center font-semibold">Score</th>
                  <th className="px-2 py-2.5 text-center font-semibold">G</th>
                  <th className="px-2 py-2.5 text-center font-semibold">A</th>
                </tr>
              </thead>
              <tbody>
                {matchLog.map((match) => (
                  <tr
                    key={match.id}
                    className="border-b border-[var(--border-color)] last:border-b-0 odd:bg-[color-mix(in_srgb,var(--muted-bg)_40%,transparent)]"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-[var(--text-secondary)]">
                      {formatMatchDate(match.date)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2 text-[var(--text-primary)]">
                        <TeamBadge teamId={match.opponent.id} name={match.opponent.name} size={20} />
                        <span className="truncate">{match.opponent.name}</span>
                        <span className="text-caption text-[var(--text-tertiary)]">
                          {match.isHome === false ? '(A)' : '(H)'}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-center tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        {match.result ? <ResultChip result={match.result} /> : null}
                        <span className="text-[var(--text-secondary)]">{match.score ?? '—'}</span>
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center tabular-nums text-[var(--text-primary)]">
                      {match.goals ?? '—'}
                    </td>
                    <td className="px-2 py-2.5 text-center tabular-nums text-[var(--text-primary)]">
                      {match.assists ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <EmptyState
            illustration="no-matches"
            title="No recent matches"
            description="No game log is available for this player yet."
          />
        )}
      </div>
    </div>
  )
}
