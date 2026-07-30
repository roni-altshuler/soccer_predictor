'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'

import { KICKOFF_STATE, type ForkDistribution } from '@/components/match/detail/engineClient'
import { LiveBadge, ProbBar } from '@/components/primitives'
import { EASE_OUT } from '@/lib/motion'
import { getLeagueAccent } from '@/lib/leagueAccents'

import { buildLiveReads, type ReadTone } from './reads'
import { useBaseRate, useEngineDistribution } from './useEngineDistribution'
import { coerceMinute, committedProbs, toLiveEngineState, type LiveMatch, type OutcomeProbs } from './types'

const OUTCOMES = [
  { key: 'home' as const, color: 'var(--accent-primary)' },
  { key: 'draw' as const, color: 'var(--accent-warn)' },
  { key: 'away' as const, color: 'var(--accent-loss)' },
]

const TONE_COLOR: Record<ReadTone, string> = {
  edge: 'var(--accent-primary)',
  risk: 'var(--accent-loss)',
  watch: 'var(--accent-ai)',
  note: 'var(--text-tertiary)',
}

function distToProbs(d: ForkDistribution): OutcomeProbs {
  const total = d.pHome + d.pDraw + d.pAway
  if (!(total > 0)) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 }
  return { home: d.pHome / total, draw: d.pDraw / total, away: d.pAway / total }
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

