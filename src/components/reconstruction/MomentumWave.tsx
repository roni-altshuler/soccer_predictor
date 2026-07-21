'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useReducedMotion } from 'framer-motion'
import * as THREE from 'three'

import type { MomentumLandscape } from '@/lib/reconstructions'

import {
  buildSurface,
  dominantZone,
  leaderAt,
  minuteLabel,
  sampleAt,
  scoreAt,
  timeToX,
  xToTime,
  type RGB,
} from './landscape'
import { readScenePalette, rgbToHex, type ScenePalette } from './palette'

/**
 * MomentumWave — a finished match rendered as a sweeping 3D momentum landscape.
 *
 * The long axis is match time; the short axis is the pitch from the home team's
 * point of view (defensive → middle → attacking third); the height and colour
 * are the signed net threat in that zone at that moment — green and up for the
 * home side, red and down for the away side, amber when balanced. Every vertex
 * is a measured value from the committed artifact; nothing is interpolated into
 * the surface (see `landscape.ts`).
 *
 * A playhead sweeps along the clock; hovering the surface reads any moment
 * instead. With `prefers-reduced-motion` the playhead parks at full time — a
 * single composed frame you can still orbit and hover.
 *
 * Honest empty: a null/invalid landscape renders a plain notice, never a broken
 * or placeholder mesh.
 */

const SWEEP_SECONDS = 22
const TIME_SPAN = 46
const DEPTH_SPAN = 11
const AMPLITUDE = 6.5
/** Perceptual colour exponent — lifts small real momenta into visible hue. */
const COLOR_GAMMA = 0.5

interface WaveDims {
  timeSpan: number
  depthSpan: number
  amplitude: number
  domainMinutes: number
}

// ---------------------------------------------------------------------------
// Scene pieces (inside <Canvas>)
// ---------------------------------------------------------------------------

