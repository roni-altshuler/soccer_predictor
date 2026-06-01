'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Calendar, ChevronLeft, MapPin, Shield, Trophy, Users } from 'lucide-react'

import { BentoCard, BentoGrid } from '@/components/magicui/bento-grid'
import { BorderBeam } from '@/components/magicui/border-beam'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { Spotlight } from '@/components/magicui/spotlight'
import { TeamBadge } from '@/components/primitives/TeamBadge'
import { PlayerCard } from '@/components/cards/PlayerCard'
import { StatCard } from '@/components/cards/StatCard'
import { MatchCardSkeleton } from '@/components/skeletons/MatchCardSkeleton'
import { TableSkeleton } from '@/components/skeletons/TableSkeleton'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { useTeam } from '@/hooks/useTeam'

export default function TeamPage() {
  const routeParams = useParams<{ id: string }>()
  const id = routeParams?.id ?? ''
  const numericId = Number(id)

  const { data: team, isLoading } = useTeam(Number.isFinite(numericId) ? numericId : null)

  const stats = team?.stats
  const wins = stats?.wins ?? 0
  const draws = stats?.draws ?? 0
  const losses = stats?.losses ?? 0
  const matchesPlayed = stats?.matchesPlayed ?? wins + draws + losses
  const goalDiff =
    typeof stats?.goalsFor === 'number' && typeof stats?.goalsAgainst === 'number'
      ? stats.goalsFor - stats.goalsAgainst
      : undefined

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-12">
      <Link
        href="/matches"
        className="inline-flex items-center gap-1 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-primary)]"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Back
      </Link>

      <Spotlight
        className="mt-3 block rounded-2xl"
        size={460}
        color={
          team?.color
            ? `color-mix(in srgb, ${team.color} 22%, transparent)`
            : 'color-mix(in srgb, var(--accent-primary) 14%, transparent)'
        }
      >
        <Card
          className="relative overflow-hidden p-6"
          style={team?.color ? { borderLeftColor: team.color, borderLeftWidth: 4 } : undefined}
        >
          <BorderBeam
            size={1}
            duration={12}
            borderRadius={16}
            colorFrom={team?.color ?? 'var(--accent-primary)'}
            colorTo="var(--accent-ai)"
          />
          <div className="relative z-10 flex flex-col items-start gap-5 md:flex-row md:items-center">
            <TeamBadge
              teamId={Number.isFinite(numericId) ? numericId : id}
              name={team?.name}
              imageUrl={team?.badgeUrl}
              size={96}
              teamColor={team?.color}
            />
            <div className="min-w-0 flex-1">
              <p className="text-caption font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                Club profile
              </p>
              <h1 className="mt-1 text-display font-extrabold tracking-tight text-[var(--text-primary)]">
                {team?.name ?? (isLoading ? 'Loading…' : 'Unknown team')}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-small text-[var(--text-secondary)]">
                {team?.league ? (
                  <Link
                    href={team.league_id ? `/leagues/${team.league_id}` : '#'}
                    className="inline-flex items-center gap-1.5 hover:text-[var(--accent-primary)]"
                  >
                    <Trophy className="h-3.5 w-3.5" />
                    {team.league}
                  </Link>
                ) : null}
                {team?.country ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {team.country}
                  </span>
                ) : null}
                {team?.founded ? <span>Est. {team.founded}</span> : null}
                {team?.stadium ? <span>· {team.stadium}</span> : null}
              </div>
            </div>
            {typeof team?.stats?.position === 'number' ? (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3 text-center">
                <p className="text-caption uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  League pos
                </p>
                <NumberTicker
                  value={team.stats.position}
                  className="text-display font-extrabold tabular-nums text-[var(--accent-primary)]"
                />
              </div>
            ) : null}
          </div>
        </Card>
      </Spotlight>

      {/* Season metrics */}
      <BentoGrid className="mt-5 auto-rows-[8rem]">
        <BentoCard className="col-span-3 md:col-span-1">
          <div className="flex h-full flex-col justify-between p-5">
            <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              <Calendar className="h-3.5 w-3.5 text-[var(--text-secondary)]" /> Matches
            </div>
            <NumberTicker
              value={matchesPlayed}
              className="text-h1 font-extrabold tabular-nums text-[var(--text-primary)]"
            />
            <span className="text-caption text-[var(--text-tertiary)]">
              {wins}W · {draws}D · {losses}L
            </span>
          </div>
        </BentoCard>
        <BentoCard className="col-span-3 md:col-span-1">
          <div className="flex h-full flex-col justify-between p-5">
            <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              <Shield className="h-3.5 w-3.5 text-[var(--accent-primary)]" /> Points
            </div>
            <NumberTicker
              value={stats?.points ?? 0}
              className="text-h1 font-extrabold tabular-nums text-[var(--accent-primary)]"
            />
            <span className="text-caption text-[var(--text-tertiary)]">
              GD {typeof goalDiff === 'number' ? (goalDiff > 0 ? `+${goalDiff}` : goalDiff) : '—'}
            </span>
          </div>
        </BentoCard>
        <BentoCard className="col-span-3 md:col-span-1">
          <div className="flex h-full flex-col justify-between p-5">
            <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              <Users className="h-3.5 w-3.5 text-[var(--accent-ai)]" /> Squad
            </div>
            <NumberTicker
              value={team?.squad?.length ?? 0}
              className="text-h1 font-extrabold tabular-nums text-[var(--accent-ai)]"
            />
            <span className="text-caption text-[var(--text-tertiary)]">players in squad</span>
          </div>
        </BentoCard>
      </BentoGrid>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard
          label="Goals scored"
          value={stats?.goalsFor ?? 0}
          caption="this season"
          accent="primary"
        />
        <StatCard
          label="Goals conceded"
          value={stats?.goalsAgainst ?? 0}
          caption="this season"
          accent="loss"
        />
        <StatCard
          label="Avg per match"
          value={
            matchesPlayed > 0 && typeof stats?.goalsFor === 'number'
              ? stats.goalsFor / matchesPlayed
              : 0
          }
          decimalPlaces={2}
          caption="scoring rate"
          accent="ai"
        />
      </div>

      {/* Squad */}
      <div className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h3 text-[var(--text-primary)]">Squad</h2>
          <span className="text-caption uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            click a player for their profile
          </span>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[68px] animate-pulse rounded-xl bg-[var(--muted-bg)]" />
            ))}
          </div>
        ) : team?.squad && team.squad.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {team.squad.map((p) => (
              <PlayerCard
                key={p.id}
                playerId={p.id}
                name={p.name}
                position={p.position}
                shirtNumber={p.shirtNumber}
                rating={p.rating}
                teamColor={team.color}
                href={`/players/${p.id}`}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            illustration="no-matches"
            title="Squad list not available"
            description="The team roster endpoint will populate this section once the backend route lands."
          />
        )}
      </div>

      {/* Upcoming fixtures */}
      <div className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h3 text-[var(--text-primary)]">Upcoming fixtures</h2>
        </div>
        {isLoading ? (
          <MatchCardSkeleton count={3} />
        ) : team?.fixtures && team.fixtures.length > 0 ? (
          <Card className="overflow-hidden">
            <TableSkeleton rows={Math.min(team.fixtures.length, 5)} columns={3} />
          </Card>
        ) : (
          <EmptyState
            illustration="no-matches"
            title="No upcoming fixtures"
            description="The fixtures endpoint will surface scheduled matches here once available."
          />
        )}
      </div>
    </div>
  )
}
