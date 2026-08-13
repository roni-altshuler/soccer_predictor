import { promises as fs } from 'fs'
import path from 'path'

import Link from 'next/link'

import { LeagueMark } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import {
  SERVED_COMPETITION_IDS,
  getLeagueAccent,
  isCovered,
} from '@/lib/leagueAccents'

/**
 * Competition directory.
 *
 * It used to list five leagues and, underneath, a "Not covered yet" block
 * promising MLS as Wave B and the Champions League as Wave C. Both had stopped
 * being true: `/season` projects nine leagues including MLS, and `/tournaments`
 * has published live bracket odds for fourteen knockout competitions since
 * 2026-08-11. A directory that tells a reader the product cannot do what the
 * next tab visibly does is worse than no directory.
 *
 * The distinction the old page was protecting is real and is kept, just moved
 * to where it belongs — on the row. Nine leagues are PROJECTED, each admitted
 * by a walk-forward against three baselines. Five of those additionally have a
 * closing price on every fixture and can therefore be placed against the
 * market. Saying "covered" for both would quietly promote four leagues into a
 * claim no measurement supports.
 */
export const metadata = {
  title: 'Leagues · Pitchverse',
  description: 'The leagues Pitchverse projects, and the record behind each.',
}

const ARTIFACT = path.join(
  process.cwd(),
  'backend',
  'data',
  'predictions',
  'season_projections.json',
)

interface Row {
  competitionId: string
  name: string
  country: string
  brier: number | null
  nScored: number | null
  marketScored: boolean
}

/**
 * The served leagues, with the record that admitted each.
 *
 * Falls back to the registry when the forecast artifact is missing — the page
 * is a directory first, so it must still list the leagues even on a checkout
 * where the nightly job has not run. It never invents a number to fill the
 * column: a league with no measured block renders without one.
 */
async function servedLeagues(): Promise<Row[]> {
  let measured: Record<string, { brier?: number; n_scored?: number }> = {}
  try {
    const parsed = JSON.parse(await fs.readFile(ARTIFACT, 'utf8'))
    for (const league of parsed.leagues ?? []) {
      measured[league.competition_id] = league.measured ?? {}
    }
  } catch {
    measured = {}
  }

  return SERVED_COMPETITION_IDS.map((id) => {
    const accent = getLeagueAccent(id)
    const m = measured[id] ?? {}
    return {
      competitionId: id,
      name: accent.displayName,
      country: accent.country,
      brier: typeof m.brier === 'number' ? m.brier : null,
      nScored: typeof m.n_scored === 'number' ? m.n_scored : null,
      marketScored: isCovered(id),
    }
  })
}

export default async function LeaguesPage() {
  const leagues = await servedLeagues()

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <div className="flex items-baseline justify-between gap-3 px-1 pb-1">
        <h1 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
          Leagues
        </h1>
        <span className="font-numeric text-[11px] tabular-nums text-[var(--text-tertiary)]">
          {leagues.length} projected
        </span>
      </div>
      <p className="mb-3 px-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        A league appears here once the model has beaten three baselines on it —
        a one-in-three guess, the league&rsquo;s own base rate, and always
        backing the home side — on a walk-forward that never sees a match
        before predicting it. Lower Brier is better.{' '}
        <span className="font-mono uppercase tracking-wide">vs closing line</span>{' '}
        marks the five that also carry a bookmaker price on every fixture.
      </p>

      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-[color-mix(in_srgb,var(--border-color)_40%,transparent)]">
          {leagues.map((league) => (
            <li key={league.competitionId}>
              <Link
                href={`/leagues/${league.competitionId}`}
                prefetch={false}
                className="group flex min-h-[56px] items-center gap-3 px-3 transition-colors hover:bg-[var(--card-hover)]"
              >
                <LeagueMark league={league.competitionId} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
                    {league.name}
                  </span>
                  {/* Country truncates, the marker never does. Appending the
                      marker to the country as one string put it behind an
                      ellipsis at 390px on three of the five leagues that have
                      it — the rows that carry the strongest evidence were the
                      ones whose evidence was cut off. */}
                  <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                    <span className="min-w-0 truncate">{league.country}</span>
                    {league.marketScored && (
                      <span className="shrink-0 rounded border border-[var(--border-color)] px-1 py-px font-mono text-[9px] uppercase tracking-wide">
                        vs closing line
                      </span>
                    )}
                  </span>
                </span>
                {league.brier !== null && (
                  <span className="shrink-0 text-right">
                    <span className="block font-numeric text-[12px] tabular-nums text-[var(--text-secondary)]">
                      {league.brier.toFixed(3)}
                    </span>
                    <span className="block font-numeric text-[10px] tabular-nums text-[var(--text-tertiary)]">
                      {league.nScored?.toLocaleString('en-GB')} scored
                    </span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <section className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          Knockout competitions
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          The Champions League, Europa League, World Cup and eleven more are
          forecast as brackets rather than tables — who advances a tie, and who
          lifts the trophy. They live on{' '}
          <Link
            href="/tournaments"
            className="font-semibold text-[var(--text-primary)] underline decoration-[var(--border-color)] underline-offset-2 hover:decoration-[var(--text-primary)]"
          >
            Tournaments
          </Link>
          .
        </p>
        <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          A knockout tie asks a binary question, so it is measured differently
          and never pooled with the league record above.
        </p>
      </section>
    </div>
  )
}
