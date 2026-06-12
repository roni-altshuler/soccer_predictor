'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Activity, Calendar, ChevronLeft, MapPin, Shield, Trophy, Users } from 'lucide-react'

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
import { useTeam, type TeamFixture } from '@/hooks/useTeam'

const FORM_ACCENTS: Record<string, string> = {
  W: 'var(--accent-primary)',
  D: 'var(--accent-warn)',
  L: 'var(--accent-loss)',
}

function FormPips({ form }: { form: string }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Recent form ${form}`}>
      {form.split('').map((result, index) => {
        const accent = FORM_ACCENTS[result] ?? 'var(--text-tertiary)'
        return (
          <span
            key={`${result}-${index}`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-md font-mono text-[10px] font-bold"
            style={{
              color: accent,
              backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)`,
            }}
          >
            {result}
          </span>
        )
      })}
    </span>
  )
}

const INJURY_STATUS_ACCENTS: Record<string, string> = {
  out: 'var(--accent-loss)',
  doubtful: 'var(--accent-warn)',
  questionable: 'var(--accent-warn)',
}

function formatFixtureDate(iso?: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function FixtureRow({ fixture }: { fixture: TeamFixture }) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5 text-small last:border-b-0">
      <span className="w-14 shrink-0 tabular-nums text-[var(--text-tertiary)]">
        {formatFixtureDate(fixture.date)}
      </span>
      <TeamBadge teamId={fixture.opponentId} name={fixture.opponent} size={20} />
      <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{fixture.opponent}</span>
      <span className="shrink-0 text-caption text-[var(--text-tertiary)]">
        {fixture.home ? '(H)' : '(A)'}
      </span>
      {fixture.score ? (
        <span className="shrink-0 tabular-nums font-semibold text-[var(--text-secondary)]">
          {fixture.score}
        </span>
      ) : null}
    </div>
  )
}

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
                {team?.form ? <FormPips form={team.form} /> : null}
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

      {/* Fixtures + results + availability */}
      <div className="mt-7 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-h3 text-[var(--text-primary)]">Upcoming fixtures</h2>
          </div>
          {isLoading ? (
            <MatchCardSkeleton count={3} />
          ) : team?.fixtures && team.fixtures.length > 0 ? (
            <Card className="overflow-hidden p-0">
              {team.fixtures.map((fixture) => (
                <FixtureRow key={fixture.matchId} fixture={fixture} />
              ))}
            </Card>
          ) : (
            <EmptyState
              illustration="no-matches"
              title="No upcoming fixtures"
              description="No scheduled matches were found for this team."
            />
          )}
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-h3 text-[var(--text-primary)]">Recent results</h2>
          </div>
          {isLoading ? (
            <MatchCardSkeleton count={3} />
          ) : team?.recentResults && team.recentResults.length > 0 ? (
            <Card className="overflow-hidden p-0">
              {team.recentResults.map((fixture) => (
                <FixtureRow key={fixture.matchId} fixture={fixture} />
              ))}
            </Card>
          ) : (
            <EmptyState
              illustration="no-matches"
              title="No recent results"
              description="No completed matches were found for this team."
            />
          )}
        </div>
      </div>

      {/* Availability — absences feed the prediction model's injury_impact factor */}
      <div className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-h3 text-[var(--text-primary)]">
            <Activity className="h-4 w-4 text-[var(--accent-warn)]" /> Availability
          </h2>
          <span className="text-caption uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            absences factor into AI predictions
          </span>
        </div>
        {isLoading ? (
          <TableSkeleton rows={2} columns={3} />
        ) : team?.injuries && team.injuries.length > 0 ? (
          <Card className="overflow-hidden p-0">
            {team.injuries.map((injury, index) => {
              const accent =
                INJURY_STATUS_ACCENTS[injury.status] ?? 'var(--text-tertiary)'
              return (
                <div
                  key={`${injury.playerId ?? injury.name}-${index}`}
                  className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5 text-small last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                    {injury.name}
                  </span>
                  {injury.reason ? (
                    <span className="hidden truncate text-caption text-[var(--text-tertiary)] sm:inline">
                      {injury.reason}
                    </span>
                  ) : null}
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                    style={{
                      color: accent,
                      backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
                    }}
                  >
                    {injury.status}
                  </span>
                </div>
              )
            })}
          </Card>
        ) : (
          <Card className="p-4">
            <p className="text-small text-[var(--text-secondary)]">
              No reported absences for this squad right now.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
