'use client'

import { useEffect, useId, useState } from 'react'

import { motion, useReducedMotion } from 'framer-motion'

import { SectionHeader } from '@/components/primitives'

import { buildMomentumRiver, type MomentumRiverData, type RiverMarker } from './momentum'
import type { MatchDetails } from './types'

/**
 * MomentumRiver — the headline visual of the story section: stacked empirical
 * win/draw/loss bands across the match timeline, built by `momentum.ts` from
 * the same exact-count artifact as `story.ts`.
 *
 * The bands are honest steps: they move only at goals and 5-minute bucket
 * boundaries, exactly where the underlying counts change. The only rendering
 * polish is rounded stroke joins on the band edges — no interpolation, no
 * faked continuous evolution between events.
 *
 * Stacking: the home band is anchored to the BOTTOM edge and the away band to
 * the TOP, with the draw band floating between them. Each side's chance reads
 * as water rising from its own shore, dominance reads as flooding toward the
 * middle, and the draw band is visibly squeezed out as the match resolves —
 * both team bands stay directly comparable because each grows from a fixed
 * edge.
 *
 * Honest empty behaviour: when `buildMomentumRiver` returns null (events do
 * not reconcile, any band span thinner than the n-gate, missing artifact)
 * this renders NOTHING — no skeleton, no placeholder.
 */

const HOME_COLOR = 'var(--team-tint-home, var(--accent-primary))'
const AWAY_COLOR = 'var(--team-tint-away, var(--accent-loss))'
const DRAW_COLOR = 'var(--accent-warn)'

// SVG geometry (viewBox units).
const VIEW_W = 720
const VIEW_H = 216
const PAD_X = 10
const BAND_TOP = 22
const BAND_BOTTOM = 168
const BAND_H = BAND_BOTTOM - BAND_TOP
const AWAY_STRIP_Y = 10
const HOME_STRIP_Y = 180
const AXIS_Y = 204

function minuteLabel(minute: number, addedTime?: number): string {
  return `${minute}${addedTime ? `+${addedTime}` : ''}'`
}

/** Marker glyph on its strip — goal / own goal / penalty / red card. */
function MarkerGlyph({ marker, cx, cy }: { marker: RiverMarker; cx: number; cy: number }) {
  const tint = marker.team === 'home' ? HOME_COLOR : AWAY_COLOR
  if (marker.type === 'red_card') {
    return <rect x={cx - 3} y={cy - 4.5} width={6} height={9} rx={1.2} fill="var(--accent-loss)" />
  }
  if (marker.type === 'own_goal') {
    return <circle cx={cx} cy={cy} r={3.6} fill="var(--card-bg)" stroke={tint} strokeWidth={1.8} />
  }
  if (marker.type === 'penalty_goal') {
    return (
      <g>
        <circle cx={cx} cy={cy} r={4.2} fill={tint} />
        <circle cx={cx} cy={cy} r={1.5} fill="var(--card-bg)" />
      </g>
    )
  }
  return <circle cx={cx} cy={cy} r={4.2} fill={tint} />
}

