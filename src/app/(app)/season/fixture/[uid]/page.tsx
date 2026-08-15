'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { MatchDetail } from '@/components/fixture/MatchDetail'
import { RecordedForecastPanel } from '@/components/fixture/RecordedForecast'
import { ProbabilityBar } from '@/components/forecast/ProbabilityBar'
import { formatKickoff } from '@/components/forecast/FixtureCard'
import type { FixtureForecast } from '@/components/forecast/FixtureCard'
import type { RecordedForecast } from '@/lib/server/recordedForecast'
import type { MatchCard } from '@/lib/server/tieFixtures'

/**
 * One match: what the model expects, and what actually happened.
 *
 * **The match card here is the same component a knockout tie gets.** A reader
 * who has learned to read a Premier League fixture should not have to learn a
 * second layout for a Champions League one, so `MatchDetail` renders both and
 * the forecast rides inside it. Before this, a league fixture showed four model
 * panels and no match at all — no lineups, no timeline, no head-to-head — while
 * a tie showed everything, which read as two different products.
 *
 * Below the card sits the depth the model has and ESPN does not: the goal
 * rates, the scoreline distribution and the two Elo ratings that drove the
 * whole forecast.
 */

interface Payload {
  available: boolean
  generated_at?: string
  method?: { model_version?: string; trained_through?: string }
  fixture?: FixtureForecast
  match?: MatchCard | null
  recorded?: RecordedForecast | null
  reason?: string
}

const LEAGUE_NAMES: Record<string, string> = {
  'eng.1': 'Premier League',
  'esp.1': 'La Liga',
  'ger.1': 'Bundesliga',
  'ita.1': 'Serie A',
  'fra.1': 'Ligue 1',
  'ned.1': 'Eredivisie',
  'por.1': 'Primeira Liga',
  'usa.1': 'MLS',
}

