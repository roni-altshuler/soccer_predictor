import { THEATER_BUCKET_MAX, THEATER_DIFF_MAX, THEATER_DOMAIN_MAX } from './field'

/**
 * A tiny hand-rolled 3D pipeline for the win-chance landscape.
 *
 * Deliberately not a library: the scene is ~250 convex quads and a polyline,
 * so a yaw/pitch rotation, a one-over-depth perspective divide and a
 * back-to-front sort do the whole job in a few hundred lines of Canvas 2D —
 * no WebGL context to lose, no shader to compile, no dependency to add, and
 * the same code path on every browser and in tests.
 *
 * Conventions:
 * - world X runs along the match clock (kickoff left, full time right),
 * - world Y runs along the score difference (away-leading near the viewer,
 *   home-leading away from them, so the tall home ridge never occludes),
 * - world Z is the win chance, 0..1 mapped onto [0, SPAN_Z].
 *
 * The camera orbits the origin at `distance`, yawing about Z and pitching
 * down toward the field. Everything here is pure: same inputs, same pixels.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Projected {
  x: number
  y: number
  /** Distance along the view axis — larger is farther. Used for painter sorting. */
  depth: number
}

export interface Camera {
  /** Rotation about the vertical axis, radians. 0 looks straight down the clock. */
  yaw: number
  /** Downward tilt, radians. 0 is edge-on, PI/2 is a plan view. */
  pitch: number
  /** Camera distance from the origin, in world units. */
  distance: number
  /** Focal length in pixels — the perspective strength. */
  focal: number
  /** Uniform screen-space scale applied after the perspective divide. */
  zoom: number
  /** Screen-space origin, in pixels. */
  cx: number
  cy: number
}

/** World-space extent of the field box. */
export const SPAN_X = 3.34
export const SPAN_Y = 1.42
export const SPAN_Z = 0.94

/** Yaw is clamped so the axis labels never end up behind the terrain. */
export const YAW_BASE = -0.2
export const YAW_RANGE = 0.4
export const PITCH_MIN = 0.24
export const PITCH_MAX = 1.0
export const PITCH_BASE = 0.55

/**
 * A long lens: the camera sits well back so the perspective is gentle. Strong
 * perspective made the near row balloon over the far ones, which reads as a
 * distortion of the data rather than depth.
 */
export const CAMERA_DISTANCE = 7.2
export const CAMERA_FOCAL = 1000

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Map a field coordinate onto the world box. `minute` is a chart minute on the
 * river's axis (0..{@link THEATER_DOMAIN_MAX}), `diff` a score difference
 * (fractional at tile edges), `p` a probability in [0, 1].
 */
export function worldFromField(minute: number, diff: number, p: number): Vec3 {
  return {
    x: (minute / THEATER_DOMAIN_MAX - 0.5) * SPAN_X,
    y: (diff / THEATER_DIFF_MAX) * SPAN_Y,
    z: p * SPAN_Z,
  }
}

/**
 * Rotate by yaw about Z, tilt by pitch, then divide by depth. Screen Y grows
 * downward, so the vertical term is subtracted.
 */
export function project(p: Vec3, cam: Camera): Projected {
  const cosYaw = Math.cos(cam.yaw)
  const sinYaw = Math.sin(cam.yaw)
  const rx = p.x * cosYaw - p.y * sinYaw
  const ry = p.x * sinYaw + p.y * cosYaw

  const cosPitch = Math.cos(cam.pitch)
  const sinPitch = Math.sin(cam.pitch)
  // Camera sits below-and-back along -Y, lifted by pitch, looking at the origin.
  const depth = ry * cosPitch - p.z * sinPitch + cam.distance
  const up = ry * sinPitch + p.z * cosPitch

  // Guard the degenerate case (a point at/behind the eye) rather than emitting
  // Infinity into a canvas path.
  const safeDepth = depth > 0.05 ? depth : 0.05
  const s = (cam.focal / safeDepth) * cam.zoom
  return { x: cam.cx + rx * s, y: cam.cy - up * s, depth }
}

/**
 * Signed area of a projected polygon (positive = counter-clockwise on screen).
 * Used to cull the box faces that point away from the camera.
 */
export function signedArea(points: Projected[]): number {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

/**
 * Shortest distance from a point to a screen-space segment — the path's
 * hit-test. Returns the distance in pixels.
 */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1)
  const qx = ax + t * dx
  const qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

/** Pixels reserved around the field for the axis labels. */
export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export const DEFAULT_INSETS: Insets = { top: 10, right: 46, bottom: 22, left: 46 }

/** The corners of the field's bounding box, in field coordinates. */
const BOX_CORNERS: Array<[number, number, number]> = (() => {
  const out: Array<[number, number, number]> = []
  for (const m of [0, THEATER_DOMAIN_MAX]) {
    for (const d of [-THEATER_DIFF_MAX - 0.5, THEATER_DIFF_MAX + 0.5]) {
      for (const z of [0, 1]) out.push([m, d, z])
    }
  }
  return out
})()

/** The default fit target: the corners of the whole field box. */
export const BOX_FIT_POINTS: Vec3[] = BOX_CORNERS.map(([m, d, z]) => worldFromField(m, d, z))

/**
 * Fit a point cloud into the viewport at the current orbit angle.
 *
 * Two passes: project the points with a unit zoom, then scale and translate
 * so their screen bounds land inside the insets. Callers pass the terrain's
 * own silhouette rather than the bounding box, because the box's empty
 * corners — a floor tile at the ceiling's height, a ridge top over the
 * trough — would otherwise reserve a third of the frame for nothing. The
 * silhouette is identical for every match in a universe, so two landscapes
 * still frame the same way and stay comparable.
 */
export function fitCamera(
  width: number,
  height: number,
  yaw: number,
  pitch: number,
  insets: Insets = DEFAULT_INSETS,
  points: Vec3[] = BOX_FIT_POINTS
): Camera {
  const base: Camera = {
    yaw,
    pitch,
    distance: CAMERA_DISTANCE,
    focal: CAMERA_FOCAL,
    zoom: 1,
    cx: 0,
    cy: 0,
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of points) {
    const p = project(point, base)
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  const availW = Math.max(1, width - insets.left - insets.right)
  const availH = Math.max(1, height - insets.top - insets.bottom)
  const boxW = Math.max(1e-6, maxX - minX)
  const boxH = Math.max(1e-6, maxY - minY)
  const zoom = Math.min(availW / boxW, availH / boxH)

  return {
    ...base,
    zoom,
    cx: insets.left + availW / 2 - ((minX + maxX) / 2) * zoom,
    cy: insets.top + availH / 2 - ((minY + maxY) / 2) * zoom,
  }
}

/** Chart minutes at which the clock axis is labelled. */
export const CLOCK_TICKS = [0, 15, 30, 45, 60, 75, THEATER_BUCKET_MAX]
