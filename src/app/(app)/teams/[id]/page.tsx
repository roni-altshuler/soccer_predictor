import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SmartBackLink } from '@/components/SmartBackLink'
import { FollowTeamButton } from '@/components/team/FollowTeamButton'
import { fetchTeamOverview } from '@/lib/server/espnTeamOverview'

/**
 * /teams/[id] — one club, the football facts only.
 *
 * Every club name on MatchCard, StandingsTable and LeagueHomePage links here,
 * so this page is reached from everywhere and must hold the site's rules
 * hardest: absent provider data renders as `—` or the section is omitted —
 * never a placeholder — and no model number appears anywhere. The model's
 * claims live on match and league pages, where they sit beside the evidence
 * panel that makes them falsifiable; a team page repeating them would be a
 * probability with no argument attached.
 *
 * Data is ESPN's team overview, fetched server-side (the payload shape is
 * shared with FastAPI's /api/v1/teams/{id}/overview — see
 * `src/lib/server/espnTeamOverview.ts`). Dates are formatted in UTC with an
 * explicit `timeZone`, the same deterministic idiom `formatKickoff` in
 * FixtureCard uses, so the server render cannot disagree with itself.
 */

interface OverviewFixture {
  match_id: string
  kickoff: unknown
  venue: unknown
  is_home: boolean
  opponent: { id: string; name: string }
  self_score: number | null
  opponent_score: number | null
  status: string
  completed: boolean
}

interface SquadPlayer {
  player_id: string
  name: string
  position: string
  number: number | null
  nationality: string
}

interface TeamOverview {
  team: {
    id: string
    name: string
    abbreviation: string
    logo: string | null
    color: string | null
  }
  league: { id: string | null; name: string }
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
  next_fixture: OverviewFixture | null
  recent_results: OverviewFixture[]
  upcoming_fixtures: OverviewFixture[]
  squad: SquadPlayer[]
  stats: { goals_per_match: number; conceded_per_match: number }
  generated_at: string
}

const VALID_ID = /^\d+$/