export function MomentumRiver({ match, isFinished }: { match: MatchDetails; isFinished: boolean }) {
  const [river, setRiver] = useState<MomentumRiverData | null>(null)
  const reducedMotion = useReducedMotion()
  const clipId = useId()

  useEffect(() => {
    if (!isFinished) return
    let cancelled = false
    buildMomentumRiver(match)
      .then((built) => {
        if (!cancelled) setRiver(built)
      })
      .catch(() => {
        /* honest empty: render nothing */
      })
    return () => {
      cancelled = true
    }
  }, [match, isFinished])

  if (!isFinished || !river) return null

  const { segments, markers, turningPoint, domainMax, minN, matchesCovered } = river
  const xOf = (m: number) => PAD_X + (m / domainMax) * (VIEW_W - 2 * PAD_X)

  // Band boundary polylines — one horizontal run per segment, vertical jumps
  // between them ARE the steps (no interpolation).
  const homePts: string[] = []
  const awayPts: string[] = []
  for (const s of segments) {
    const yHome = BAND_BOTTOM - s.pHome * BAND_H
    const yAway = BAND_TOP + s.pAway * BAND_H
    homePts.push(`${xOf(s.x0)},${yHome}`, `${xOf(s.x1)},${yHome}`)
    awayPts.push(`${xOf(s.x0)},${yAway}`, `${xOf(s.x1)},${yAway}`)
  }
  const xStart = xOf(segments[0].x0)
  const xEnd = xOf(segments[segments.length - 1].x1)
  const homeBoundary = `M ${homePts.join(' L ')}`
  const awayBoundary = `M ${awayPts.join(' L ')}`
  const homeArea = `M ${xStart},${BAND_BOTTOM} L ${homePts.join(' L ')} L ${xEnd},${BAND_BOTTOM} Z`
  const awayArea = `M ${xStart},${BAND_TOP} L ${awayPts.join(' L ')} L ${xEnd},${BAND_TOP} Z`
  const drawArea = `M ${awayPts.join(' L ')} L ${[...homePts].reverse().join(' L ')} Z`

  // Marker minute labels — drop a label (never the marker) when it would
  // collide with the previous one on the same strip.
  let lastLabelEnd = { home: -Infinity, away: -Infinity }
  const labelled = markers.map((m) => {
    const cx = xOf(m.x)
    const text = minuteLabel(m.minute, m.addedTime)
    const width = text.length * 5.4
    const flip = cx + 7 + width > VIEW_W - 2
    const start = flip ? cx - 7 - width : cx + 7
    const showLabel = start > lastLabelEnd[m.team] + 4
    if (showLabel) lastLabelEnd = { ...lastLabelEnd, [m.team]: start + width }
    return { marker: m, cx, text, flip, showLabel }
  })

  const axisTicks = [0, 15, 30, 45, 60, 75, 90]
  const tpX = turningPoint ? xOf(turningPoint.x) : 0
  const tpFlip = turningPoint ? tpX > VIEW_W * 0.72 : false

  const legend = [
    { label: `${match.home_team} win`, color: HOME_COLOR },
    { label: 'Draw', color: DRAW_COLOR },
    { label: `${match.away_team} win`, color: AWAY_COLOR },
  ]

  return (
    <section
      aria-label="Win probability"
      className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
    >
      <div className="border-b border-[var(--border-color)] px-4 py-3">
        <SectionHeader
          title="Win probability"
          description={`How often teams in ${match.home_team}'s position went on to win, draw or lose — recounted at every goal and five-minute mark.`}
        />
      </div>

      <div className="px-4 pb-3 pt-4">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {legend.map((item) => (
            <span key={item.label} className="inline-flex min-w-0 items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.color }}
                aria-hidden
              />
              <span className="truncate font-medium text-[var(--text-secondary)]">{item.label}</span>
            </span>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              className="block w-full"
              role="img"
              aria-label={`Historical win, draw and loss shares for ${match.home_team} against ${match.away_team} across the match timeline`}
            >
              <defs>
                <clipPath id={clipId}>
                  <motion.rect
                    x={0}
                    y={0}
                    height={VIEW_H}
                    initial={reducedMotion ? false : { width: 0 }}
                    animate={{ width: VIEW_W }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  />
                </clipPath>
              </defs>

              <g clipPath={`url(#${clipId})`}>
                {/* Bands — steps at goals and bucket boundaries only. Rounded
                    joins on the edge strokes are the sole rendering polish. */}
                <path d={homeArea} fill={HOME_COLOR} fillOpacity={0.32} />
                <path d={awayArea} fill={AWAY_COLOR} fillOpacity={0.32} />
                <path d={drawArea} fill={DRAW_COLOR} fillOpacity={0.2} />
                <path
                  d={homeBoundary}
                  fill="none"
                  stroke={HOME_COLOR}
                  strokeWidth={1.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <path
                  d={awayBoundary}
                  fill="none"
                  stroke={AWAY_COLOR}
                  strokeWidth={1.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />

                {/* HT and 90' hairlines — quiet structure, no grid. */}
                {[45, 90].map((m) => (
                  <line
                    key={m}
                    x1={xOf(m)}
                    y1={BAND_TOP}
                    x2={xOf(m)}
                    y2={BAND_BOTTOM}
                    stroke="var(--border-color)"
                    strokeWidth={1}
                    strokeDasharray="3,3"
                  />
                ))}

                {/* Turning point — subtle hairline + minute/score receipt. */}
                {turningPoint && (
                  <g>
                    <line
                      x1={tpX}
                      y1={BAND_TOP}
                      x2={tpX}
                      y2={BAND_BOTTOM}
                      stroke="var(--accent-primary)"
                      strokeWidth={1}
                      strokeOpacity={0.65}
                    />
                    <text
                      x={tpFlip ? tpX - 6 : tpX + 6}
                      y={BAND_TOP + 14}
                      textAnchor={tpFlip ? 'end' : 'start'}
                      fontSize={7.5}
                      fontWeight={600}
                      letterSpacing={1}
                      fill="var(--accent-primary)"
                      stroke="var(--card-bg)"
                      strokeWidth={3}
                      style={{ paintOrder: 'stroke' }}
                    >
                      TURNING POINT
                    </text>
                    <text
                      x={tpFlip ? tpX - 6 : tpX + 6}
                      y={BAND_TOP + 27}
                      textAnchor={tpFlip ? 'end' : 'start'}
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--text-primary)"
                      stroke="var(--card-bg)"
                      strokeWidth={3}
                      style={{ paintOrder: 'stroke', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {minuteLabel(turningPoint.minute, turningPoint.addedTime)}{' '}
                      {turningPoint.scoreAfter.home}-{turningPoint.scoreAfter.away}
                    </text>
                  </g>
                )}

                {/* Event markers — home strip below, away strip above. */}
                {labelled.map(({ marker, cx, text, flip, showLabel }, i) => {
                  const cy = marker.team === 'home' ? HOME_STRIP_Y : AWAY_STRIP_Y
                  return (
                    <g key={`${marker.minute}-${marker.addedTime ?? 0}-${marker.type}-${i}`}>
                      <line
                        x1={cx}
                        y1={marker.team === 'home' ? BAND_BOTTOM : cy + 7}
                        x2={cx}
                        y2={marker.team === 'home' ? cy - 7 : BAND_TOP}
                        stroke="var(--border-color)"
                        strokeWidth={0.75}
                      />
                      <MarkerGlyph marker={marker} cx={cx} cy={cy} />
                      {showLabel && (
                        <text
                          x={flip ? cx - 7 : cx + 7}
                          y={cy + 3}
                          textAnchor={flip ? 'end' : 'start'}
                          fontSize={9}
                          fill="var(--text-tertiary)"
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {text}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>

              {/* Axis — outside the reveal clip so the frame is always stable. */}
              {axisTicks.map((m) => (
                <text
                  key={m}
                  x={xOf(m)}
                  y={AXIS_Y}
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

        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          {matchesCovered > 0 ? `Based on ${matchesCovered.toLocaleString()} matches. ` : ''}
          Bands move only when the score or the five-minute window changes; the thinnest band here
          still counts{' '}
          <span className="tabular-nums font-medium text-[var(--text-secondary)]">
            {minN.toLocaleString()}
          </span>{' '}
          matches in the identical position.
        </p>
      </div>
    </section>
  )
}
