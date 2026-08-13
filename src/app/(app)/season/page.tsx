'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { DocsRow } from '@/components/evidence/DocsLink'
import { EvidencePanel } from '@/components/forecast/EvidencePanel'
import type { Historical, Live } from '@/components/forecast/EvidencePanel'
import { FixtureCard } from '@/components/forecast/FixtureCard'
import type { FixtureForecast } from '@/components/forecast/FixtureCard'
import { FixtureList } from '@/components/forecast/FixtureList'
import { LeagueSelect, orderLeagues, seasonLabel } from '@/components/forecast/LeagueSelect'
import { ProbabilityRow } from '@/components/forecast/ProbabilityBar'
import type { ProjectedRow } from '@/components/forecast/ProjectedTable'
import { StandingsTable } from '@/components/forecast/StandingsTable'
import type { GroupMeta } from '@/components/forecast/StandingsTable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * The season ahead — the flagship forecasting surface.
 *
 * The page shows one league at a time, and everything on it belongs to that
 * league. That single rule is what the structure comes from:
 *
 *  - **The league picker is one control, not seven chips.** Seven chips wrapped
 *    to two lines on a phone and left six irrelevant leagues on screen
 *    permanently. See LeagueSelect.
 *  - **Three views, not one scroll.** Races, the projected table and the
 *    fixture list are three questions — who wins it, where does everyone
 *    finish, what is on next — and stacking all three made a page nobody
 *    reached the bottom of. They are tabs; the reader picks.
 *  - **The evidence is not one of the tabs.** It sits below them, always
 *    rendered, because these percentages are unfalsifiable without it and a
 *    tab is a place things go to be unread. There is a test asserting it stays.
 *
 * The chosen league is written to the URL and to localStorage, so a link is
 * shareable and a return visit opens where the reader left off. Done with the
 * history API rather than the Next router: this is a client-side filter over
 * data the page already has, and a router push would re-run the route for a
 * state change that never leaves the browser.
 */

interface League {
  competition_id: string
  name: string
  country: string | null
  season: number
  fixtures_remaining: number
  teams: number
  relegation_places: number
  top_cut?: number
  top_cut_label?: string
  schedule_completeness?: number | null
  /** Present only where the competition ranks inside groups, e.g. MLS. */
  groups?: GroupMeta[] | null
  qualify_label?: string | null
  /** This league's OWN walk-forward record. Never another league's. */
  measured?: {
    n_scored: number
    brier: number
    accuracy: number
    uniform: number
    base_rate: number
    always_home: number
  } | null
  table: ProjectedRow[]
}

interface Method {
  model_version?: string
  trained_through?: string
  measured?: { brier: number; ece: number; n: number }
  excluded_after_measurement?: string[]
}

const STORAGE_KEY = 'pitchverse.season.league'

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

