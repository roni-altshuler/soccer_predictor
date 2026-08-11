'use client'

import { useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { EvidencePanel } from '@/components/forecast/EvidencePanel'
import type { Historical, Live } from '@/components/forecast/EvidencePanel'
import { FixtureCard } from '@/components/forecast/FixtureCard'
import type { FixtureForecast } from '@/components/forecast/FixtureCard'
import { ProbabilityRow } from '@/components/forecast/ProbabilityBar'
import { ProjectedTable } from '@/components/forecast/ProjectedTable'
import type { ProjectedRow } from '@/components/forecast/ProjectedTable'
import { cn } from '@/lib/utils'

/**
 * The season ahead — the flagship forecasting surface.
 *
 * Hierarchy follows what a reader wants, in order: which league, who wins it,
 * the full projected table, what is on next, and then the evidence that any of
 * it is worth reading.
 *
 * The evidence block is on the page rather than behind a link because these
 * percentages are unfalsifiable without it. It is the first thing that gets
 * dropped in a redesign and there is a test asserting it stays.
 */

interface League {
  competition_id: string
  name: string
  country: string | null
  season: number
  fixtures_remaining: number
  teams: number
  relegation_places: number
  table: ProjectedRow[]
}

interface Method {
  model_version?: string
  trained_through?: string
  measured?: { brier: number; ece: number; n: number }
  excluded_after_measurement?: string[]
}

const fmtStamp = (iso?: string) => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

export default function SeasonPage() {
  const [leagues, setLeagues] = useState<League[]>([])
  const [fixtures, setFixtures] = useState<FixtureForecast[]>([])
  const [method, setMethod] = useState<Method | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | undefined>()
  const [historical, setHistorical] = useState<Historical | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    Promise.allSettled([
      fetch('/api/v1/season/projections', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/v1/season/fixtures?limit=600', { cache: 'no-store' }).then((r) =>
        r.json(),
      ),
      fetch('/api/v1/evaluation', { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([proj, fix, evalRes]) => {
      if (!alive) return
      if (proj.status === 'fulfilled' && proj.value?.available) {
        const ls = (proj.value.leagues ?? []) as League[]
        ls.sort((a, b) => a.name.localeCompare(b.name))
        setLeagues(ls)
        setMethod(proj.value.method ?? null)
        setGeneratedAt(proj.value.generated_at)
        setSelected(ls[0]?.competition_id ?? '')
      }
      if (fix.status === 'fulfilled' && fix.value?.available) {
        setFixtures((fix.value.fixtures ?? []) as FixtureForecast[])
      }
      if (evalRes.status === 'fulfilled') {
        setHistorical((evalRes.value?.historical ?? null) as Historical | null)
        setLive((evalRes.value?.live ?? null) as Live | null)
      }
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const league = leagues.find((l) => l.competition_id === selected) ?? leagues[0]

  const titleRace = useMemo(() => {
    if (!league) return []
    return [...league.table]
      .filter((t) => t.p_title >= 0.005)
      .sort((a, b) => b.p_title - a.p_title)
      .slice(0, 6)
  }, [league])

  const relegationRace = useMemo(() => {
    if (!league) return []
    return [...league.table]
      .filter((t) => t.p_relegated >= 0.05)
      .sort((a, b) => b.p_relegated - a.p_relegated)
      .slice(0, 6)
  }, [league])

  const nextFixtures = useMemo(
    () =>
      fixtures
        .filter((f) => !league || f.competition_id === league.competition_id)
        .slice(0, 6),
    [fixtures, league],
  )

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header>
        <h1 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] md:text-[28px]">
          The season ahead
        </h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Trained on every match played since 2000 and asked about every one still to
          come. Title, top four and relegation come from 20,000 simulations of the
          fixtures that remain.
        </p>
      </header>

      {loading ? (
        <div
          className="mt-8 h-64 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
          role="status"
          aria-label="Loading forecast"
        />
      ) : !leagues.length ? (
        <div className="mt-8">
          <EmptyState
            title="No season forecast has been generated here"
            description="It is a regenerable artifact, not shipped data. Run forecast_season to populate this page."
          />
        </div>
      ) : (
        <div className="mt-7 space-y-6">
          <nav aria-label="Leagues">
            <ul className="flex flex-wrap gap-1.5">
              {leagues.map((l) => (
                <li key={l.competition_id}>
                  <button
                    type="button"
                    aria-current={l.competition_id === league?.competition_id ? 'true' : undefined}
                    onClick={() => setSelected(l.competition_id)}
                    className={cn(
                      'rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]',
                      l.competition_id === league?.competition_id
                        ? 'border-[var(--accent-primary)] bg-[var(--card-hover)] text-[var(--text-primary)]'
                        : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                    )}
                  >
                    {l.name}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {league ? (
            <>
              <section
                className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
                aria-labelledby="league-heading"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2
                    id="league-heading"
                    className="text-[17px] font-semibold text-[var(--text-primary)]"
                  >
                    {league.name}{' '}
                    <span className="text-[var(--text-tertiary)]">
                      {league.season}/{String(league.season + 1).slice(2)}
                    </span>
                  </h2>
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                    {league.fixtures_remaining} fixtures remaining
                    {fmtStamp(generatedAt) ? ` · updated ${fmtStamp(generatedAt)} UTC` : ''}
                  </p>
                </div>

                <div className="mt-5 grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                      Title race
                    </h3>
                    <ul className="mt-3 space-y-2.5">
                      {titleRace.map((t) => (
                        <li key={t.team}>
                          <ProbabilityRow
                            label={t.team}
                            value={t.p_title}
                            max={titleRace[0]?.p_title ?? 1}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                      Relegation race
                    </h3>
                    {relegationRace.length ? (
                      <ul className="mt-3 space-y-2.5">
                        {relegationRace.map((t) => (
                          <li key={t.team}>
                            <ProbabilityRow
                              label={t.team}
                              value={t.p_relegated}
                              max={relegationRace[0]?.p_relegated ?? 1}
                              tone="warn"
                            />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-[12px] text-[var(--text-tertiary)]">
                        No club is above a 5% relegation risk in this league.
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <section
                className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
                aria-labelledby="table-heading"
              >
                <h2
                  id="table-heading"
                  className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
                >
                  Projected final table
                </h2>
                <ProjectedTable
                  className="mt-3.5"
                  rows={league.table}
                  relegationPlaces={league.relegation_places}
                />
              </section>

              {nextFixtures.length ? (
                <section aria-labelledby="fixtures-heading">
                  <h2
                    id="fixtures-heading"
                    className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
                  >
                    Next fixtures
                  </h2>
                  <div className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {nextFixtures.map((f) => (
                      <FixtureCard
                        key={f.fixture_uid ?? `${f.date}-${f.home}-${f.away}`}
                        fixture={f}
                        href={
                          f.fixture_uid ? `/season/fixture/${f.fixture_uid}` : undefined
                        }
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              <EvidencePanel historical={historical} live={live} />

              {method?.model_version ? (
                <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                  Model <code className="text-[var(--text-secondary)]">{method.model_version}</code>
                  {method.trained_through
                    ? `, trained on matches through ${method.trained_through}`
                    : ''}
                  . Every forecast is recorded before kickoff and kept, so what was shown
                  here can be scored later against what happened.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