export default function FixtureForecastPage() {
  const params = useParams<{ uid: string }>()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!params?.uid) return
    let alive = true
    fetch(`/api/v1/season/fixture/${params.uid}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setData(d as Payload)
        setLoading(false)
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [params?.uid])

  const f = data?.fixture

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      {/* The only way back on this page, so it is sized for a thumb rather
          than laid out as a caption. */}
      <Link
        href="/season"
        className="-ml-2 inline-flex min-h-[2.25rem] items-center rounded-lg px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
      >
        ← The season ahead
      </Link>

      {loading ? (
        <div
          className="mt-6 h-72 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
          role="status"
          aria-label="Loading forecast"
        />
      ) : !f ? (
        <div className="mt-6">
          <EmptyState
            title="No forecast for this fixture"
            description={
              data?.reason ??
              'It may already have been played, or it is outside the leagues this model covers.'
            }
          />
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {data?.match ? (
            <MatchDetail
              card={data.match}
              competitionId={f.competition_id}
              heading={`${LEAGUE_NAMES[f.competition_id] ?? f.competition_id}${
                f.round ? ` · Matchday ${f.round}` : ''
              }`}
              model={
                // The recorded forecast when one is on file — it can prove it
                // predates kickoff and it knows how it scored. The live
                // artifact is the fallback for a fixture the record has not
                // caught up with, and it can claim neither.
                data.recorded ? (
                  <RecordedForecastPanel
                    recorded={data.recorded}
                    homeName={f.home}
                    awayName={f.away}
                  />
                ) : (
                  <>
                    <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                      What the model expects
                    </h2>
                    <ProbabilityBar
                      className="mt-3"
                      probabilities={{ home: f.p_home, draw: f.p_draw, away: f.p_away }}
                      homeLabel={f.home}
                      awayLabel={f.away}
                    />
                  </>
                )
              }
            />
          ) : (
            <>
              <header>
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                  {LEAGUE_NAMES[f.competition_id] ?? f.competition_id}
                  {f.round ? ` · ${f.round}` : ''}
                </p>
                <h1 className="mt-2 text-[24px] font-semibold leading-tight text-[var(--text-primary)] md:text-[30px]">
                  {f.home}
                  <span className="mx-2 text-[16px] font-normal uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    vs
                  </span>
                  {f.away}
                </h1>
                <time
                  dateTime={`${f.date}${f.kickoff ? `T${f.kickoff}` : ''}`}
                  className="mt-1.5 block font-mono text-[12px] text-[var(--text-secondary)]"
                >
                  {formatKickoff(f.date, f.kickoff)} UTC
                </time>
              </header>

              <section
                className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
                aria-labelledby="outcome-heading"
              >
                <h2
                  id="outcome-heading"
                  className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
                >
                  Match outcome
                </h2>
                <ProbabilityBar
                  className="mt-3.5"
                  probabilities={{ home: f.p_home, draw: f.p_draw, away: f.p_away }}
                  homeLabel={f.home}
                  awayLabel={f.away}
                />
                <p className="mt-3.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  These three add to 100% and are the model&apos;s complete answer. There is
                  no fourth outcome and no &quot;likely winner&quot; beyond what the largest
                  of them says.
                </p>
              </section>
            </>
          )}

          <section
            className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
            aria-labelledby="goals-heading"
          >
            <h2
              id="goals-heading"
              className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
            >
              Goals
            </h2>
            <dl className="mt-3.5 grid grid-cols-2 gap-4">
              <div>
                <dt className="truncate text-[12px] text-[var(--text-tertiary)]">
                  {f.home}
                </dt>
                <dd className="font-mono text-[26px] tabular-nums text-[var(--text-primary)]">
                  {f.xg_home.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt className="truncate text-[12px] text-[var(--text-tertiary)]">
                  {f.away}
                </dt>
                <dd className="font-mono text-[26px] tabular-nums text-[var(--text-primary)]">
                  {f.xg_away.toFixed(2)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
              Expected goals for this fixture — the rate the goal model runs at, not a
              prediction of the final score.
            </p>
          </section>

          {f.scorelines?.length ? (
            <section
              className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
              aria-labelledby="scorelines-heading"
            >
              <h2
                id="scorelines-heading"
                className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
              >
                Likeliest scorelines
              </h2>
              <ul className="mt-3.5 space-y-2">
                {f.scorelines.map((s) => (
                  <li
                    key={s.score}
                    className="grid grid-cols-[3.5rem_1fr_3.5rem] items-center gap-x-3"
                  >
                    <span className="font-mono text-[14px] tabular-nums text-[var(--text-primary)]">
                      {s.score}
                    </span>
                    <span
                      aria-hidden
                      className="h-[4px] w-full overflow-hidden rounded-full bg-[var(--border-color)]"
                    >
                      <span
                        className="block h-full rounded-full bg-[var(--accent-primary)]"
                        style={{
                          width: `${Math.max(2, (s.p / (f.scorelines[0]?.p || 1)) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="text-right font-mono text-[13px] tabular-nums text-[var(--text-secondary)]">
                      {(s.p * 100).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                Even the likeliest scoreline in football is usually under 13%. These come
                from the same goal model as the outcome probabilities above — its goal
                rates are solved so the two agree exactly rather than being computed
                separately and hoping.
              </p>
            </section>
          ) : null}

          {f.elo_home != null && f.elo_away != null ? (
            <section
              className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
              aria-labelledby="strength-heading"
            >
              <h2
                id="strength-heading"
                className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
              >
                Team strength
              </h2>
              <dl className="mt-3.5 grid grid-cols-2 gap-4">
                <div>
                  <dt className="truncate text-[12px] text-[var(--text-tertiary)]">
                    {f.home}
                  </dt>
                  <dd className="font-mono text-[20px] tabular-nums text-[var(--text-secondary)]">
                    {Math.round(f.elo_home)}
                  </dd>
                </div>
                <div>
                  <dt className="truncate text-[12px] text-[var(--text-tertiary)]">
                    {f.away}
                  </dt>
                  <dd className="font-mono text-[20px] tabular-nums text-[var(--text-secondary)]">
                    {Math.round(f.elo_away)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                Elo ratings, driven purely by results. 1500 is the starting point for a
                club with no history; the gap between two ratings is what most of the
                forecast above is built from.
              </p>
            </section>
          ) : null}

          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            {data?.method?.model_version ? (
              <>
                Model{' '}
                <code className="text-[var(--text-secondary)]">
                  {data.method.model_version}
                </code>
                .{' '}
              </>
            ) : null}
            This forecast was recorded before kickoff and kept, so it can be scored
            against the result later.{' '}
            <Link
              href="/evaluation"
              className="text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
            >
              How accurate has it been?
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
