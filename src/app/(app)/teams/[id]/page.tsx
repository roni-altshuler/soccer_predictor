'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronLeft, MapPin, Trophy } from 'lucide-react'

import { NumberTicker } from '@/components/magicui/number-ticker'
import { Spotlight } from '@/components/magicui/spotlight'
import { SectionHeader, StatCard, TeamBadge } from '@/components/primitives'
import { PlayerCard } from '@/components/cards/PlayerCard'
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

/** W/D/L from a "self-opponent" score string, e.g. "2-1" → W. */
function resultFromScore(score?: string): 'W' | 'D' | 'L' | null {
  if (!score) return null
  const [self, opp] = score.split('-').map((n) => parseInt(n, 10))
  if (!Number.isFinite(self) || !Number.isFinite(opp)) return null
  if (self > opp) return 'W'
  if (self < opp) return 'L'
  return 'D'
}

function FixtureRow({ fixture }: { fixture: TeamFixture }) {
  const result = resultFromScore(fixture.score)
  const scoreAccent = result ? FORM_ACCENTS[result] : undefined
  return (
    <div className="flex min-h-[44px] items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5 text-small transition-colors last:border-b-0 hover:bg-[var(--card-hover)]">
      <span className="w-14 shrink-0 tabular-nums text-[var(--text-tertiary)]">
        {formatFixtureDate(fixture.date)}
      </span>
      <TeamBadge teamId={fixture.opponentId} name={fixture.opponent} size={20} />
      <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">
        {fixture.opponent}
      </span>
      <span className="shrink-0 text-caption text-[var(--text-tertiary)]">
        {fixture.home ? '(H)' : '(A)'}
      </span>
      {fixture.score ? (
        <span
          className="shrink-0 tabular-nums font-bold"
          style={{ color: scoreAccent ?? 'var(--text-secondary)' }}
        >
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

  // Guarded degradation: when the overview endpoint 404s or the backend is
  // unreachable, render a single honest EmptyState — never a zeroed-out
  // "Unknown team" dashboard.
  if (!isLoading && !team) {
    return (
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-12">
        <Link
          href="/matches"
          className="inline-flex min-h-[40px] items-center gap-1 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-primary)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <EmptyState
          illustration="data-error"
          title="Team profile unavailable"
          description="We couldn't load this team right now. The club may not be covered yet, or the data service is briefly unreachable."
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

  const stats = team?.stats
  const wins = stats?.wins ?? 0
  const draws = stats?.draws ?? 0
  const losses = stats?.losses ?? 0
  const matchesPlayed = stats?.matchesPlayed ?? wins + draws + losses
  const hasSeasonStats = matchesPlayed > 0
  const goalDiff =
    typeof stats?.goalsFor === 'number' && typeof stats?.goalsAgainst === 'number'
      ? stats.goalsFor - stats.goalsAgainst
      : undefined

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 pt-6 pb-12">
      <div>
        <Link
          href="/matches"
          className="inline-flex min-h-[40px] items-center gap-1 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-primary)]"
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
            className="surface-elevated relative overflow-hidden p-6"
            style={{
              ...(team?.color ? { borderLeftColor: team.color, borderLeftWidth: 4 } : undefined),
              background: `linear-gradient(135deg, color-mix(in srgb, ${team?.color ?? 'var(--accent-primary)'} 10%, var(--card-bg)), var(--card-bg) 62%)`,
            }}
          >
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
                  {team?.name ?? 'Loading…'}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-small text-[var(--text-secondary)]">
                  {team?.league ? (
                    <Link
                      href={team.league_id ? `/leagues/${team.league_id}` : '#'}
                      className="inline-flex min-h-[40px] items-center gap-1.5 hover:text-[var(--accent-primary)]"
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
              {typeof team?.stats?.position === 'number' && matchesPlayed > 0 ? (
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

        {/* Season metrics — rendered only once the club has played matches,
            so an empty season never shows a wall of zeros. */}
        {hasSeasonStats ? (
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StatCard
              label="Matches"
              value={matchesPlayed}
              sub={`${wins}W · ${draws}D · ${losses}L`}
            />
            <StatCard
              label="Points"
              value={stats?.points ?? wins * 3 + draws}
              sub={
                typeof goalDiff === 'number'
                  ? `GD ${goalDiff > 0 ? `+${goalDiff}` : goalDiff}`
                  : 'this season'
              }
              accent="primary"
            />
            <StatCard
              label="Goals scored"
              value={stats?.goalsFor ?? '—'}
              sub="this season"
              accent="primary"
            />
            <StatCard
              label="Goals conceded"
              value={stats?.goalsAgainst ?? '—'}
              sub="this season"
              accent="loss"
            />
            <StatCard
              label="Avg per match"
              value={
                typeof stats?.goalsFor === 'number'
                  ? (stats.goalsFor / matchesPlayed).toFixed(2)
                  : '—'
              }
              sub="scoring rate"
              accent="ai"
            />
            <StatCard
              label="Squad"
              value={team?.squad?.length ? team.squad.length : '—'}
              sub="players listed"
            />
          </div>
        ) : !isLoading ? (
          <p className="mt-5 text-small text-[var(--text-tertiary)]">
            No season statistics yet — this club hasn&apos;t played a tracked match in the
            current campaign.
          </p>
        ) : null}
      </div>

      {/* Squad */}
      <section>
        <SectionHeader
          kicker="Roster"
          title="Squad"
          description="Click a player for their profile."
          className="mb-3"
        />
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
            description="The roster provider has no player list for this club right now."
          />
        )}
      </section>

      {/* Fixtures + results */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <SectionHeader kicker="Schedule" title="Upcoming fixtures" className="mb-3" />
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
          <SectionHeader kicker="Form check" title="Recent results" className="mb-3" />
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
      </section>

      {/* Availability — absences feed the prediction model's injury_impact factor */}
      <section>
        <SectionHeader
          kicker="Availability"
          title="Injuries & absences"
          description="Absences factor into AI predictions."
          className="mb-3"
        />
        {isLoading ? (
          <TableSkeleton rows={2} columns={3} />
        ) : team?.injuries && team.injuries.length > 0 ? (
          <Card className="overflow-hidden p-0">
            {team.injuries.map((injury, index) => {
              const accent = INJURY_STATUS_ACCENTS[injury.status] ?? 'var(--text-tertiary)'
              return (
                <div
                  key={`${injury.playerId ?? injury.name}-${index}`}
                  className="flex min-h-[44px] items-center gap-3 border-b border-[var(--border-color)] px-4 py-2.5 text-small last:border-b-0"
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
      </section>
    </div>
  )
}
