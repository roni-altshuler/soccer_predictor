'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Bookmark, BookmarkCheck, ChevronLeft } from 'lucide-react'

import { PlayerAvatar, TeamBadge } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { useTeam, type TeamFixture } from '@/hooks/useTeam'
import {
  WATCHLIST_STORAGE_KEY,
  normalizeTeamName,
  type WatchTeam,
} from '@/lib/watchlist'

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
            className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold tabular-nums"
            style={{
              color: accent,
              backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
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
    <div className="flex min-h-[44px] items-center gap-3 px-3 py-2 text-[13px] transition-colors hover:bg-[var(--card-hover)]">
      <span className="w-14 shrink-0 text-[12px] tabular-nums text-[var(--text-tertiary)]">
        {formatFixtureDate(fixture.date)}
      </span>
      <TeamBadge teamId={fixture.opponentId} name={fixture.opponent} size={20} />
      <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">
        {fixture.opponent}
      </span>
      <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
        {fixture.home ? '(H)' : '(A)'}
      </span>
      {fixture.score ? (
        <span
          className="shrink-0 font-bold tabular-nums"
          style={{ color: scoreAccent ?? 'var(--text-secondary)' }}
        >
          {fixture.score}
        </span>
      ) : null}
    </div>
  )
}

function Section({
  title,
  meta,
  children,
}: {
  title: string
  meta?: string
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-[var(--border-color)]/40 bg-[var(--background-secondary)]/60 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          {title}
        </p>
        {meta ? <p className="text-[11px] text-[var(--text-tertiary)]">{meta}</p> : null}
      </div>
      {children}
    </Card>
  )
}

/** Read the persisted watchlist, tolerating malformed storage. */
function readWatchlist(): WatchTeam[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is WatchTeam =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as Partial<WatchTeam>).name === 'string' &&
        typeof (item as Partial<WatchTeam>).league === 'string'
    )
  } catch {
    return []
  }
}

