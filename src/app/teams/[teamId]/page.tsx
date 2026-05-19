import Link from 'next/link'
import { notFound } from 'next/navigation'

import TeamForm from '@/components/team/TeamForm'
import TeamDetailTabs from '@/components/team/TeamDetailTabs'
import { Breadcrumbs } from '@/components/Breadcrumbs'

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

interface TeamPageProps {
  params: Promise<{ teamId: string }>
  searchParams: Promise<{ league?: string }>
}

interface OverviewResponse {
  team: {
    id: string
    name: string
    abbreviation: string
    logo: string | null
    venue: string | null
    founded: number | null
  }
  league: { id: string; name: string; season: string }
  standing: {
    position: number
    played: number
    won: number
    drawn: number
    lost: number
    gf: number
    ga: number
    points: number
    form_string: string
  }
  next_fixture: NextFixture | null
  recent_results: Fixture[]
  upcoming_fixtures: Fixture[]
  squad: Array<{
    player_id: string
    name: string
    position: string
    number: number | null
    nationality: string
  }>
  stats: {
    goals_per_match: number
    conceded_per_match: number
    clean_sheets: number | null
    possession_avg: number | null
  }
  injuries: Array<{
    player_id?: string | null
    name?: string | null
    status?: string | null
    reason?: string | null
  }>
  generated_at: string
}

interface NextFixture {
  match_id: string
  kickoff?: string | null
  is_home: boolean
  venue?: string | null
  opponent: { id: string; name: string }
}

interface Fixture extends NextFixture {
  self_score?: number | null
  opponent_score?: number | null
  status?: string | null
  status_detail?: string | null
  completed?: boolean
}

async function fetchOverview(teamId: string, league?: string): Promise<OverviewResponse | null> {
  const qs = new URLSearchParams()
  if (league) qs.set('league', league)
  const url = `${BACKEND_URL}/api/v1/teams/${encodeURIComponent(teamId)}/overview${
    qs.toString() ? `?${qs.toString()}` : ''
  }`
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    })
    if (res.status === 404) return null
    if (!res.ok) return null
    return (await res.json()) as OverviewResponse
  } catch {
    return null
  }
}

function formatKickoff(iso?: string | null): string {
  if (!iso) return 'TBD'
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function countdown(iso?: string | null): string {
  if (!iso) return ''
  const target = new Date(iso).getTime()
  const now = Date.now()
  const diff = target - now
  if (Number.isNaN(diff)) return ''
  if (diff <= 0) return 'Kickoff imminent'
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  if (days > 0) return `${days}d ${hours}h until kickoff`
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m until kickoff`
}

export async function generateMetadata({ params }: TeamPageProps) {
  const { teamId } = await params
  return {
    title: `Team ${teamId} | FotPredict AI`,
    description: `Latest squad, fixtures, results, stats and injuries for team ${teamId}.`,
  }
}

export default async function TeamDetailPage({ params, searchParams }: TeamPageProps) {
  const { teamId } = await params
  const sp = await searchParams
  const overview = await fetchOverview(teamId, sp?.league)
  if (!overview) {
    notFound()
  }

  const { team, league, standing, next_fixture, recent_results, upcoming_fixtures, squad, stats, injuries } =
    overview

  const formArray = standing.form_string ? standing.form_string.split('').slice(0, 5) : []
  const goalDiff = standing.gf - standing.ga

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--background)' }}>
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-10 space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Teams' },
            { label: team.name || `Team ${team.id}` },
          ]}
        />
        {/* Header */}
        <header
          className="rounded-2xl border p-5 md:p-7"
          style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              {team.logo ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={team.logo}
                  alt={team.name}
                  className="w-16 h-16 md:w-20 md:h-20 object-contain"
                />
              ) : (
                <div
                  className="w-16 h-16 md:w-20 md:h-20 rounded-xl flex items-center justify-center font-bold text-white"
                  style={{ backgroundColor: '#7c3aed' }}
                >
                  {team.abbreviation || team.name.slice(0, 3).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)]">
                  {team.name || `Team ${team.id}`}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    href={`/leagues/${encodeURIComponent(league.id)}`}
                    className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                    style={{ backgroundColor: '#7c3aed' }}
                  >
                    {league.name}
                  </Link>
                  <span className="text-[var(--text-tertiary)]">{league.season}</span>
                  {team.venue && (
                    <span className="text-[var(--text-tertiary)]">· {team.venue}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Form */}
            {formArray.length > 0 && (
              <div className="flex flex-col gap-1">
                <div className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
                  Last 5
                </div>
                <TeamForm form={formArray} size="md" />
              </div>
            )}
          </div>

          {/* Quick cards: next fixture + standing */}
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {/* Next fixture */}
            <div
              className="rounded-xl border p-4"
              style={{ backgroundColor: 'var(--muted-bg)', borderColor: 'var(--border-color)' }}
            >
              <div className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
                Next Fixture
              </div>
              {next_fixture ? (
                <Link
                  href={`/matches/${encodeURIComponent(next_fixture.match_id)}`}
                  className="mt-2 block hover:opacity-90"
                >
                  <div className="text-base font-semibold text-[var(--text-primary)]">
                    {next_fixture.is_home ? 'vs' : 'at'}{' '}
                    {next_fixture.opponent?.name || 'TBD'}
                  </div>
                  <div className="mt-1 text-sm text-[var(--text-secondary)]">
                    {formatKickoff(next_fixture.kickoff)}
                  </div>
                  {next_fixture.kickoff && (
                    <div className="mt-1 text-xs font-semibold" style={{ color: '#7c3aed' }}>
                      {countdown(next_fixture.kickoff)}
                    </div>
                  )}
                  {next_fixture.venue && (
                    <div className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {next_fixture.venue}
                    </div>
                  )}
                </Link>
              ) : (
                <div className="mt-2 text-sm text-[var(--text-tertiary)]">
                  No upcoming fixture scheduled.
                </div>
              )}
            </div>

            {/* League position */}
            <div
              className="rounded-xl border p-4"
              style={{ backgroundColor: 'var(--muted-bg)', borderColor: 'var(--border-color)' }}
            >
              <div className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
                League Position
              </div>
              <div className="mt-2 flex items-baseline gap-4">
                <div className="text-3xl font-bold text-[var(--text-primary)]">
                  {standing.position || '—'}
                </div>
                <div className="text-sm text-[var(--text-secondary)]">
                  {standing.points} pts · GD {goalDiff > 0 ? '+' : ''}
                  {goalDiff}
                </div>
              </div>
              <div className="mt-1 text-xs text-[var(--text-tertiary)]">
                {standing.played} played · {standing.won}W / {standing.drawn}D / {standing.lost}L
              </div>
            </div>
          </div>
        </header>

        {/* Tabs */}
        <TeamDetailTabs
          teamName={team.name || `Team ${team.id}`}
          recentResults={recent_results}
          upcomingFixtures={upcoming_fixtures}
          squad={squad}
          stats={stats}
          injuries={injuries}
        />
      </div>
    </main>
  )
}
