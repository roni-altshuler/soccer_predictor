'use client'

import { useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'

/**
 * The season ahead.
 *
 * Everything on this page is a forecast of something that has not happened —
 * which makes it the one surface where the model is exposed rather than
 * reported. The order follows what a reader actually wants: who wins the
 * league, who goes down, and what the next fixtures look like.
 *
 * Two things are shown that a prediction page usually hides, because leaving
 * them out is what makes numbers like these unfalsifiable:
 *
 *  1. **The measured record**, at the top, in the same units. The model scored
 *     Brier .59303 walking forward over 43,433 matches it had not seen. That
 *     is the reason to believe the percentages below, and it belongs beside
 *     them rather than on a separate page.
 *  2. **What was tested and dropped.** Referee, rest, head-to-head, venue,
 *     attendance and kickoff time were all measured and none earned a place.
 */

interface TeamRow {
  team: string
  p_title: number
  p_top4: number
  p_relegated: number
  p_playoff: number | null
  exp_points: number
  exp_position: number
  played: number
  points: number
}

interface League {
  competition_id: string
  name: string
  country: string | null
  season: number
  fixtures_remaining: number
  teams: number
  relegation_places: number
  table: TeamRow[]
}

interface Fixture {
  competition_id: string
  date: string
  kickoff: string | null
  home: string
  away: string
  p_home: number
  p_draw: number
  p_away: number
  xg_home: number
  xg_away: number
  scorelines: { score: string; p: number }[]
}

interface Method {
  measured?: {
    brier: number
    ece: number
    n: number
    protocol: string
    beats?: Record<string, number>
  }
  excluded_after_measurement?: string[]
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

export default function SeasonPage() {
  const [leagues, setLeagues] = useState<League[]>([])
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [method, setMethod] = useState<Method | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    Promise.allSettled([
      fetch('/api/v1/season/projections', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/v1/season/fixtures?limit=400', { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([proj, fix]) => {
      if (!live) return
      if (proj.status === 'fulfilled' && proj.value?.available) {
        const ls = (proj.value.leagues ?? []) as League[]
        ls.sort((a, b) => a.name.localeCompare(b.name))
        setLeagues(ls)
        setMethod(proj.value.method ?? null)
        setSelected(ls[0]?.competition_id ?? '')
      }
      if (fix.status === 'fulfilled' && fix.value?.available) {
        setFixtures((fix.value.fixtures ?? []) as Fixture[])
      }
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [])

  const league = leagues.find((l) => l.competition_id === selected) ?? leagues[0]
  const next = useMemo(
    () =>
      fixtures
        .filter((f) => !league || f.competition_id === league.competition_id)
        .slice(0, 10),
    [fixtures, league],
  )

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header>
        <h1 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] md:text-[28px]">
          The season ahead
        </h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Trained on every match played since 2000 and asked about every one that has
          not been. Title, top four and relegation come from 20,000 simulations of the
          fixtures that remain.
        </p>
        {method?.measured ? (
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[var(--text-tertiary)]">
            Its record, in the same units: Brier{' '}
            <span className="text-[var(--text-secondary)]">
              {method.measured.brier.toFixed(5)}
            </span>{' '}
            and calibration error{' '}
            <span className="text-[var(--text-secondary)]">
              {method.measured.ece.toFixed(4)}
            </span>{' '}
            over{' '}
            <span className="text-[var(--text-secondary)]">
              {method.measured.n.toLocaleString()}
            </span>{' '}
            matches it had not seen, predicted one at a time in the order they were
            played. A coin-flip-equivalent prior scores .6476 on the same rows.
          </p>
        ) : null}
      </header>

      {loading ? (
        <div className="mt-8 h-64 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]" />
      ) : !leagues.length ? (
        <div className="mt-8">
          <EmptyState
            title="No season forecast has been generated here"
            description="It is a regenerable artifact, not shipped data. Run forecast_season to populate this page."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Leagues">
            {leagues.map((l) => (
              <button
                key={l.competition_id}
                type="button"
                role="tab"
                aria-selected={l.competition_id === league?.competition_id}
                onClick={() => setSelected(l.competition_id)}
                className={cn(
                  'rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors',
                  l.competition_id === league?.competition_id
                    ? 'border-[var(--accent-primary)] bg-[var(--card-hover)] text-[var(--text-primary)]'
                    : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                )}
              >
                {l.name}
              </button>
            ))}
          </div>

          {league ? (
            <>
              <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                    {league.name}{' '}
                    <span className="text-[var(--text-tertiary)]">
                      {league.season}/{String(league.season + 1).slice(2)}
                    </span>
                  </h2>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                    {league.fixtures_remaining} to play · {league.teams} teams ·{' '}
                    {league.relegation_places} go down
                  </span>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse font-mono text-[12px] tabular-nums">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                        <th className="pb-2 pr-3 font-medium">Club</th>
                        <th className="pb-2 pr-3 text-right font-medium">Title</th>
                        <th className="pb-2 pr-3 text-right font-medium">Top 4</th>
                        <th className="pb-2 pr-3 text-right font-medium">Relegated</th>
                        <th className="pb-2 pr-3 text-right font-medium">xPts</th>
                        <th className="pb-2 text-right font-medium">xPos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...league.table]
                        .sort((a, b) => a.exp_position - b.exp_position)
                        .map((t) => (
                          <tr
                            key={t.team}
                            className="border-t border-[var(--border-color)]"
                          >
                            <td className="max-w-[190px] truncate py-2 pr-3 font-sans text-[13px] text-[var(--text-secondary)]">
                              {t.team}
                            </td>
                            <td
                              className={cn(
                                'py-2 pr-3 text-right',
                                t.p_title >= 0.05
                                  ? 'text-[var(--accent-primary)]'
                                  : 'text-[var(--text-tertiary)]',
                              )}
                            >
                              {t.p_title >= 0.001 ? pct(t.p_title) : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right text-[var(--text-tertiary)]">
                              {t.p_top4 >= 0.001 ? pct(t.p_top4) : '—'}
                            </td>
                            <td
                              className={cn(
                                'py-2 pr-3 text-right',
                                t.p_relegated >= 0.2
                                  ? 'text-[var(--accent-warn)]'
                                  : 'text-[var(--text-tertiary)]',
                              )}
                            >
                              {t.p_relegated >= 0.001 ? pct(t.p_relegated) : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">
                              {t.exp_points.toFixed(0)}
                            </td>
                            <td className="py-2 text-right text-[var(--text-tertiary)]">
                              {t.exp_position.toFixed(1)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {next.length ? (
                <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5">
                  <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    Next fixtures
                  </h2>
                  <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
                    The three-way call, the expected goals, and the likeliest score. They
                    agree with each other by construction — the goal model is solved so
                    its scoreline grid reproduces the outcome probabilities the model was
                    measured on.
                  </p>
                  <ul className="mt-3.5 space-y-3">
                    {next.map((f) => (
                      <li key={`${f.date}-${f.home}-${f.away}`}>
                        <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                          <span>
                            {fmtDate(f.date)}
                            {f.kickoff ? ` · ${f.kickoff}` : ''}
                          </span>
                          <span>
                            xG {f.xg_home.toFixed(2)}–{f.xg_away.toFixed(2)} · likeliest{' '}
                            {f.scorelines[0]?.score} ({pct(f.scorelines[0]?.p ?? 0)})
                          </span>
                        </div>
                        <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-x-3">
                          <span className="truncate text-right text-[13px] text-[var(--text-primary)]">
                            {f.home}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                            {(f.p_home * 100).toFixed(0)} · {(f.p_draw * 100).toFixed(0)} ·{' '}
                            {(f.p_away * 100).toFixed(0)}
                          </span>
                          <span className="truncate text-[13px] text-[var(--text-primary)]">
                            {f.away}
                          </span>
                        </div>
                        <div className="mt-1.5 flex h-[3px] w-full overflow-hidden rounded-full">
                          <div
                            className="h-full bg-[var(--accent-primary)]"
                            style={{ width: `${f.p_home * 100}%` }}
                          />
                          <div
                            className="h-full bg-[var(--text-tertiary)]"
                            style={{ width: `${f.p_draw * 100}%` }}
                          />
                          <div
                            className="h-full bg-[var(--border-color)]"
                            style={{ width: `${f.p_away * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {method?.excluded_after_measurement?.length ? (
                <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                  Measured and dropped:{' '}
                  <span className="text-[var(--text-secondary)]">
                    {method.excluded_after_measurement.join(', ')}
                  </span>
                  . Each was added to the model, scored on matches it had not seen, and
                  removed because it did not improve the forecast. The referee group was
                  the most expensive to test — it needed a 207,000-fixture scrape to make
                  the question askable outside England — and the answer was still no.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
