import { promises as fs } from 'fs'
import path from 'path'

import Link from 'next/link'
import { ArrowRight, Swords } from 'lucide-react'

import { DocsRow } from '@/components/evidence/DocsLink'
import { LeagueMark } from '@/components/primitives'
import {
  SERVED_COMPETITION_IDS,
  getLeagueAccent,
  isCovered,
} from '@/lib/leagueAccents'
import { isCalendarYearLeague, seasonLabel } from '@/lib/seasons'

/**
 * Competition directory.
 *
 * It was a list of rows: badge, name, country, a Brier score. Everything on it
 * was true and none of it was what anyone opens a football app for. A reader
 * arriving here wants to know which league to go into, and the useful answer to
 * that is what is happening in it — who is favourite, how much of the season is
 * left — not how the model scored on it three years ago.
 *
 * So each league is a card carrying its own title race, drawn from the same
 * artifact the league page is built on. The measured record is still here, as a
 * line at the foot of the card rather than the headline: it belongs to
 * `/evaluation` now, and this page links there rather than competing with it.
 *
 * The distinction between projected and market-scored leagues is kept, and kept
 * on the row. Nine leagues are projected, each admitted by a walk-forward
 * against three baselines; five of those additionally carry a closing price on
 * every fixture. Saying "covered" for both would quietly promote four leagues
 * into a claim no measurement supports.
 */
export const metadata = {
  title: 'Leagues · Pitchverse',
  description: 'Every league Pitchverse projects, with its title race and its record.',
}

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'predictions',
  'season_projections.json',
)

interface Contender {
  team: string
  p: number
}

interface Row {
  competitionId: string
  name: string
  country: string
  brier: number | null
  nScored: number | null
  marketScored: boolean
  season: number | null
  fixturesRemaining: number | null
  teams: number | null
  /** The two or three clubs the projection actually separates. */
  race: Contender[]
  titleLabel: string
}

interface ArtifactLeague {
  competition_id: string
  season?: number
  fixtures_remaining?: number
  teams?: number
  groups?: unknown
  qualify_label?: string | null
  measured?: { brier?: number; n_scored?: number }
  table?: Array<{ team: string; p_title?: number; p_group_title?: number }>
}

/**
 * The served leagues, each with the shape of its season.
 *
 * Falls back to the registry when the forecast artifact is missing — the page
 * is a directory first, so it must still list the leagues on a checkout where
 * the nightly job has not run. It never invents a number to fill a card: a
 * league with no projection renders without a race rather than with a flat one.
 */
