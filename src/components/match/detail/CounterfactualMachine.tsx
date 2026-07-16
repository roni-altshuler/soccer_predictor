'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { motion, useReducedMotion } from 'framer-motion'

import { SectionHeader } from '@/components/primitives'
import { cn } from '@/lib/utils'

import {
  FORK_MINUTE_MAX,
  FORK_MINUTE_MIN,
  buildForkTimeline,
  clampForkMinute,
  effectiveRemovals,
  forkStateLine,
  hasHappenedBy,
  stateAtMinute,
  statesEqual,
  type ForkEvent,
  type ForkState,
} from './counterfactual'
import { KICKOFF_STATE, fetchForkDistribution, type ForkDistribution } from './engineClient'
import { buildMomentumRiver, type MomentumRiverData } from './momentum'
import { buildMatchStory } from './story'
import type { MatchDetails } from './types'

/**
 * CounterfactualMachine — fork a real, finished match (docs/VISION_2030.md).
 *
 * Three parts: fork controls (a scrubber over the real timeline, event chips
 * that can be toggled out of history, one hypothetical goal per side), the
 * verdict panel (what actually happened vs the modeled continuation, with
 * deltas against the unforked baseline at the same minute), and the braid —
 * the real win-probability path splitting at the fork into a ghost fan whose
 * widths at full time ARE the kernel's win/draw/loss probabilities. The fan
 * is deliberately a wedge from one point: the kernel returns ONE distribution
 * at the fork, not a minute-by-minute path, and inventing a wiggly ghost line
 * would be a fabrication.
 *
 * Honest empty behaviour, in order:
 * - the timeline gates exactly like story.ts/momentum.ts (events must
 *   reproduce the final score) — otherwise this renders NOTHING;
 * - {@link useForkAvailability} probes the kernel at kickoff state; the page
 *   hides the tab entirely until it answers `available: true`;
 * - a fork the kernel declines (or a network failure) renders nothing for
 *   that fork — no skeleton, no fabricated numbers.
 */

const HOME_COLOR = 'var(--team-tint-home, var(--accent-primary))'
const AWAY_COLOR = 'var(--team-tint-away, var(--accent-loss))'
const DRAW_COLOR = 'var(--accent-warn)'

/** Debounce between a control change and the kernel round-trip. */
const DEFAULT_DEBOUNCE_MS = 350

/**
 * Kickoff-state availability probe. `null` while unknown (or when matchId is
 * null), then a definitive boolean. The match page uses this to decide
 * whether the "What if" tab exists at all — `available: false` at kickoff
 * means the whole feature renders nothing.
 */
export function useForkAvailability(matchId: string | null): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    if (!matchId) {
      setAvailable(null)
      return
    }
    let cancelled = false
    setAvailable(null)
    fetchForkDistribution(matchId, KICKOFF_STATE)
      .then((distribution) => {
        if (!cancelled) setAvailable(distribution !== null)
      })
      .catch(() => {
        if (!cancelled) setAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [matchId])

  return available
}

function pct(p: number): number {
  return Math.round(p * 100)
}

function minuteLabel(minute: number, addedTime?: number): string {
  return `${minute}${addedTime ? `+${addedTime}` : ''}'`
}

/** Position of a minute along the scrubber track, as a CSS percentage. */
function trackPct(minute: number): number {
  const m = Math.max(FORK_MINUTE_MIN, Math.min(FORK_MINUTE_MAX, minute))
  return ((m - FORK_MINUTE_MIN) / (FORK_MINUTE_MAX - FORK_MINUTE_MIN)) * 100
}

/** Chip glyph — same grammar as the river's markers (no emoji, tokens only). */
function EventGlyph({ event }: { event: ForkEvent }) {
  const tint = event.team === 'home' ? HOME_COLOR : AWAY_COLOR
  if (event.type === 'red_card') {
    return (
      <span
        className="h-[10px] w-[7px] shrink-0 rounded-[2px] bg-[var(--accent-loss)]"
        aria-hidden
      />
    )
  }
  if (event.type === 'own_goal') {
    return (
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-transparent"
        style={{ borderColor: tint }}
        aria-hidden
      />
    )
  }
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tint }} aria-hidden />
}

// ---------------------------------------------------------------------------
// The braid — real path up to the fork, ghost fan after it
// ---------------------------------------------------------------------------