function kickoffLabel(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function countdown(iso: string, now: number): string | null {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const ms = t - now
  if (ms <= 0) return null
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`
}

/** A small crest with a graceful fallback when the URL is missing/broken. */
function Crest({ url, name }: { url?: string | null; name: string }) {
  if (!url) {
    return (
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] text-lg font-black text-[var(--text-tertiary)]"
        aria-hidden
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" width={56} height={56} className="h-14 w-14 shrink-0 object-contain" />
  )
}

/**
 * The Live Intelligence spotlight — one match, read in full by the roll-forward
 * kernel. Team-tinted broadcast header, engine win-probability with live-animated
 * bars and the pre-match→now shift, the exact-count historical base rate, the
 * likeliest finish, and 2–4 honest reads. Every number is real or absent: when
 * the kernel can't cover the fixture it falls back to the committed pre-match
 * model, and when neither exists it shows the fixture with an honest note.
 */
export function FeaturedMatch({ match, isLive }: { match: LiveMatch; isLive: boolean }) {
  const reduced = useReducedMotion()
  const league = getLeagueAccent(match.leagueId || match.league)
  const competition = match.leagueId || match.league
  const homeTeam = match.home_team
  const awayTeam = match.away_team

  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    if (isLive) return
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [isLive])

  const liveState = useMemo(() => (isLive ? toLiveEngineState(match) : KICKOFF_STATE), [isLive, match])

  const nowEngine = useEngineDistribution({ competition, homeTeam, awayTeam, state: liveState })
  const baselineEngine = useEngineDistribution({
    competition,
    homeTeam,
    awayTeam,
    state: isLive ? KICKOFF_STATE : null,
    enabled: isLive,
  })

  const engineProbs = nowEngine.distribution ? distToProbs(nowEngine.distribution) : null
  const committed = committedProbs(match)
  const current: OutcomeProbs | null = engineProbs ?? committed
  const source: 'engine' | 'model' | null = engineProbs ? 'engine' : committed ? 'model' : null
  const baseline = isLive && baselineEngine.distribution ? distToProbs(baselineEngine.distribution) : null

  const gender = nowEngine.gender ?? baselineEngine.gender
  const minute = coerceMinute(match.minute)
  const diff =
    typeof match.home_score === 'number' && typeof match.away_score === 'number'
      ? match.home_score - match.away_score
      : null
  const baseRate = useBaseRate({ gender, diff, minute, enabled: isLive })

  const reads = current
    ? buildLiveReads({
        homeTeam,
        awayTeam,
        current,
        baseline,
        baseRate,
        distribution: nowEngine.distribution,
        isLive,
        homeGoals: match.home_score ?? 0,
        awayGoals: match.away_score ?? 0,
        minute,
      })
    : []

  const labels: Record<'home' | 'draw' | 'away', string> = {
    home: homeTeam,
    draw: 'Draw',
    away: awayTeam,
  }
  const kickIn = countdown(match.time, now)
  const topScorelines = (nowEngine.distribution?.topScorelines ?? []).slice(0, 3)

  return (
    <div className="live-featured live-aura cine-card is-ai relative overflow-hidden rounded-[20px]">
      {/* Broadcast header — tinted to the competition brand. */}
      <div
        className="relative px-5 py-5 sm:px-7"
        style={{
          background: `linear-gradient(135deg, ${league.accentBg}, transparent 60%), var(--card-bg)`,
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="fm-chip" style={{ borderColor: 'var(--border-color)' }}>
            {league.flag} {league.shortName}
          </span>
          {isLive ? (
            <LiveBadge minute={typeof match.minute === 'number' ? `${match.minute}'` : match.minute ?? "Live"} />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              {kickoffLabel(match.time)}
              {kickIn ? <span className="text-[var(--accent-ai)]">· {kickIn}</span> : null}
            </span>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-2 text-center">
            <Crest url={match.home_crest_url} name={homeTeam} />
            <span className="line-clamp-2 text-sm font-bold text-[var(--text-primary)]">{homeTeam}</span>
          </div>

          <div className="flex flex-col items-center px-2">
            {isLive ? (
              <div className="flex items-center gap-2 text-4xl font-black tabular-nums text-[var(--text-primary)] sm:text-5xl">
                <span>{match.home_score ?? 0}</span>
                <span className="text-[var(--text-tertiary)]">–</span>
                <span>{match.away_score ?? 0}</span>
              </div>
            ) : (
              <span className="text-2xl font-black uppercase tracking-widest text-[var(--text-tertiary)]">vs</span>
            )}
          </div>

          <div className="flex flex-col items-center gap-2 text-center">
            <Crest url={match.away_crest_url} name={awayTeam} />
            <span className="line-clamp-2 text-sm font-bold text-[var(--text-primary)]">{awayTeam}</span>
          </div>
        </div>
      </div>

      {/* Intelligence body. */}
      <div className="space-y-5 p-5 sm:p-7">
        {source && current ? (
          <>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent-ai)]">
                  {isLive ? 'Live win probability' : 'Model win probability'}
                </p>
                <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  {source === 'engine'
                    ? isLive
                      ? 'Recomputed each play'
                      : 'Pre-match read'
                    : 'Pre-match model'}
                </p>
              </div>

              <ProbBar home={current.home} draw={current.draw} away={current.away} size="md" />

              <div className="mt-4 grid grid-cols-3 gap-2.5 sm:gap-3">
                {OUTCOMES.map((o) => {
                  const value = current[o.key]
                  const isLeader = value === Math.max(current.home, current.draw, current.away)
                  const delta = baseline ? Math.round((value - baseline[o.key]) * 100) : null
                  return (
                    <div
                      key={o.key}
                      className="rounded-xl border p-3 text-center transition-colors"
                      style={{
                        borderColor: isLeader
                          ? `color-mix(in srgb, ${o.color} 55%, var(--border-color))`
                          : 'var(--border-color)',
                        background: isLeader
                          ? `color-mix(in srgb, ${o.color} 10%, var(--card-bg))`
                          : 'var(--muted-bg)',
                      }}
                    >
                      <p className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                        {labels[o.key]}
                      </p>
                      <p
                        className="mt-1 text-2xl font-black tabular-nums sm:text-3xl"
                        style={{ color: o.color }}
                      >
                        {pct(value)}
                      </p>
                      {delta != null && delta !== 0 ? (
                        <p
                          className="text-[10px] font-bold tabular-nums"
                          style={{
                            color: delta > 0 ? 'var(--accent-primary)' : 'var(--accent-loss)',
                          }}
                        >
                          {delta > 0 ? `▲ +${delta}` : `▼ ${delta}`} pts
                        </p>
                      ) : (
                        <p className="text-[10px] text-[var(--text-tertiary)]">&nbsp;</p>
                      )}
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--background-secondary)]">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: o.color }}
                          initial={false}
                          animate={{ width: `${Math.max(2, Math.round(value * 100))}%` }}
                          transition={reduced ? { duration: 0 } : { duration: 0.8, ease: EASE_OUT }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Pre-match → now trajectory. */}
            {baseline && (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  <span>Pre-match</span>
                  <span>Now</span>
                </div>
                <svg
                  viewBox="0 0 100 100"
                  className="h-24 w-full overflow-visible text-[var(--text-tertiary)]"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Win-probability shift from the pre-match estimate to now"
                >
                  {[25, 50, 75].map((line) => (
                    <line
                      key={line}
                      x1="0"
                      x2="100"
                      y1={line}
                      y2={line}
                      stroke="currentColor"
                      strokeOpacity="0.14"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {OUTCOMES.map((o) => {
                    const toY = (val: number) => Math.min(94, Math.max(6, 96 - val * 90))
                    return (
                      <path
                        key={o.key}
                        d={`M 3 ${toY(baseline[o.key]).toFixed(1)} L 97 ${toY(current[o.key]).toFixed(1)}`}
                        fill="none"
                        stroke={o.color}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    )
                  })}
                </svg>
              </div>
            )}

            {/* Exact-count historical base rate. */}
            {baseRate && (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  Historical base rate
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {OUTCOMES.map((o) => (
                    <div key={o.key} className="text-center">
                      <p className="text-sm font-bold tabular-nums text-[var(--text-primary)]">
                        {pct(
                          o.key === 'home'
                            ? baseRate.probabilities.home_win
                            : o.key === 'draw'
                              ? baseRate.probabilities.draw
                              : baseRate.probabilities.away_win
                        )}
                      </p>
                      <p className="truncate text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                        {labels[o.key]}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed tabular-nums text-[var(--text-tertiary)]">
                  From {baseRate.sample.toLocaleString()} similar matches at this scoreline and minute.
                </p>
              </div>
            )}

            {/* Likeliest finishes. */}
            {topScorelines.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  {isLive ? 'Likeliest finish' : 'Likeliest scoreline'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {topScorelines.map((s) => (
                    <span
                      key={`${s.home}-${s.away}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-2.5 py-1 text-xs font-bold tabular-nums text-[var(--text-primary)]"
                    >
                      {s.home}–{s.away}
                      <span className="text-[var(--text-tertiary)]">{pct(s.p)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Honest reads. */}
            {reads.length > 0 && (
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent-ai)]">
                  What the model sees
                </p>
                <ul className="space-y-1.5">
                  {reads.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: TONE_COLOR[r.tone] }}
                        aria-hidden
                      />
                      <span>{r.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              A calibrated live read isn&apos;t available for this competition yet. The model serves
              in-match win probability for the leagues it covers — this fixture is shown for the score
              and clock only.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-color)] pt-4">
          <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            {isLive
              ? 'A transparent in-match estimate from score and clock — not a betting guarantee.'
              : 'A pre-match estimate from team strength — not a betting guarantee.'}
          </p>
          <Link
            href={`/matches/${match.id}`}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[var(--accent-ai)] hover:underline"
          >
            Full match
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  )
}