function Surface({
  landscape,
  dims,
  palette,
  onHover,
}: {
  landscape: MomentumLandscape
  dims: WaveDims
  palette: ScenePalette
  onHover: (t: number | null) => void
}) {
  const geometry = useMemo(() => {
    const surf = buildSurface(landscape.bins, {
      timeSpan: dims.timeSpan,
      depthSpan: dims.depthSpan,
      amplitude: dims.amplitude,
      domainMinutes: dims.domainMinutes,
      home: palette.home,
      away: palette.away,
      neutral: palette.neutral,
      colorGamma: COLOR_GAMMA,
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(surf.positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(surf.colors, 3))
    g.setIndex(new THREE.BufferAttribute(surf.indices, 1))
    g.computeVertexNormals()
    return g
  }, [landscape.bins, dims, palette])

  useEffect(() => () => geometry.dispose(), [geometry])

  const lastEmit = useRef(0)

  return (
    <mesh
      geometry={geometry}
      onPointerMove={(e) => {
        e.stopPropagation()
        const now = performance.now()
        if (now - lastEmit.current < 40) return
        lastEmit.current = now
        onHover(xToTime(e.point.x, dims.domainMinutes, dims.timeSpan))
      }}
      onPointerOut={() => onHover(null)}
    >
      <meshStandardMaterial
        vertexColors
        roughness={0.62}
        metalness={0.04}
        side={THREE.DoubleSide}
        flatShading={false}
      />
    </mesh>
  )
}

function Playhead({
  landscape,
  dims,
  palette,
  reduced,
  onProbe,
}: {
  landscape: MomentumLandscape
  dims: WaveDims
  palette: ScenePalette
  reduced: boolean
  onProbe: (t: number) => void
}) {
  const planeRef = useRef<THREE.Mesh>(null)
  const ballRef = useRef<THREE.Mesh>(null)
  const phase = useRef(0)
  const lastEmit = useRef(-1)
  const accentHex = rgbToHex(palette.accent)

  useFrame((state, delta) => {
    phase.current = reduced ? 1 : (phase.current + delta / SWEEP_SECONDS) % 1
    const t = phase.current * dims.domainMinutes
    const x = timeToX(t, dims.domainMinutes, dims.timeSpan)
    const y = sampleAt(landscape.bins, t).momentum * dims.amplitude
    if (planeRef.current) planeRef.current.position.x = x
    if (ballRef.current) {
      ballRef.current.position.x = x
      ballRef.current.position.y = y
    }
    const now = state.clock.elapsedTime
    if (lastEmit.current < 0 || now - lastEmit.current > 0.12) {
      lastEmit.current = now
      onProbe(t)
    }
  })

  return (
    <group>
      <mesh ref={planeRef} position={[0, 0, 0]}>
        <boxGeometry args={[0.1, dims.amplitude * 2.6, dims.depthSpan * 1.08]} />
        <meshBasicMaterial color={accentHex} transparent opacity={0.14} depthWrite={false} />
      </mesh>
      <mesh ref={ballRef} position={[0, 0, 0]}>
        <sphereGeometry args={[0.42, 20, 20]} />
        <meshStandardMaterial
          color={accentHex}
          emissive={accentHex}
          emissiveIntensity={0.9}
          roughness={0.3}
        />
      </mesh>
    </group>
  )
}

function EventMarkers({
  landscape,
  dims,
  palette,
}: {
  landscape: MomentumLandscape
  dims: WaveDims
  palette: ScenePalette
}) {
  const homeHex = rgbToHex(palette.home)
  const awayHex = rgbToHex(palette.away)
  const z = -dims.depthSpan / 2 - 0.5

  return (
    <group>
      {landscape.keyEvents
        .filter((e) => e.type === 'goal' || e.type === 'card')
        .map((e, i) => {
          const x = timeToX(e.t, dims.domainMinutes, dims.timeSpan)
          const isGoal = e.type === 'goal'
          const h = isGoal ? dims.amplitude * 1.9 : dims.amplitude * 0.9
          const color = e.team === 'home' ? homeHex : awayHex
          return (
            <group key={`${e.type}-${e.t}-${i}`} position={[x, 0, z]}>
              <mesh position={[0, h / 2, 0]}>
                <cylinderGeometry args={[0.045, 0.045, h, 8]} />
                <meshBasicMaterial color={color} transparent opacity={isGoal ? 0.85 : 0.5} />
              </mesh>
              {isGoal && (
                <mesh position={[0, h, 0]}>
                  <sphereGeometry args={[0.24, 14, 14]} />
                  <meshStandardMaterial
                    color={color}
                    emissive={color}
                    emissiveIntensity={0.5}
                    roughness={0.4}
                  />
                </mesh>
              )}
            </group>
          )
        })}
    </group>
  )
}

function Scene({
  landscape,
  dims,
  palette,
  reduced,
  onProbe,
  onHover,
}: {
  landscape: MomentumLandscape
  dims: WaveDims
  palette: ScenePalette
  reduced: boolean
  onProbe: (t: number) => void
  onHover: (t: number | null) => void
}) {
  const bgHex = rgbToHex(palette.background)
  const gridHex = rgbToHex(palette.grid)

  return (
    <>
      <fog attach="fog" args={[bgHex, dims.timeSpan * 1.05, dims.timeSpan * 2.5]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[-10, 26, 18]} intensity={1.25} />
      <directionalLight position={[16, 12, -14]} intensity={0.4} />

      <Surface landscape={landscape} dims={dims} palette={palette} onHover={onHover} />
      <EventMarkers landscape={landscape} dims={dims} palette={palette} />
      <Playhead
        landscape={landscape}
        dims={dims}
        palette={palette}
        reduced={reduced}
        onProbe={onProbe}
      />

      <gridHelper
        args={[dims.timeSpan * 1.5, 30, gridHex, gridHex]}
        position={[0, -dims.amplitude * 1.15, 0]}
      />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={22}
        maxDistance={64}
        minPolarAngle={0.18}
        maxPolarAngle={1.42}
        target={[0, 0, 0]}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Component (DOM shell + readout)
// ---------------------------------------------------------------------------

function EmptyNotice() {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-10 text-center">
      <p className="text-sm font-medium text-[var(--text-secondary)]">
        This reconstruction isn&apos;t available.
      </p>
      <p className="mt-1 text-xs text-[var(--text-tertiary)]">
        The momentum landscape for this match could not be loaded.
      </p>
    </div>
  )
}

const dot = (color: RGB) => rgbToHex(color)

export function MomentumWave({ landscape }: { landscape: MomentumLandscape | null }) {
  const reduced = useReducedMotion() ?? false
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [palette, setPalette] = useState<ScenePalette | null>(null)
  const [playT, setPlayT] = useState(0)
  const [hoverT, setHoverT] = useState<number | null>(null)

  // Resolve tokens off the mounted wrapper, and re-resolve when the theme flips.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const refresh = () => setPalette(readScenePalette(el))
    refresh()
    const mo = new MutationObserver(refresh)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    return () => mo.disconnect()
  }, [])

  const domainMinutes = useMemo(
    () => (landscape ? landscape.bins[landscape.bins.length - 1].t : 0),
    [landscape]
  )

  const dims: WaveDims = useMemo(
    () => ({ timeSpan: TIME_SPAN, depthSpan: DEPTH_SPAN, amplitude: AMPLITUDE, domainMinutes }),
    [domainMinutes]
  )

  if (!landscape || landscape.bins.length === 0) return <EmptyNotice />

  const shownT = hoverT ?? playT
  const sample = sampleAt(landscape.bins, shownT)
  const score = scoreAt(landscape.keyEvents, shownT)
  const leader = leaderAt(sample.momentum)
  const zoneIdx = dominantZone(sample.zoneIntensities)
  const isHover = hoverT !== null
  const atFullTime = !isHover && (reduced || shownT >= domainMinutes - 1e-6)

  const leaderText =
    leader === 'home'
      ? `${landscape.home.team} on top`
      : leader === 'away'
        ? `${landscape.away.team} on top`
        : 'Level'

  return (
    <section
      aria-label={`Three-dimensional momentum landscape for ${landscape.home.team} against ${landscape.away.team}, ${landscape.competition} ${landscape.stage}, final score ${landscape.finalScore.home}–${landscape.finalScore.away}${landscape.finalScore.note ? `, ${landscape.finalScore.note}` : ''}.`}
      className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
    >
      <div
        ref={wrapRef}
        className="relative w-full touch-none select-none"
        style={{ height: 'clamp(320px, 46vw, 560px)' }}
      >
        {palette && (
          <Canvas
            dpr={[1, 2]}
            camera={{ position: [2, AMPLITUDE * 3.2, TIME_SPAN * 0.52], fov: 45 }}
            gl={{ antialias: true }}
          >
            <Scene
              landscape={landscape}
              dims={dims}
              palette={palette}
              reduced={reduced}
              onProbe={setPlayT}
              onHover={setHoverT}
            />
          </Canvas>
        )}
      </div>

      {/* Readout — every figure is the measured value under that moment. */}
      <div className="px-4 pb-4 pt-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            {isHover ? 'On the wave' : atFullTime ? 'Full time' : 'Playing'}
          </span>
          <span className="text-sm font-medium tabular-nums text-[var(--text-secondary)]">
            {minuteLabel(shownT)}
          </span>
          <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
            {landscape.home.team} {score.home}–{score.away} {landscape.away.team}
          </span>
          <span className="text-sm text-[var(--text-secondary)]">
            <span className="font-bold text-[var(--text-primary)]">{leaderText}</span>
            {leader !== 'even' && (
              <>
                {' · '}
                {landscape.zones[zoneIdx].toLowerCase()}
              </>
            )}
          </span>
        </div>

        {/* Legend — the elevation ramp is the outcome ramp. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {[
            { label: `${landscape.home.team} threat`, color: dot(palette?.home ?? [0, 0.75, 0.38]) },
            { label: 'Balanced', color: dot(palette?.neutral ?? [0.96, 0.69, 0.13]) },
            { label: `${landscape.away.team} threat`, color: dot(palette?.away ?? [1, 0.36, 0.36]) },
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

        {/* Key-event timeline — click to read that moment. */}
        {landscape.keyEvents.some((e) => e.type === 'goal' || e.type === 'card') && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {landscape.keyEvents
              .filter((e) => e.type === 'goal' || e.type === 'card')
              .map((e, i) => {
                const teamColor =
                  e.team === 'home'
                    ? 'var(--accent-primary)'
                    : 'var(--accent-loss)'
                return (
                  <button
                    key={`${e.type}-${e.t}-${i}`}
                    type="button"
                    onClick={() => setHoverT(e.t)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-2.5 py-1 text-[11px] transition-colors hover:bg-[var(--card-hover)]"
                    title={`${e.minute}′ ${e.player}${e.detail ? ` — ${e.detail}` : ''}`}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: teamColor }}
                      aria-hidden
                    />
                    <span className="tabular-nums font-semibold text-[var(--text-secondary)]">
                      {e.minute}′
                    </span>
                    <span
                      className={
                        e.type === 'goal'
                          ? 'font-semibold text-[var(--text-primary)]'
                          : 'text-[var(--text-tertiary)]'
                      }
                    >
                      {e.type === 'goal' ? '⚽' : '▪'} {e.player}
                    </span>
                  </button>
                )
              })}
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Height and colour are the net attacking threat in each third of the pitch, from{' '}
          {landscape.home.team}&apos;s point of view — passes, carries and shots weighted by how
          dangerous the ball&apos;s position was. Up and green is {landscape.home.team}; down and red
          is {landscape.away.team}. Drag to orbit; hover the surface to read any moment.{' '}
          <span className="font-medium text-[var(--text-secondary)]">
            Data: {landscape.dataCredit}
          </span>
          .
        </p>
      </div>
    </section>
  )
}
