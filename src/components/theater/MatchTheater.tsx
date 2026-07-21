'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useReducedMotion } from 'framer-motion'

import { SectionHeader } from '@/components/primitives'

import {
  buildTheaterField,
  fetchTheaterField,
  theaterGender,
  type TheaterData,
} from './field'
import type { MatchDetails } from '../match/detail/types'
import {
  PITCH_BASE,
  PITCH_MAX,
  PITCH_MIN,
  YAW_BASE,
  YAW_RANGE,
  clamp,
  distanceToSegment,
  fitCamera,
} from './projection'
import { drawScene, fieldFitPoints, type Palette, type PathHit, type RGB } from './scene'

/**
 * MatchTheater — the win-chance landscape.
 *
 * A finished match is a walk across a real 3D field: the clock on one axis,
 * the score difference on the other, and how often teams in that exact
 * position went on to win as the height. Every tile is an exact count over
 * the warehouse; the bright line is this match, stepping to the neighbouring
 * ridge at each goal.
 *
 * Rendered with Canvas 2D and a hand-rolled camera (see `projection.ts`) —
 * no 3D dependency, no WebGL context to lose, identical everywhere.
 *
 * Honest empty behaviour: when the field can't be built (unfinished match,
 * events that don't reconcile, a run resting on a thin state, missing
 * artifact, no canvas) this renders NOTHING — no skeleton, no placeholder.
 *
 * Motion: a slow idle sway, drag to orbit, hover or tap the line to read the
 * exact numbers. With `prefers-reduced-motion` there is no sway and no
 * entrance — a single composed frame, still fully interactive.
 */

const CANVAS_H_DESKTOP = 480
const CANVAS_H_MOBILE = 300
const HIT_RADIUS = 26
/** Idle sway period, ms. Slow enough to read as drift, not spin. */
const SWAY_PERIOD = 26000
/** How long a drag suppresses the idle sway. */
const SWAY_RESUME_MS = 4000

interface TokenSpec {
  key: keyof Palette
  varName: string
  fallback: string
}

// The elevation ramp is the outcome ramp, not the club ramp: a win is green,
// a loss is red, the balance point is amber — so a height means the same
// thing on every match's landscape and against the 2D river's legend.
const TOKENS: TokenSpec[] = [
  { key: 'home', varName: '--accent-primary', fallback: '#00c060' },
  { key: 'away', varName: '--accent-loss', fallback: '#ff5c5c' },
  { key: 'draw', varName: '--accent-warn', fallback: '#f5b021' },
  { key: 'card', varName: '--card-bg', fallback: '#1f2320' },
  { key: 'border', varName: '--border-color', fallback: '#333835' },
  { key: 'text', varName: '--text-primary', fallback: '#f6f7f6' },
  { key: 'textDim', varName: '--text-tertiary', fallback: '#7f847f' },
]

/**
 * Resolve a CSS custom property to RGB by letting the canvas parse it — that
 * handles hex, rgb(), and color-mix() alike without a colour parser here, and
 * keeps every colour in this component a token (never a literal).
 */
function readPalette(el: HTMLElement, probe: CanvasRenderingContext2D): Palette {
  const styles = getComputedStyle(el)
  const out = {} as Palette
  for (const spec of TOKENS) {
    const raw = styles.getPropertyValue(spec.varName).trim() || spec.fallback
    out[spec.key] = parseColor(raw, probe) ?? parseColor(spec.fallback, probe) ?? [128, 128, 128]
  }
  return out
}

function parseColor(value: string, probe: CanvasRenderingContext2D): RGB | null {
  try {
    probe.fillStyle = '#000000'
    probe.fillStyle = value
    const normalized = probe.fillStyle
    if (typeof normalized !== 'string') return null
    if (normalized.startsWith('#')) {
      const hex = normalized.slice(1)
      const full =
        hex.length === 3
          ? hex
              .split('')
              .map((c) => c + c)
              .join('')
          : hex
      return [
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
      ]
    }
    const m = normalized.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const parts = m[1].split(',').map((s) => parseFloat(s))
    if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) return null
    return [parts[0], parts[1], parts[2]]
  } catch {
    return null
  }
}

function minuteLabel(minute: number, addedTime?: number): string {
  return `${minute}${addedTime ? `+${addedTime}` : ''}'`
}

/** Chart minute → the clock text a reader expects (the 90+ zone reads "90+"). */
function spanClock(x0: number, x1: number): string {
  const start = Math.round(x0)
  const end = Math.round(x1)
  if (start >= 90) return "90'+"
  if (end >= 90 && start < 90) return `${start}'–90'`
  return `${start}'–${end}'`
}