/** The league to open on: the URL, then last time, then the first listed. */
function initialLeague(leagues: League[]): string {
  const ids = new Set(leagues.map((l) => l.competition_id))
  if (typeof window !== 'undefined') {
    const fromUrl = new URLSearchParams(window.location.search).get('league')
    if (fromUrl && ids.has(fromUrl)) return fromUrl
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved && ids.has(saved)) return saved
    } catch {
      // Private browsing. Not worth a broken page.
    }
  }
  return orderLeagues(leagues)[0]?.competition_id ?? ''
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
      fetch('/api/v1/season/fixtures?limit=2000', { cache: 'no-store' }).then((r) =>
        r.json(),
      ),
      fetch('/api/v1/evaluation', { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([proj, fix, evalRes]) => {
      if (!alive) return
      if (proj.status === 'fulfilled' && proj.value?.available) {
        const ls = orderLeagues((proj.value.leagues ?? []) as League[])
        setLeagues(ls)
        setMethod(proj.value.method ?? null)
        setGeneratedAt(proj.value.generated_at)
        setSelected(initialLeague(ls))
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

  const selectLeague = useCallback((id: string) => {
    setSelected(id)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // ignore
    }
    const url = new URL(window.location.href)
    url.searchParams.set('league', id)
    window.history.replaceState(null, '', url)
  }, [])

  const league = leagues.find((l) => l.competition_id === selected) ?? leagues[0]

  const titleRace = useMemo(() => {
    if (!league) return []
    return [...league.table]
      .filter((t) => t.p_title >= 0.005)
      .sort((a, b) => b.p_title - a.p_title)
      .slice(0, 6)
  }, [league])

  // The second race is whatever this competition's bottom half is actually
  // playing for. Most leagues relegate; MLS does not, and the live question
  // there is the last playoff place — so the panel changes question rather
  // than showing a column of dashes.
  const relegationRace = useMemo(() => {
    if (!league || !league.relegation_places) return []
    return [...league.table]
      .filter((t) => (t.p_relegated ?? 0) >= 0.05)
      .sort((a, b) => (b.p_relegated ?? 0) - (a.p_relegated ?? 0))
      .slice(0, 6)
  }, [league])

  const qualifyRace = useMemo(() => {
    if (!league?.groups?.length) return []
    return [...league.table]
      .filter((t) => (t.p_qualify ?? 0) > 0.02 && (t.p_qualify ?? 0) < 0.98)
      .sort((a, b) => (b.p_qualify ?? 0) - (a.p_qualify ?? 0))
      .slice(0, 6)
  }, [league])

  const leagueFixtures = useMemo(
    () =>
      league
        ? fixtures.filter((f) => f.competition_id === league.competition_id)
        : [],
    [fixtures, league],
  )

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header>
        <h1 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] md:text-[28px]">
          The season ahead
        </h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Every probability here is the share of 20,000 simulated seasons in which it
          happened.
        </p>
        <DocsRow
          className="mt-3"
          docs={[
            { doc: 'tutorialSeason', label: 'How to read this' },
            { doc: 'models', hash: '2-season-projection--monte-carlo', label: 'How it is simulated' },
          ]}
        />
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
      ) : league ? (
        <div className="mt-6 space-y-5">
          {/* ---- the one control that changes everything below ---------- */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <LeagueSelect
              leagues={leagues}
              value={league.competition_id}
              onChange={selectLeague}
            />
            <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] text-[var(--text-tertiary)] sm:text-right">
              {league.fixtures_remaining} fixtures remaining
              {fmtStamp(generatedAt) ? (
                <>
                  <span className="hidden sm:inline"> · </span>
                  <span className="block sm:inline">
                    updated {fmtStamp(generatedAt)} UTC
                  </span>
                </>
              ) : null}
            </p>
          </div>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
              <TabsTrigger value="fixtures">Fixtures</TabsTrigger>
            </TabsList>

            {/* ---- overview: the two questions people arrive with ------- */}
            <TabsContent value="overview" className="mt-4 space-y-5">
              <section
                className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
                aria-labelledby="races-heading"
              >
                <h2 id="races-heading" className="sr-only">
                  {league.name} {seasonLabel(league.season)} — who wins it and who
                  goes down
                </h2>
                <div className="grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                      {league.groups?.length
                        ? 'Supporters’ Shield'
                        : 'Title race'}
                    </h3>
                    <ul className="mt-3 space-y-2.5">
                      {titleRace.map((t) => (
                        <li key={t.team}>
                          <ProbabilityRow
                            competitionId={league.competition_id}
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
                      {league.groups?.length
                        ? `${league.qualify_label ?? 'Qualification'} — still open`
                        : 'Relegation race'}
                    </h3>
                    {league.groups?.length ? (
                      qualifyRace.length ? (
                        <ul className="mt-3 space-y-2.5">
                          {qualifyRace.map((t) => (
                            <li key={t.team}>
                              <ProbabilityRow
                                label={t.team}
                                value={t.p_qualify ?? 0}
                                max={qualifyRace[0]?.p_qualify ?? 1}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-[12px] text-[var(--text-tertiary)]">
                          Every club is already clear either way — none sits
                          between a 2% and a 98% chance of qualifying.
                        </p>
                      )
                    ) : relegationRace.length ? (
                      <ul className="mt-3 space-y-2.5">
                        {relegationRace.map((t) => (
                          <li key={t.team}>
                            <ProbabilityRow
                              competitionId={league.competition_id}
                              label={t.team}
                              value={t.p_relegated ?? 0}
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

              {leagueFixtures.length ? (
                <section aria-labelledby="next-heading">
                  <h2
                    id="next-heading"
                    className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
                  >
                    Next fixtures
                  </h2>
                  <div className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {leagueFixtures.slice(0, 6).map((f) => (
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
            </TabsContent>

            {/* ---- table ----------------------------------------------- */}
            <TabsContent value="table" className="mt-4">
              <section
                className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
                aria-labelledby="table-heading"
              >
                <h2
                  id="table-heading"
                  className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
                >
                  {league.groups?.length
                    ? 'Projected standings'
                    : 'Projected final table'}
                </h2>
                <StandingsTable
                  className="mt-3.5"
                  rows={league.table}
                  competitionId={league.competition_id}
                  relegationPlaces={league.relegation_places}
                  topCut={league.top_cut ?? 4}
                  topCutLabel={league.top_cut_label ?? 'Top 4'}
                  groups={league.groups}
                  qualifyLabel={league.qualify_label}
                />
                {league.schedule_completeness != null &&
                league.schedule_completeness < 1 ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--accent-warn)]">
                    {Math.round(league.schedule_completeness * 100)}% of this
                    season&apos;s fixtures have a date. The table is projected from
                    the ones that do.
                  </p>
                ) : null}
              </section>
            </TabsContent>

            {/* ---- fixtures -------------------------------------------- */}
            <TabsContent value="fixtures" className="mt-4">
              <section
                className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
                aria-labelledby="fixtures-heading"
              >
                <h2
                  id="fixtures-heading"
                  className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
                >
                  Every fixture left
                </h2>
                <FixtureList className="mt-3.5" fixtures={leagueFixtures} />
              </section>
            </TabsContent>
          </Tabs>

          <LeagueRecord league={league} />

          <EvidencePanel historical={historical} live={live} />

          {method?.model_version ? (
            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              Model <code className="text-[var(--text-secondary)]">{method.model_version}</code>
              {method.trained_through
                ? `, trained on matches through ${method.trained_through}`
                : ''}
              . Recorded before kickoff and kept.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * What the model has actually done in THIS league.
 *
 * The headline .59303 was measured on Europe's top five. The same model scores
 * .63810 in the Championship — still better than every baseline, but a reader
 * looking at Burnley deserves the number for their league rather than one
 * borrowed from a division they are not reading about. Measured by
 * `league_gate.py`, which is also what decides whether a league appears here
 * at all.
 */
function LeagueRecord({ league }: { league: League }) {
  const m = league.measured
  if (!m) return null
  const gain = m.uniform - m.brier

  return (
    <section
      className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
      aria-labelledby="league-record-heading"
    >
      <h2
        id="league-record-heading"
        className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
      >
        This league&apos;s record
      </h2>
      <dl className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: 'Matches scored', v: m.n_scored.toLocaleString() },
          { k: 'Brier score', v: m.brier.toFixed(5) },
          { k: 'One-in-three', v: m.uniform.toFixed(5) },
          { k: 'Always home', v: m.always_home.toFixed(5) },
        ].map((x) => (
          <div key={x.k}>
            <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              {x.k}
            </dt>
            <dd className="font-mono text-[16px] tabular-nums text-[var(--text-primary)]">
              {x.v}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
        Walk-forward over {league.name} alone. Lower is better: it beats a one-in-three
        guess by {gain.toFixed(5)}, and beating that guess, the league&apos;s own base
        rate and always-home is what admitted it to this page.
      </p>
      <DocsRow
        className="mt-3"
        docs={[{ doc: 'scoring', hash: 'the-floors', label: 'What these floors are' }]}
      />
    </section>
  )
}