const BRAID_W = 720
const BRAID_H = 184
const BRAID_PAD_L = 10
const BRAID_PAD_R = 56
const BRAID_TOP = 16
const BRAID_BOTTOM = 150
const BRAID_AXIS_Y = 172

function BraidSvg({
  river,
  forkMinute,
  fork,
  homeName,
  awayName,
  reducedMotion,
}: {
  river: MomentumRiverData
  forkMinute: number
  fork: ForkDistribution
  homeName: string
  awayName: string
  reducedMotion: boolean
}) {
  const xOf = (m: number) => BRAID_PAD_L + (m / river.domainMax) * (BRAID_W - BRAID_PAD_L - BRAID_PAD_R)
  const yOf = (p: number) => BRAID_BOTTOM - p * (BRAID_BOTTOM - BRAID_TOP)

  // Real home-win path (empirical steps), split at the fork minute. The
  // segments are chart-minute spans covering [0, domainMax], so the fork
  // (≤ 90) always lands inside one of them.
  const prePts: string[] = []
  const postPts: string[] = []
  let anchorSeg = river.segments[river.segments.length - 1]
  for (const s of river.segments) {
    const y = yOf(s.pHome)
    if (s.x1 <= forkMinute) {
      prePts.push(`${xOf(s.x0)},${y}`, `${xOf(s.x1)},${y}`)
    } else if (s.x0 >= forkMinute) {
      postPts.push(`${xOf(s.x0)},${y}`, `${xOf(s.x1)},${y}`)
    } else {
      prePts.push(`${xOf(s.x0)},${y}`, `${xOf(forkMinute)},${y}`)
      postPts.push(`${xOf(forkMinute)},${y}`, `${xOf(s.x1)},${y}`)
    }
    if (s.x0 <= forkMinute && forkMinute < s.x1) anchorSeg = s
  }
  const forkX = xOf(Math.min(forkMinute, river.domainMax))
  const anchorY = yOf(anchorSeg.pHome)
  const xEnd = xOf(river.domainMax)

  // The ghost fan: ONE distribution at the fork, rendered as three wedges
  // from the anchor to full-time endpoints whose heights are the kernel's
  // probabilities (defensively renormalised). Bottom-up: away, draw, home.
  const total = fork.pHome + fork.pDraw + fork.pAway
  const [pH, pD, pA] = total > 0 ? [fork.pHome / total, fork.pDraw / total, fork.pAway / total] : [1 / 3, 1 / 3, 1 / 3]
  const cutLow = yOf(pA)
  const cutHigh = yOf(pA + pD)
  const fan = [
    { key: 'away', color: AWAY_COLOR, yTop: cutLow, yBottom: yOf(0), p: pA },
    { key: 'draw', color: DRAW_COLOR, yTop: cutHigh, yBottom: cutLow, p: pD },
    { key: 'home', color: HOME_COLOR, yTop: yOf(1), yBottom: cutHigh, p: pH },
  ]

  const axisTicks = [0, 15, 30, 45, 60, 75, 90]
  const forkLabelFlip = forkX > (BRAID_W - BRAID_PAD_R) * 0.72

  const legend = [
    { label: `${homeName} win`, color: HOME_COLOR },
    { label: 'Draw', color: DRAW_COLOR },
    { label: `${awayName} win`, color: AWAY_COLOR },
  ]

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {legend.map((item) => (
          <span key={item.label} className="inline-flex min-w-0 items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden />
            <span className="truncate font-medium text-[var(--text-secondary)]">{item.label}</span>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <svg
            viewBox={`0 0 ${BRAID_W} ${BRAID_H}`}
            className="block w-full"
            role="img"
            aria-label={`${homeName}'s real win-probability path up to minute ${forkMinute}, then the modeled continuation fanning out to full time: ${homeName} win ${pct(pH)}%, draw ${pct(pD)}%, ${awayName} win ${pct(pA)}%`}
          >
            {/* HT / 90' hairlines. */}
            {[45, 90].map((m) => (
              <line
                key={m}
                x1={xOf(m)}
                y1={BRAID_TOP}
                x2={xOf(m)}
                y2={BRAID_BOTTOM}
                stroke="var(--border-color)"
                strokeWidth={1}
                strokeDasharray="3,3"
              />
            ))}

            {/* Real path after the fork — faded: it still happened. */}
            {postPts.length > 0 && (
              <path
                d={`M ${postPts.join(' L ')}`}
                fill="none"
                stroke={HOME_COLOR}
                strokeWidth={1.75}
                strokeOpacity={0.25}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {/* Ghost fan — one distribution, wedges to full-time endpoints. */}
            <motion.g
              key={`${forkMinute}-${pH.toFixed(4)}-${pD.toFixed(4)}`}
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {fan.map((w) => (
                <path
                  key={w.key}
                  d={`M ${forkX},${anchorY} L ${xEnd},${w.yTop} L ${xEnd},${w.yBottom} Z`}
                  fill={w.color}
                  fillOpacity={w.key === 'draw' ? 0.14 : 0.2}
                />
              ))}
              {[cutLow, cutHigh].map((y, i) => (
                <line
                  key={i}
                  x1={forkX}
                  y1={anchorY}
                  x2={xEnd}
                  y2={y}
                  stroke="var(--text-tertiary)"
                  strokeWidth={0.75}
                  strokeDasharray="2,3"
                  strokeOpacity={0.6}
                />
              ))}
              {fan.map((w) => {
                const h = w.yBottom - w.yTop
                if (h < 13) return null
                return (
                  <text
                    key={`label-${w.key}`}
                    x={xEnd + 5}
                    y={(w.yTop + w.yBottom) / 2 + 3}
                    fontSize={9.5}
                    fontWeight={600}
                    fill={w.color}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {pct(w.p)}%
                  </text>
                )
              })}
            </motion.g>

            {/* Real path up to the fork — solid. */}
            {prePts.length > 0 && (
              <path
                d={`M ${prePts.join(' L ')}`}
                fill="none"
                stroke={HOME_COLOR}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {/* The fork itself. */}
            <line
              x1={forkX}
              y1={BRAID_TOP}
              x2={forkX}
              y2={BRAID_BOTTOM}
              stroke="var(--accent-primary)"
              strokeWidth={1}
              strokeOpacity={0.65}
            />
            <circle cx={forkX} cy={anchorY} r={3.2} fill="var(--accent-primary)" />
            <text
              x={forkLabelFlip ? forkX - 6 : forkX + 6}
              y={BRAID_TOP + 10}
              textAnchor={forkLabelFlip ? 'end' : 'start'}
              fontSize={7.5}
              fontWeight={600}
              letterSpacing={1}
              fill="var(--accent-primary)"
              stroke="var(--card-bg)"
              strokeWidth={3}
              style={{ paintOrder: 'stroke', fontVariantNumeric: 'tabular-nums' }}
            >
              FORK {forkMinute}&apos;
            </text>

            {/* Axis. */}
            {axisTicks.map((m) => (
              <text
                key={m}
                x={xOf(m)}
                y={BRAID_AXIS_Y}
                textAnchor={m === 0 ? 'start' : 'middle'}
                fontSize={9.5}
                fill="var(--text-tertiary)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {m === 45 ? 'HT' : m === 90 ? '90+' : `${m}'`}
              </text>
            ))}
          </svg>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Solid line — how often teams in {homeName}&apos;s position went on to win, up to the fork.
        The fan — the modeled continuation, spread to full time: its widths are the win, draw and
        loss chances at the fork, not a minute-by-minute path.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

export function CounterfactualMachine({
  match,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: {
  match: MatchDetails
  /** Test hook — collapse the control→kernel debounce. */
  debounceMs?: number
}) {
  const reducedMotion = useReducedMotion()

  const timeline = useMemo(() => buildForkTimeline(match), [match])
  const matchId = match.id

  const [forkMinute, setForkMinute] = useState(FORK_MINUTE_MIN)
  const [removed, setRemoved] = useState<ReadonlySet<number>>(() => new Set())
  const [addedGoal, setAddedGoal] = useState<'home' | 'away' | null>(null)
  // One kernel round-trip, stored atomically: the state that was asked about,
  // its continuation, the unforked baseline at the same minute, and whether
  // the pair differed. The verdict/braid render ONLY from this — never from a
  // half-updated mix of new controls and stale distributions.
  const [result, setResult] = useState<{
    state: ForkState
    fork: ForkDistribution | null
    baseline: ForkDistribution | null
    modified: boolean
  } | null>(null)
  const [pending, setPending] = useState(true)
  const [river, setRiver] = useState<MomentumRiverData | null>(null)

  const seqRef = useRef(0)
  /** Once the user touches a control, the story's turning point stops steering the default. */
  const userTouchedRef = useRef(false)

  // Default fork point: the story's turning point when it exposes one
  // (same receipts as the story tab), else kickoff.
  useEffect(() => {
    if (!timeline) return
    let cancelled = false
    buildMatchStory(match)
      .then((story) => {
        if (cancelled || userTouchedRef.current || !story.turningPoint) return
        const beat = story.acts[story.turningPoint.actIndex]?.beats[story.turningPoint.beatIndex]
        if (beat) setForkMinute(clampForkMinute(beat.minute))
      })
      .catch(() => {
        /* no turning point — kickoff default stands */
      })
    return () => {
      cancelled = true
    }
  }, [match, timeline])

  // The braid's real path — the same empirical river the story section shows.
  useEffect(() => {
    if (!timeline) return
    let cancelled = false
    buildMomentumRiver(match)
      .then((built) => {
        if (!cancelled) setRiver(built)
      })
      .catch(() => {
        /* no river → no braid; the verdict panel still works */
      })
    return () => {
      cancelled = true
    }
  }, [match, timeline])

  // Fork state math — pure, memoised; removals of future events are inert.
  const effRemoved = useMemo(
    () => (timeline ? effectiveRemovals(timeline, forkMinute, removed) : new Set<number>()),
    [timeline, forkMinute, removed]
  )
  const forkState = useMemo(
    () => (timeline ? stateAtMinute(timeline, forkMinute, effRemoved, addedGoal) : null),
    [timeline, forkMinute, effRemoved, addedGoal]
  )
  const baselineState = useMemo(
    () => (timeline ? stateAtMinute(timeline, forkMinute) : null),
    [timeline, forkMinute]
  )

  // Debounced kernel round-trip: the fork AND the unforked baseline at the
  // same minute (apples-to-apples deltas). Identical states share one call.
  useEffect(() => {
    if (!forkState || !baselineState) return
    const seq = ++seqRef.current
    setPending(true)
    const timer = setTimeout(() => {
      const forkPromise = fetchForkDistribution(matchId, forkState)
      const basePromise = statesEqual(forkState, baselineState)
        ? forkPromise
        : fetchForkDistribution(matchId, baselineState)
      void Promise.all([forkPromise, basePromise]).then(([forkDist, baseDist]) => {
        if (seqRef.current !== seq) return
        setResult({
          state: forkState,
          fork: forkDist,
          baseline: baseDist,
          modified: !statesEqual(forkState, baselineState),
        })
        setPending(false)
      })
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [matchId, forkState, baselineState, debounceMs])

  if (!timeline || !forkState) return null

  const finalScore = timeline[timeline.length - 1].scoreAfter
  const homeName = match.home_team
  const awayName = match.away_team

  const toggleRemoved = (id: number) => {
    userTouchedRef.current = true
    setRemoved((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAddedGoal = (side: 'home' | 'away') => {
    userTouchedRef.current = true
    setAddedGoal((current) => (current === side ? null : side))
  }

  return (
    <section
      aria-label="What if?"
      className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
    >
      <div className="border-b border-[var(--border-color)] px-4 py-3">
        <SectionHeader
          title="What if?"
          description="Fork the match at any moment — a model built on two decades of matches plays out the rest."
        />
      </div>

      <div className="space-y-5 px-4 py-4">
        {/* ------------------------------------------------ fork controls */}
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold text-[var(--text-secondary)]">Fork point</p>
            <p className="font-numeric text-base font-bold tabular-nums text-[var(--text-primary)]">
              {forkMinute}&apos;
            </p>
          </div>

          {/* Timeline spine — the real events along the clock; the green
              cursor is the fork. Decorative twin of the scrubber below. */}
          <div className="relative mt-1 h-9" aria-hidden>
            <div className="absolute inset-x-0 top-1/2 border-t border-[var(--border-color)]" />
            <div
              className="absolute top-1/2 h-2.5 -translate-y-1/2 border-l border-[var(--border-color)]"
              style={{ left: `${trackPct(45)}%` }}
            />
            {timeline.map((e) => {
              const happened = hasHappenedBy(e, forkMinute)
              const tint = e.team === 'home' ? HOME_COLOR : AWAY_COLOR
              return (
                <span
                  key={e.id}
                  className={cn(
                    'absolute -translate-x-1/2 transition-opacity',
                    e.team === 'home' ? 'top-0.5' : 'bottom-0.5',
                    happened ? 'opacity-100' : 'opacity-30'
                  )}
                  style={{ left: `${trackPct(e.minute)}%` }}
                >
                  {e.type === 'red_card' ? (
                    <span className="block h-[9px] w-[6px] rounded-[1.5px] bg-[var(--accent-loss)]" />
                  ) : (
                    <span className="block h-2 w-2 rounded-full" style={{ background: tint }} />
                  )}
                </span>
              )
            })}
            <div
              className="absolute bottom-0 top-0 w-[2px] -translate-x-1/2 rounded-full bg-[var(--accent-primary)]"
              style={{ left: `${trackPct(forkMinute)}%` }}
            />
          </div>

          <input
            type="range"
            min={FORK_MINUTE_MIN}
            max={FORK_MINUTE_MAX}
            step={1}
            value={forkMinute}
            onChange={(event) => {
              userTouchedRef.current = true
              setForkMinute(clampForkMinute(Number(event.target.value)))
            }}
            aria-label="Fork minute"
            aria-valuetext={`Minute ${forkMinute}`}
            className="h-11 w-full cursor-pointer"
            style={{ accentColor: 'var(--accent-primary)' }}
          />
          <div className="flex justify-between text-[10px] tabular-nums text-[var(--text-tertiary)]">
            <span>1&apos;</span>
            <span>HT</span>
            <span>90&apos;</span>
          </div>
        </div>

        {/* Event chips — toggle real history off. Future events can't be
            removed: they haven't happened yet in the forked universe. */}
        <div>
          <p className="mb-1.5 text-[11px] text-[var(--text-tertiary)]">
            Toggle a real event off to erase it from the fork.
          </p>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Real events — toggle off to remove from the fork"
          >
            {timeline.map((e) => {
              const happened = hasHappenedBy(e, forkMinute)
              const isRemoved = effRemoved.has(e.id)
              const label = minuteLabel(e.minute, e.addedTime)
              const suffix = e.type === 'own_goal' ? ' (og)' : e.type === 'penalty_goal' ? ' (pen)' : ''
              const noun = e.type === 'red_card' ? 'red card' : 'goal'
              return (
                <button
                  key={e.id}
                  type="button"
                  disabled={!happened}
                  aria-pressed={isRemoved}
                  onClick={() => toggleRemoved(e.id)}
                  title={happened ? undefined : 'Happens after the fork'}
                  aria-label={
                    happened
                      ? `${isRemoved ? 'Restore' : 'Remove'} the ${label} ${noun} by ${e.player}`
                      : `${label} ${noun} by ${e.player} — happens after the fork`
                  }
                  className={cn(
                    'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                    isRemoved
                      ? 'border-dashed border-[var(--border-color)] text-[var(--text-tertiary)] line-through'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--card-hover)]',
                    !happened && 'cursor-not-allowed opacity-40'
                  )}
                >
                  <EventGlyph event={e} />
                  <span className="font-numeric font-semibold tabular-nums">{label}</span>
                  <span className="max-w-[130px] truncate">
                    {e.player}
                    {suffix}
                  </span>
                </button>
              )
            })}
          </div>

          {/* One hypothetical goal — state math only, never a named scorer. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-[var(--text-tertiary)]">
              Add a goal at {forkMinute}&apos;:
            </span>
            {(['home', 'away'] as const).map((side) => {
              const active = addedGoal === side
              const tint = side === 'home' ? HOME_COLOR : AWAY_COLOR
              return (
                <button
                  key={side}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleAddedGoal(side)}
                  aria-label={`${active ? 'Remove the' : 'Add a'} hypothetical ${
                    side === 'home' ? homeName : awayName
                  } goal at minute ${forkMinute}`}
                  className={cn(
                    'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-dashed px-3 text-xs font-semibold transition-colors',
                    active
                      ? 'border-transparent bg-[var(--muted-bg)] text-[var(--text-primary)]'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--card-hover)]'
                  )}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tint }} aria-hidden />
                  <span className="max-w-[130px] truncate">
                    +1 {side === 'home' ? homeName : awayName}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ------------------------------------------------ verdict panel */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border-color)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              What happened
            </p>
            <p className="mt-1.5 font-numeric text-3xl font-extrabold leading-none tabular-nums text-[var(--text-primary)]">
              {finalScore.home}–{finalScore.away}
            </p>
            <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">Full time — the real result.</p>
          </div>

          {result?.fork && (
            <div
              aria-busy={pending}
              className={cn(
                'rounded-xl border border-[var(--border-color)] p-3 transition-opacity',
                pending && 'opacity-60'
              )}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                Forked at {result.state.minute}&apos; — modeled continuation
              </p>
              <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                From{' '}
                <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                  {forkStateLine(result.state, homeName, awayName)}
                </span>
              </p>

              <div
                className="mt-2 flex h-2 w-full overflow-hidden rounded-full"
                role="img"
                aria-label={`Modeled outcome: ${homeName} win ${pct(result.fork.pHome)}%, draw ${pct(result.fork.pDraw)}%, ${awayName} win ${pct(result.fork.pAway)}%`}
              >
                {[
                  { key: 'home', value: result.fork.pHome, color: HOME_COLOR },
                  { key: 'draw', value: result.fork.pDraw, color: DRAW_COLOR },
                  { key: 'away', value: result.fork.pAway, color: AWAY_COLOR },
                ].map((seg) => (
                  <span
                    key={seg.key}
                    className="h-full"
                    style={{ width: `${seg.value * 100}%`, minWidth: '2%', backgroundColor: seg.color }}
                  />
                ))}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold tabular-nums">
                <span className="max-w-[10rem] truncate" style={{ color: HOME_COLOR }}>
                  {homeName} {pct(result.fork.pHome)}%
                </span>
                <span className="text-[var(--text-tertiary)]">·</span>
                <span style={{ color: DRAW_COLOR }}>Draw {pct(result.fork.pDraw)}%</span>
                <span className="text-[var(--text-tertiary)]">·</span>
                <span className="max-w-[10rem] truncate" style={{ color: AWAY_COLOR }}>
                  {awayName} {pct(result.fork.pAway)}%
                </span>
              </div>

              <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                Projected final score:{' '}
                <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                  {result.fork.expHomeGoals.toFixed(1)}–{result.fork.expAwayGoals.toFixed(1)}
                </span>
              </p>

              {result.fork.topScorelines.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    Most likely final scores
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {result.fork.topScorelines.slice(0, 3).map((s) => (
                      <span
                        key={`${s.home}-${s.away}`}
                        className="rounded-lg bg-[var(--muted-bg)] px-2 py-1 text-[11px] tabular-nums"
                      >
                        <span className="font-semibold text-[var(--text-primary)]">
                          {s.home}-{s.away}
                        </span>{' '}
                        <span className="text-[var(--text-tertiary)]">{pct(s.p)}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {result.modified && result.baseline && (
                <div className="mt-2.5 border-t border-[var(--border-color)] pt-2">
                  <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    This fork moves{' '}
                    <span className="font-medium text-[var(--text-primary)]">{homeName}</span>
                    &apos;s win chance from{' '}
                    <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                      {pct(result.baseline.pHome)}%
                    </span>
                    {' → '}
                    <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                      {pct(result.fork.pHome)}%
                    </span>
                    .
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-[var(--text-tertiary)]">
                    Draw {pct(result.baseline.pDraw)}% → {pct(result.fork.pDraw)}% · {awayName}{' '}
                    {pct(result.baseline.pAway)}% → {pct(result.fork.pAway)}%
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------ the braid */}
        {river && result?.fork && (
          <BraidSvg
            river={river}
            forkMinute={result.state.minute}
            fork={result.fork}
            homeName={homeName}
            awayName={awayName}
            reducedMotion={reducedMotion ?? false}
          />
        )}
      </div>

      <div className="border-t border-[var(--border-color)] px-4 py-2.5">
        <p className="text-[11px] text-[var(--text-tertiary)]">
          Hypothetical — the real result stands.
        </p>
      </div>
    </section>
  )
}