async function servedLeagues(): Promise<Row[]> {
  let byId: Record<string, ArtifactLeague> = {}
  try {
    const parsed = JSON.parse(await fs.readFile(ARTIFACT, 'utf8'))
    for (const league of (parsed.leagues ?? []) as ArtifactLeague[]) {
      byId[league.competition_id] = league
    }
  } catch {
    byId = {}
  }

  return SERVED_COMPETITION_IDS.map((id) => {
    const accent = getLeagueAccent(id)
    const league = byId[id]
    const measured = league?.measured ?? {}
    // A grouped league's title is the Supporters' Shield and its clubs are
    // separated by the conference race, so `p_title` is still the right
    // ordering — what changes is only what the number is called.
    const grouped = Boolean(league?.groups)
    const race = [...(league?.table ?? [])]
      .map((r) => ({ team: r.team, p: r.p_title ?? 0 }))
      .filter((r) => r.p > 0)
      .sort((a, b) => b.p - a.p)
      .slice(0, 3)

    return {
      competitionId: id,
      name: accent.displayName,
      country: accent.country,
      brier: typeof measured.brier === 'number' ? measured.brier : null,
      nScored: typeof measured.n_scored === 'number' ? measured.n_scored : null,
      marketScored: isCovered(id),
      season: league?.season ?? null,
      fixturesRemaining: league?.fixtures_remaining ?? null,
      teams: league?.teams ?? null,
      race,
      titleLabel: grouped ? 'Shield' : 'Title',
    }
  })
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`

const label = (competitionId: string, year: number) =>
  seasonLabel(year, isCalendarYearLeague(competitionId))

export default async function LeaguesPage() {
  const leagues = await servedLeagues()
  const projected = leagues.filter((l) => l.race.length)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] md:text-[28px]">
            Leagues
          </h1>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            {leagues.length} projected
            {projected.length ? ` · ${projected.length} in season` : ''}
          </p>
        </div>
        <DocsRow
          docs={[
            { doc: 'tutorialSeason', label: 'How to read a league' },
            { doc: 'scoring', hash: 'the-floors', label: 'What admits one here' },
          ]}
        />
      </header>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {leagues.map((league) => (
          <li key={league.competitionId}>
            <LeagueCard league={league} />
          </li>
        ))}
      </ul>

      <Link
        href="/tournaments"
        className="group mt-4 flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3.5 transition-colors hover:border-[color-mix(in_srgb,var(--accent-primary)_35%,var(--border-color))]"
      >
        <Swords className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
            Knockout competitions
          </span>
          <span className="block truncate text-[12px] text-[var(--text-tertiary)]">
            Champions League, Europa League, World Cup and eleven more — forecast as
            brackets rather than tables
          </span>
        </span>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </div>
  )
}

/**
 * One league, as the season it is in.
 *
 * The title race is drawn as bars rather than listed as percentages because
 * the comparison IS the information — a 38/31/12 race and a 74/9/6 race read
 * identically as three numbers in a column and completely differently as three
 * bars.
 */
function LeagueCard({ league }: { league: Row }) {
  const leader = league.race[0]

  return (
    <Link
      href={`/leagues/${league.competitionId}`}
      prefetch={false}
      className="group flex h-full flex-col rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 transition-colors hover:border-[color-mix(in_srgb,var(--accent-primary)_35%,var(--border-color))]"
    >
      <div className="flex items-start gap-3">
        <LeagueMark league={league.competitionId} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-[var(--text-primary)]">
            {league.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
            <span className="truncate">{league.country}</span>
            {league.season ? (
              <span className="font-mono tabular-nums">
                {label(league.competitionId, league.season)}
              </span>
            ) : null}
          </div>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>

      {league.race.length ? (
        <div className="mt-4 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              {league.titleLabel} race
            </span>
            {league.fixturesRemaining ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {league.fixturesRemaining.toLocaleString()} to play
              </span>
            ) : null}
          </div>
          <ul className="mt-2 space-y-1.5">
            {league.race.map((c) => (
              <li key={c.team} className="grid grid-cols-[1fr_2.2rem] items-center gap-x-2">
                <div className="min-w-0">
                  <div
                    className={cnRow(c === leader)}
                    title={c.team}
                  >
                    {c.team}
                  </div>
                  <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(3, (c.p / (leader?.p || 1)) * 100)}%`,
                        background:
                          c === leader
                            ? 'var(--accent-primary)'
                            : 'color-mix(in srgb, var(--text-tertiary) 70%, transparent)',
                      }}
                    />
                  </div>
                </div>
                <span className="text-right font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                  {pct(c.p)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 flex-1 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          No projection published for this season yet.
        </p>
      )}

      {/* The record, demoted to a footnote. It is the reason the league is on
          the site at all, and it is not what a reader came to this page for. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] pt-2.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {league.brier !== null ? (
          <span className="tabular-nums">Brier {league.brier.toFixed(3)}</span>
        ) : (
          <span>No measured record</span>
        )}
        {league.nScored ? (
          <span className="tabular-nums">· {league.nScored.toLocaleString()} scored</span>
        ) : null}
        {league.marketScored ? (
          <span className="rounded border border-[var(--border-color)] px-1 py-px">
            vs closing line
          </span>
        ) : null}
      </div>
    </Link>
  )
}

/** The leader is the only club at full contrast — same rule as the bracket. */
function cnRow(isLeader: boolean) {
  return [
    'truncate text-[12px]',
    isLeader
      ? 'font-semibold text-[var(--text-primary)]'
      : 'text-[var(--text-secondary)]',
  ].join(' ')
}