function ordinal(n: number): string {
  const rem10 = n % 10
  const rem100 = n % 100
  if (rem10 === 1 && rem100 !== 11) return `${n}st`
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`
  return `${n}th`
}

function parseIso(iso: unknown): Date | null {
  if (typeof iso !== 'string' || iso.length === 0) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** `'2026-08-30T14:00Z'` → `'Sat 30 Aug'`. */
function fixtureDate(iso: unknown): string {
  const d = parseIso(iso)
  if (!d) return '—'
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** `'2026-08-30T14:00Z'` → `'14:00'`. */
function fixtureTime(iso: unknown): string {
  const d = parseIso(iso)
  if (!d) return '—'
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })
}

/** `'2026-08-25T09:00:00Z'` → `'25 Aug 2026, 09:00 UTC'` for the footer stamp. */
function stampDate(iso: unknown): string {
  const d = parseIso(iso)
  if (!d) return '—'
  const day = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return `${day}, ${fixtureTime(iso)} UTC`
}

/** W beats D beats nothing: derived from the scoreline, never from colour. */
function resultLetter(fixture: OverviewFixture): 'W' | 'D' | 'L' | null {
  if (fixture.self_score === null || fixture.opponent_score === null) return null
  if (fixture.self_score > fixture.opponent_score) return 'W'
  if (fixture.self_score < fixture.opponent_score) return 'L'
  return 'D'
}

const LETTER_COLOR: Record<'W' | 'D' | 'L', string> = {
  W: 'var(--accent-primary)',
  D: 'var(--accent-warn)',
  L: 'var(--accent-loss)',
}

/**
 * One W/D/L letter chip. The letter IS the value — colour reinforces it and
 * never replaces it (hard rule: nothing on this site is colour-alone).
 */
function ResultChip({ letter }: { letter: 'W' | 'D' | 'L' }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold leading-none"
      style={{ backgroundColor: LETTER_COLOR[letter], color: 'var(--accent-on-primary)' }}
    >
      {letter}
    </span>
  )
}

function FormChips({ form }: { form: string }) {
  const letters = form
    .toUpperCase()
    .split('')
    .filter((c): c is 'W' | 'D' | 'L' => c === 'W' || c === 'D' || c === 'L')
  if (letters.length === 0) return <>—</>
  return (
    <span className="flex items-center gap-1" aria-label={`Form: ${letters.join(' ')}`}>
      {letters.map((letter, i) => (
        <ResultChip key={`${letter}-${i}`} letter={letter} />
      ))}
    </span>
  )
}

function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        {label}
      </p>
      <div className="mt-1.5 text-lg tabular-nums text-[var(--text-primary)]">{value}</div>
    </div>
  )
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
      {children}
    </h2>
  )
}

/** GK → defence → midfield → attack, the order a team sheet reads in. */
function positionRank(position: string): number {
  const p = position.trim().toUpperCase()
  if (p.startsWith('G')) return 0
  if (p.startsWith('D')) return 1
  if (p.startsWith('M')) return 2
  if (p.startsWith('F') || p.startsWith('A') || p.startsWith('S')) return 3
  return 4
}

async function getOverview(id: string): Promise<TeamOverview | null> {
  if (!VALID_ID.test(id)) return null
  try {
    return (await fetchTeamOverview(id)) as unknown as TeamOverview | null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getOverview(id)
  const name = data?.team?.name
  return { title: name ? `${name} · Pitchverse` : 'Team · Pitchverse' }
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!VALID_ID.test(id)) notFound()

  const data = await getOverview(id)
  if (!data || !data.team?.name) notFound()

  const { team, league, standing } = data
  const upcoming = (data.upcoming_fixtures ?? []).filter((f) => f?.match_id)
  const recent = (data.recent_results ?? []).filter((f) => f?.match_id)
  const squad = (data.squad ?? [])
    .filter((p) => p?.name)
    .slice()
    .sort(
      (a, b) =>
        positionRank(a.position) - positionRank(b.position) ||
        (a.number ?? Number.POSITIVE_INFINITY) - (b.number ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    )

  const hasRecord = standing.played > 0
  const subline = [league.name, standing.position > 0 ? ordinal(standing.position) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 md:px-6 md:py-8">
      <header>
        <SmartBackLink fallbackHref="/" label="Back" />
        <div className="mt-3 flex items-center gap-4">
          {team.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- ESPN crest; the club name sits beside it
            <img src={team.logo} alt="" className="h-14 w-14 object-contain" />
          ) : null}
          <div className="min-w-0">
            <h1 className="text-2xl">{team.name}</h1>
            {subline ? (
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                {subline}
              </p>
            ) : null}
          </div>
          <FollowTeamButton
            teamName={team.name}
            league={league.name}
            className="ml-auto shrink-0"
          />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Position"
          value={standing.position > 0 ? ordinal(standing.position) : '—'}
        />
        <StatTile
          label="Record"
          value={hasRecord ? `${standing.won}-${standing.drawn}-${standing.lost}` : '—'}
        />
        <StatTile label="Points" value={hasRecord ? standing.points : '—'} />
        <StatTile label="Form" value={<FormChips form={standing.form_string ?? ''} />} />
      </section>

      {upcoming.length > 0 ? (
        <section>
          <SectionHeading>Upcoming</SectionHeading>
          <div className="divide-y divide-[var(--border-color)] overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
            {upcoming.map((fixture) => (
              <Link
                key={fixture.match_id}
                href={`/matches/${fixture.match_id}`}
                className="flex min-h-[44px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--card-hover)]"
              >
                <span className="w-24 shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                  {fixtureDate(fixture.kickoff)}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                  {fixture.is_home ? 'vs' : 'at'}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">
                  {fixture.opponent?.name || '—'}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]">
                  {fixtureTime(fixture.kickoff)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section>
          <SectionHeading>Recent results</SectionHeading>
          <div className="divide-y divide-[var(--border-color)] overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
            {recent.map((fixture) => {
              const letter = resultLetter(fixture)
              return (
                <Link
                  key={fixture.match_id}
                  href={`/matches/${fixture.match_id}`}
                  className="flex min-h-[44px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--card-hover)]"
                >
                  {letter ? <ResultChip letter={letter} /> : <span className="w-5 shrink-0" />}
                  <span className="w-9 shrink-0 font-mono text-sm tabular-nums text-[var(--text-primary)]">
                    {fixture.self_score !== null && fixture.opponent_score !== null
                      ? `${fixture.self_score}-${fixture.opponent_score}`
                      : '—'}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                    {fixture.is_home ? 'vs' : 'at'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">
                    {fixture.opponent?.name || '—'}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                    {fixtureDate(fixture.kickoff)}
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}

      {squad.length > 0 ? (
        <section>
          <SectionHeading>Squad</SectionHeading>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-color)] text-left text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  <th className="w-12 px-4 py-2 text-right font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Pos</th>
                  <th className="px-4 py-2 font-semibold">Nationality</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {squad.map((player) => (
                  <tr key={player.player_id || player.name}>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--text-tertiary)]">
                      {player.number ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-primary)]">{player.name}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-secondary)]">
                      {player.position || '—'}
                    </td>
                    <td className="px-4 py-2 text-[var(--text-secondary)]">
                      {player.nationality || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* No provider name here — DESIGN.md's copy rule keeps provenance out
          of the UI. The date alone says whether the page is fresh. */}
      <footer className="font-mono text-[10px] text-[var(--text-tertiary)]">
        Updated {stampDate(data.generated_at)}
      </footer>
    </div>
  )
}