function FollowButton({ teamName, league }: { teamName: string; league: string }) {
  const [following, setFollowing] = useState(false)

  useEffect(() => {
    const target = normalizeTeamName(teamName)
    setFollowing(readWatchlist().some((t) => normalizeTeamName(t.name) === target))
  }, [teamName])

  const toggle = useCallback(() => {
    const target = normalizeTeamName(teamName)
    const current = readWatchlist()
    const exists = current.some((t) => normalizeTeamName(t.name) === target)
    const next = exists
      ? current.filter((t) => normalizeTeamName(t.name) !== target)
      : [...current, { name: teamName, league }]
    try {
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable (private mode) — state still flips for this view.
    }
    setFollowing(!exists)
  }, [teamName, league])

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={following}
      className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors ${
        following
          ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
          : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]'
      }`}
    >
      {following ? (
        <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Bookmark className="h-4 w-4" aria-hidden="true" />
      )}
      {following ? 'Following' : 'Follow'}
    </button>
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
      <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
        <Link
          href="/matches"
          className="inline-flex min-h-[44px] items-center gap-1 px-1 text-[12px] font-semibold text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Matches
        </Link>
        <EmptyState
          illustration="data-error"
          title="Team profile unavailable"
          description="We couldn't load this team right now. The club may not be covered yet, or the data service is briefly unreachable."
          action={
            <Link
              href="/matches"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--border-color)] px-4 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)]"
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

  const leagueLine = [team?.country, team?.stadium].filter(Boolean).join(' · ')

  const seasonCells: Array<{ label: string; value: string }> = hasSeasonStats
    ? [
        { label: 'P', value: String(matchesPlayed) },
        { label: 'W-D-L', value: `${wins}-${draws}-${losses}` },
        ...(typeof stats?.goalsFor === 'number' && typeof stats?.goalsAgainst === 'number'
          ? [{ label: 'GF-GA', value: `${stats.goalsFor}-${stats.goalsAgainst}` }]
          : []),
        ...(typeof goalDiff === 'number'
          ? [{ label: 'GD', value: goalDiff > 0 ? `+${goalDiff}` : String(goalDiff) }]
          : []),
        { label: 'Pts', value: String(stats?.points ?? wins * 3 + draws) },
        ...(typeof stats?.position === 'number'
          ? [{ label: 'Pos', value: String(stats.position) }]
          : []),
      ]
    : []

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4" aria-busy="true">
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-xl bg-[var(--muted-bg)]" />
          <div className="h-48 animate-pulse rounded-xl bg-[var(--muted-bg)]" />
          <div className="h-48 animate-pulse rounded-xl bg-[var(--muted-bg)]" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <Link
        href="/matches"
        className="inline-flex min-h-[44px] items-center gap-1 px-1 text-[12px] font-semibold text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Matches
      </Link>

      {/* Flat team header */}
      <Card className="mt-1 overflow-hidden p-0">
        <div className="flex items-center gap-4 p-4">
          <TeamBadge
            teamId={Number.isFinite(numericId) ? numericId : id}
            name={team?.name}
            imageUrl={team?.badgeUrl}
            size={56}
            teamColor={team?.color}
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold tracking-tight text-[var(--text-primary)]">
              {team?.name}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--text-tertiary)]">
              {team?.league ? (
                team.league_id ? (
                  <Link
                    href={`/leagues/${team.league_id}`}
                    className="font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--accent-primary)]"
                  >
                    {team.league}
                  </Link>
                ) : (
                  <span className="font-semibold text-[var(--text-secondary)]">{team.league}</span>
                )
              ) : null}
              {leagueLine ? <span>{team?.league ? `· ${leagueLine}` : leagueLine}</span> : null}
              {team?.founded ? <span>· Est. {team.founded}</span> : null}
            </div>
            {team?.form ? (
              <div className="mt-1.5">
                <FormPips form={team.form} />
              </div>
            ) : null}
          </div>
          {team?.name ? <FollowButton teamName={team.name} league={team.league ?? ''} /> : null}
        </div>

        {/* Season line — compact tabular strip, only once matches were played */}
        {seasonCells.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--border-color)]/40 px-4 py-2">
            {seasonCells.map(({ label, value }) => (
              <span key={label} className="flex items-baseline gap-1.5 text-[12px]">
                <span className="font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  {label}
                </span>
                <span className="font-bold tabular-nums text-[var(--text-primary)]">{value}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-3 space-y-3">
        {/* Fixtures + results */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Section title="Fixtures">
            {team?.fixtures && team.fixtures.length > 0 ? (
              <div className="divide-y divide-[var(--border-color)]/40">
                {team.fixtures.map((fixture) => (
                  <FixtureRow key={fixture.matchId} fixture={fixture} />
                ))}
              </div>
            ) : (
              <EmptyState
                illustration="no-matches"
                title="No upcoming fixtures"
                description="No scheduled matches were found for this team."
                className="py-8"
              />
            )}
          </Section>
          <Section title="Results">
            {team?.recentResults && team.recentResults.length > 0 ? (
              <div className="divide-y divide-[var(--border-color)]/40">
                {team.recentResults.map((fixture) => (
                  <FixtureRow key={fixture.matchId} fixture={fixture} />
                ))}
              </div>
            ) : (
              <EmptyState
                illustration="no-matches"
                title="No recent results"
                description="No completed matches were found for this team."
                className="py-8"
              />
            )}
          </Section>
        </div>

        {/* Squad — dense rows, real headshots where the provider has them */}
        <Section
          title="Squad"
          meta={team?.squad?.length ? `${team.squad.length} players` : undefined}
        >
          {team?.squad && team.squad.length > 0 ? (
            <ul className="grid grid-cols-1 md:grid-cols-2">
              {team.squad.map((p) => (
                <li key={p.id} className="border-b border-[var(--border-color)]/40">
                  <Link
                    href={`/players/${p.id}`}
                    prefetch={false}
                    className="flex min-h-[48px] items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--card-hover)]"
                  >
                    <PlayerAvatar playerId={p.id} name={p.name} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
                        {p.name}
                      </span>
                      <span className="block text-[11px] text-[var(--text-tertiary)]">
                        {[p.position, p.shirtNumber != null ? `#${p.shirtNumber}` : null]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                    </span>
                    {typeof p.rating === 'number' && !Number.isNaN(p.rating) ? (
                      <span className="shrink-0 text-[12px] font-bold tabular-nums text-[var(--text-secondary)]">
                        {p.rating.toFixed(1)}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              illustration="no-matches"
              title="Squad list not available"
              description="The roster provider has no player list for this club right now."
              className="py-8"
            />
          )}
        </Section>

        {/* Availability — absences feed the prediction model's injury factor */}
        <Section title="Injuries & absences">
          {team?.injuries && team.injuries.length > 0 ? (
            <div className="divide-y divide-[var(--border-color)]/40">
              {team.injuries.map((injury, index) => {
                const accent = INJURY_STATUS_ACCENTS[injury.status] ?? 'var(--text-tertiary)'
                return (
                  <div
                    key={`${injury.playerId ?? injury.name}-${index}`}
                    className="flex min-h-[44px] items-center gap-3 px-3 py-2 text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">
                      {injury.name}
                    </span>
                    {injury.reason ? (
                      <span className="hidden truncate text-[11px] text-[var(--text-tertiary)] sm:inline">
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
            </div>
          ) : (
            <p className="px-3 py-3 text-[13px] text-[var(--text-secondary)]">
              No reported absences for this squad right now.
            </p>
          )}
        </Section>
      </div>
    </div>
  )
}