export function MatchTheater({ match, isFinished }: { match: MatchDetails; isFinished: boolean }) {
  const [data, setData] = useState<TheaterData | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [perf, setPerf] = useState<{ ms: number; primitives: number } | null>(null)
  const reducedMotion = useReducedMotion()

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Live render state kept in refs — the animation loop must never re-render.
  const cameraRef = useRef({ yaw: YAW_BASE, pitch: PITCH_BASE })
  const swayUntilRef = useRef(0)
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const hitsRef = useRef<PathHit[]>([])
  const paletteRef = useRef<Palette | null>(null)
  const dataRef = useRef<TheaterData | null>(null)
  const hoveredRef = useRef<number | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const fitPointsRef = useRef<ReturnType<typeof fieldFitPoints> | null>(null)
  const visibleRef = useRef(true)
  const dirtyRef = useRef(true)
  const rafRef = useRef<number | null>(null)
  const perfRef = useRef({ frames: 0, total: 0 })

  dataRef.current = data
  hoveredRef.current = hovered

  // The framing target is the terrain silhouette; it only changes with the data.
  useEffect(() => {
    fitPointsRef.current = data ? fieldFitPoints(data) : null
    dirtyRef.current = true
  }, [data])

  // -- data ---------------------------------------------------------------
  useEffect(() => {
    if (!isFinished) return
    let cancelled = false
    fetchTheaterField(theaterGender(match))
      .then((payload) => {
        if (cancelled) return
        setData(buildTheaterField(match, payload))
      })
      .catch(() => {
        /* honest empty: render nothing */
      })
    return () => {
      cancelled = true
    }
  }, [match, isFinished])

  // -- render loop ---------------------------------------------------------
  const paint = useCallback(
    (now: number) => {
      const canvas = canvasRef.current
      const scene = dataRef.current
      const palette = paletteRef.current
      if (!canvas || !scene || !palette) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const { w, h } = sizeRef.current
      if (w === 0 || h === 0) return

      const swaying = !reducedMotion && now > swayUntilRef.current && !dragRef.current
      const sway = swaying ? Math.sin((now / SWAY_PERIOD) * Math.PI * 2) * YAW_RANGE * 0.55 : 0
      const yaw = clamp(cameraRef.current.yaw + sway, YAW_BASE - YAW_RANGE, YAW_BASE + YAW_RANGE)
      const cam = fitCamera(w, h, yaw, cameraRef.current.pitch, undefined, fitPointsRef.current ?? undefined)

      const t0 = performance.now()
      const result = drawScene(ctx, scene, cam, palette, {
        width: w,
        height: h,
        hoveredSpan: hoveredRef.current,
      })
      const cost = performance.now() - t0

      hitsRef.current = result.hits
      const probe = perfRef.current
      probe.frames += 1
      probe.total += cost
      if (probe.frames % 30 === 0) {
        setPerf({ ms: probe.total / probe.frames, primitives: result.primitives })
      }
    },
    [reducedMotion]
  )

  useEffect(() => {
    if (!data) return
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const probeCanvas = document.createElement('canvas')
    const probe = probeCanvas.getContext('2d')
    if (!probe) return // no canvas support → nothing is rendered, honestly

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      sizeRef.current = { w, h }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      dirtyRef.current = true
    }

    const refreshPalette = () => {
      paletteRef.current = readPalette(wrap, probe)
      dirtyRef.current = true
    }

    refreshPalette()
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    // Re-sample the tokens when the theme flips.
    const mo = new MutationObserver(refreshPalette)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })

    const io = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries.some((e) => e.isIntersecting)
        dirtyRef.current = true
      },
      { rootMargin: '120px' }
    )
    io.observe(wrap)

    const onVisibility = () => {
      dirtyRef.current = true
    }
    document.addEventListener('visibilitychange', onVisibility)

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop)
      // Offscreen or backgrounded: burn nothing.
      if (!visibleRef.current || document.hidden) return
      const animating = !reducedMotion && !dragRef.current && now > swayUntilRef.current
      if (!animating && !dirtyRef.current) return
      dirtyRef.current = false
      paint(now)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      mo.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [data, paint, reducedMotion])

  // Any state the loop reads from React must mark the frame dirty.
  useEffect(() => {
    dirtyRef.current = true
  }, [hovered])

  // -- interaction ---------------------------------------------------------
  const hitTest = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    let best: { index: number; d: number } | null = null
    for (const hit of hitsRef.current) {
      const d = distanceToSegment(px, py, hit.ax, hit.ay, hit.bx, hit.by)
      if (d <= HIT_RADIUS && (!best || d < best.d)) best = { index: hit.spanIndex, d }
    }
    return best ? best.index : null
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x
        const dy = e.clientY - drag.y
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true
        cameraRef.current = {
          yaw: clamp(cameraRef.current.yaw + dx * 0.006, YAW_BASE - YAW_RANGE, YAW_BASE + YAW_RANGE),
          pitch: clamp(cameraRef.current.pitch + dy * 0.005, PITCH_MIN, PITCH_MAX),
        }
        drag.x = e.clientX
        drag.y = e.clientY
        dirtyRef.current = true
        return
      }
      if (e.pointerType === 'touch') return
      const index = hitTest(e.clientX, e.clientY)
      setHovered((prev) => (prev === index ? prev : index))
    },
    [hitTest]
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      if (drag?.moved) {
        swayUntilRef.current = performance.now() + SWAY_RESUME_MS
        dirtyRef.current = true
        return
      }
      // A tap (no drag) reads the line — the touch equivalent of hover.
      const index = hitTest(e.clientX, e.clientY)
      setHovered(index)
    },
    [hitTest]
  )

  const active = useMemo(() => {
    if (!data) return null
    const index = hovered !== null && data.spans[hovered] ? hovered : data.spans.length - 1
    return { span: data.spans[index], isHover: hovered !== null }
  }, [data, hovered])

  if (!isFinished || !data || !active) return null

  const { span, isHover } = active
  const goals = data.events.filter((e) => e.type !== 'red_card')
  const biggest = data.events.reduce<{ delta: number; ev: (typeof data.events)[number] } | null>(
    (best, ev) => {
      if (ev.pBefore === undefined || ev.pAfter === undefined) return best
      const delta = ev.pAfter - ev.pBefore
      return !best || Math.abs(delta) > Math.abs(best.delta) ? { delta, ev } : best
    },
    null
  )

  return (
    <section
      aria-label="Win chance landscape"
      className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
    >
      <div className="border-b border-[var(--border-color)] px-4 py-3">
        <SectionHeader
          title="Win chance landscape"
          description={`Height is how often teams in ${match.home_team}'s position went on to win, across every minute and every score. The line is the path this match took.`}
        />
      </div>

      <div className="px-4 pb-3 pt-4">
        <div
          ref={wrapRef}
          className="relative w-full touch-none select-none"
          style={{ height: `clamp(${CANVAS_H_MOBILE}px, 34vw, ${CANVAS_H_DESKTOP}px)` }}
        >
          <canvas
            ref={canvasRef}
            className="block h-full w-full cursor-grab active:cursor-grabbing"
            role="img"
            aria-label={`Three-dimensional win chance field for ${match.home_team} against ${match.away_team}. ${match.home_team} finished ${data.finalScore.home}-${data.finalScore.away} with a final win chance of ${Math.round(data.spans[data.spans.length - 1].pHome * 100)} percent for teams in that position.`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => setHovered(null)}
          />
        </div>

        {/* Readout — every figure is the counted value under that point. */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            {isHover ? 'On the line' : 'Full time'}
          </span>
          <span className="text-sm font-medium tabular-nums text-[var(--text-secondary)]">
            {spanClock(span.x0, span.x1)}
          </span>
          <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
            {span.home}–{span.away}
          </span>
          <span className="text-sm text-[var(--text-secondary)]">
            <span className="font-bold tabular-nums text-[var(--text-primary)]">
              {Math.round(span.pHome * 100)}%
            </span>{' '}
            {match.home_team} win chance
          </span>
          <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
            {span.n.toLocaleString()} matches counted here
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {[
            { label: `${match.home_team} win`, color: 'var(--accent-primary)' },
            { label: 'Even', color: 'var(--accent-warn)' },
            { label: `${match.away_team} win`, color: 'var(--accent-loss)' },
          ].map((item) => (
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

        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          {data.matchesCovered > 0 ? `Based on ${data.matchesCovered.toLocaleString()} matches. ` : ''}
          The surface steps only where the counts change — at every goal and every five-minute mark
          — and stops wherever too few matches reached that position.{' '}
          {goals.length > 0 && (
            <>
              This match stepped{' '}
              <span className="tabular-nums font-medium text-[var(--text-secondary)]">
                {goals.length}
              </span>{' '}
              time{goals.length === 1 ? '' : 's'}
              {biggest && biggest.ev.pBefore !== undefined && biggest.ev.pAfter !== undefined ? (
                <>
                  , the biggest at{' '}
                  <span className="tabular-nums font-medium text-[var(--text-secondary)]">
                    {minuteLabel(biggest.ev.minute, biggest.ev.addedTime)}
                  </span>{' '}
                  ({Math.round(biggest.ev.pBefore * 100)}% →{' '}
                  {Math.round(biggest.ev.pAfter * 100)}%)
                </>
              ) : null}
              .{' '}
            </>
          )}
          Drag to turn the field.
          {perf ? (
            <span className="sr-only">
              {` Frame cost ${perf.ms.toFixed(1)} milliseconds over ${perf.primitives} shapes.`}
            </span>
          ) : null}
        </p>
      </div>
    </section>
  )
}
