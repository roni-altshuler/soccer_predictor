/**
 * Pure geometry, colour and probe helpers for the 3D momentum wave.
 *
 * Everything here is framework-free (no three, no React) so it can be unit
 * tested in jsdom and so the R3F component stays a thin rendering shell. The
 * surface is built from the committed landscape's real bins only — the mesh
 * has exactly one vertex per (time bin × zone) measurement. Nothing is
 * interpolated into the geometry; the only interpolation is `sampleAt`, used
 * for the readout under a continuously-moving playhead (reading between two
 * measured bins, the way a line chart reads between its points).
 */

import type { MomentumBin, MomentumKeyEvent } from '@/lib/reconstructions'

export type RGB = [number, number, number]

export interface SurfaceOptions {
  /** World length of the time axis (X). */
  timeSpan: number
  /** World depth of the zone axis (Z). */
  depthSpan: number
  /** World height for |intensity| = 1 (Y). */
  amplitude: number
  /** Domain end in minutes — the last bin's `t`. */
  domainMinutes: number
  home: RGB
  away: RGB
  neutral: RGB
  /**
   * Perceptual exponent applied to |intensity| for COLOUR only (default 1 =
   * linear). A value below 1 (e.g. 0.5) lifts small real momenta out of the
   * neutral band so the green/red story is visible, without ever changing the
   * sign or the honest linear HEIGHT. This is a colour scale, not smoothing.
   */
  colorGamma?: number
}

export interface SurfaceGeometry {
  positions: Float32Array
  colors: Float32Array
  indices: Uint32Array
  /** Number of time samples (grid width). */
  nTime: number
  /** Number of zone samples (grid depth) — always 3. */
  nZone: number
}

const ZONES = 3

/** Clamp a number into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Map a match-minute `t` to its world X on the centred time axis. */
export function timeToX(t: number, domainMinutes: number, timeSpan: number): number {
  const f = domainMinutes > 0 ? t / domainMinutes : 0
  return (f - 0.5) * timeSpan
}

/** Inverse of {@link timeToX} — world X back to a match-minute (clamped to domain). */
export function xToTime(x: number, domainMinutes: number, timeSpan: number): number {
  const f = timeSpan > 0 ? x / timeSpan + 0.5 : 0
  return clamp(f * domainMinutes, 0, domainMinutes)
}

/**
 * Colour for a signed intensity `v` in [-1, 1]: neutral (amber) at 0, ramping
 * to `home` (green) as v → +1 and `away` (red) as v → −1. Linear RGB lerp.
 */
export function momentumColor(v: number, home: RGB, away: RGB, neutral: RGB): RGB {
  const t = clamp(Math.abs(v), 0, 1)
  const target = v >= 0 ? home : away
  return [
    neutral[0] + (target[0] - neutral[0]) * t,
    neutral[1] + (target[1] - neutral[1]) * t,
    neutral[2] + (target[2] - neutral[2]) * t,
  ]
}

/**
 * Build the surface mesh: one vertex per (bin, zone) with height = the zone's
 * signed intensity and colour from that same value. No interpolation — every
 * vertex is a measured number.
 */
export function buildSurface(bins: MomentumBin[], opts: SurfaceOptions): SurfaceGeometry {
  const nTime = bins.length
  const nZone = ZONES
  const gamma = opts.colorGamma ?? 1
  const positions = new Float32Array(nTime * nZone * 3)
  const colors = new Float32Array(nTime * nZone * 3)

  for (let i = 0; i < nTime; i++) {
    const bin = bins[i]
    const x = timeToX(bin.t, opts.domainMinutes, opts.timeSpan)
    for (let j = 0; j < nZone; j++) {
      const idx = (i * nZone + j) * 3
      const intensity = bin.zoneIntensities[j] ?? 0
      const z = (j / (nZone - 1) - 0.5) * opts.depthSpan
      positions[idx] = x
      positions[idx + 1] = intensity * opts.amplitude
      positions[idx + 2] = z
      const colorV =
        gamma === 1 ? intensity : Math.sign(intensity) * Math.pow(Math.abs(intensity), gamma)
      const c = momentumColor(colorV, opts.home, opts.away, opts.neutral)
      colors[idx] = c[0]
      colors[idx + 1] = c[1]
      colors[idx + 2] = c[2]
    }
  }

  // Two triangles per grid quad.
  const quads = (nTime - 1) * (nZone - 1)
  const indices = new Uint32Array(quads * 6)
  let k = 0
  for (let i = 0; i < nTime - 1; i++) {
    for (let j = 0; j < nZone - 1; j++) {
      const a = i * nZone + j
      const b = (i + 1) * nZone + j
      const c = i * nZone + (j + 1)
      const d = (i + 1) * nZone + (j + 1)
      indices[k++] = a
      indices[k++] = b
      indices[k++] = d
      indices[k++] = a
      indices[k++] = d
      indices[k++] = c
    }
  }

  return { positions, colors, indices, nTime, nZone }
}

/**
 * Read the momentum and per-zone intensity at a continuous minute `t`, linearly
 * between the two surrounding bins. Used only for the live readout, never for
 * geometry.
 */
export function sampleAt(
  bins: MomentumBin[],
  t: number
): { momentum: number; zoneIntensities: number[] } {
  if (bins.length === 0) return { momentum: 0, zoneIntensities: [0, 0, 0] }
  if (t <= bins[0].t) return { momentum: bins[0].momentum, zoneIntensities: bins[0].zoneIntensities }
  const last = bins[bins.length - 1]
  if (t >= last.t) return { momentum: last.momentum, zoneIntensities: last.zoneIntensities }
  let hi = 1
  while (hi < bins.length && bins[hi].t < t) hi++
  const a = bins[hi - 1]
  const b = bins[hi]
  const span = b.t - a.t
  const f = span > 0 ? (t - a.t) / span : 0
  const lerp = (x: number, y: number) => x + (y - x) * f
  return {
    momentum: lerp(a.momentum, b.momentum),
    zoneIntensities: [0, 1, 2].map((z) => lerp(a.zoneIntensities[z] ?? 0, b.zoneIntensities[z] ?? 0)),
  }
}

/** The running score at minute `t`, from the last goal at or before it. */
export function scoreAt(keyEvents: MomentumKeyEvent[], t: number): { home: number; away: number } {
  let score = { home: 0, away: 0 }
  for (const e of keyEvents) {
    if (e.type !== 'goal' || !e.scoreAfter) continue
    if (e.t <= t + 1e-9) score = e.scoreAfter
    else break
  }
  return score
}

/** Which side holds the momentum at signed value `v` (dead band around zero). */
export function leaderAt(v: number, deadband = 0.04): 'home' | 'away' | 'even' {
  if (v > deadband) return 'home'
  if (v < -deadband) return 'away'
  return 'even'
}

/** Index of the strongest-magnitude zone at minute-sample `zoneIntensities`. */
export function dominantZone(zoneIntensities: number[]): number {
  let best = 0
  for (let j = 1; j < zoneIntensities.length; j++) {
    if (Math.abs(zoneIntensities[j]) > Math.abs(zoneIntensities[best])) best = j
  }
  return best
}

/** A "23′" style label from a continuous minute. */
export function minuteLabel(t: number): string {
  return `${Math.floor(t)}′`
}
