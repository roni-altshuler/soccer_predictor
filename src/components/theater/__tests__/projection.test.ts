/**
 * Projection tests — determinism, the axis conventions the scene relies on
 * (clock left-to-right, home-leading ridge at the back, taller is higher),
 * back-face culling, and the hit-test metric.
 */
import { THEATER_DOMAIN_MAX } from '../field'
import {
  CAMERA_DISTANCE,
  CAMERA_FOCAL,
  DEFAULT_INSETS,
  PITCH_BASE,
  SPAN_X,
  SPAN_Y,
  SPAN_Z,
  YAW_BASE,
  clamp,
  distanceToSegment,
  fitCamera,
  project,
  signedArea,
  worldFromField,
  type Camera,
} from '../projection'

const CAM: Camera = {
  yaw: 0,
  pitch: 0.5,
  distance: CAMERA_DISTANCE,
  focal: CAMERA_FOCAL,
  zoom: 1,
  cx: 400,
  cy: 200,
}

describe('worldFromField', () => {
  it('maps the field box onto the world box', () => {
    expect(worldFromField(0, 0, 0)).toEqual({ x: -SPAN_X / 2, y: 0, z: 0 })
    expect(worldFromField(THEATER_DOMAIN_MAX, 3, 1)).toEqual({
      x: SPAN_X / 2,
      y: SPAN_Y,
      z: SPAN_Z,
    })
    expect(worldFromField(THEATER_DOMAIN_MAX / 2, -3, 0.5).y).toBeCloseTo(-SPAN_Y, 12)
  })
})

describe('project', () => {
  it('is deterministic', () => {
    const a = project(worldFromField(45, 1, 0.62), CAM)
    const b = project(worldFromField(45, 1, 0.62), CAM)
    expect(a).toEqual(b)
    // Pinned so a refactor of the camera maths is a visible diff, not a silent one.
    expect(a.x).toBeCloseTo(388.0186780, 6)
    expect(a.y).toBeCloseTo(99.3477057, 6)
    expect(a.depth).toBeCloseTo(7.3359799, 6)
  })

  it('runs the clock left to right', () => {
    const kickoff = project(worldFromField(0, 0, 0), CAM)
    const fullTime = project(worldFromField(90, 0, 0), CAM)
    expect(kickoff.x).toBeLessThan(fullTime.x)
  })

  it('puts the home-leading ridge farther away and higher on screen', () => {
    const homeSide = project(worldFromField(45, 3, 0), CAM)
    const awaySide = project(worldFromField(45, -3, 0), CAM)
    expect(homeSide.depth).toBeGreaterThan(awaySide.depth)
    expect(homeSide.y).toBeLessThan(awaySide.y)
  })

  it('draws a taller cell higher on screen and nearer the eye', () => {
    const low = project(worldFromField(45, 0, 0.1), CAM)
    const high = project(worldFromField(45, 0, 0.9), CAM)
    expect(high.y).toBeLessThan(low.y)
    expect(high.depth).toBeLessThan(low.depth)
  })

  it('yaws about the vertical axis without moving the origin', () => {
    const yawed: Camera = { ...CAM, yaw: 0.4 }
    const origin = project({ x: 0, y: 0, z: 0 }, yawed)
    expect(origin.x).toBeCloseTo(CAM.cx, 9)
    expect(origin.depth).toBeCloseTo(CAM.distance, 9)
  })

  it('never divides by a non-positive depth', () => {
    const behind = project({ x: 1, y: -50, z: 0 }, CAM)
    expect(Number.isFinite(behind.x)).toBe(true)
    expect(Number.isFinite(behind.y)).toBe(true)
  })
})

describe('signedArea', () => {
  it('separates front faces from back faces by winding', () => {
    const front = [
      { x: 0, y: 0, depth: 1 },
      { x: 10, y: 0, depth: 1 },
      { x: 10, y: 10, depth: 1 },
      { x: 0, y: 10, depth: 1 },
    ]
    expect(signedArea(front)).toBe(100)
    expect(signedArea([...front].reverse())).toBe(-100)
  })
})

describe('distanceToSegment', () => {
  it('measures perpendicular distance inside the segment', () => {
    expect(distanceToSegment(5, 4, 0, 0, 10, 0)).toBeCloseTo(4, 9)
  })

  it('clamps to the endpoints outside the segment', () => {
    expect(distanceToSegment(-3, 4, 0, 0, 10, 0)).toBeCloseTo(5, 9)
    expect(distanceToSegment(13, -4, 0, 0, 10, 0)).toBeCloseTo(5, 9)
  })

  it('handles a degenerate segment', () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 9)
  })
})

describe('fitCamera', () => {
  const corners = () => {
    const out: Array<[number, number, number]> = []
    for (const m of [0, THEATER_DOMAIN_MAX]) {
      for (const d of [-3.5, 3.5]) {
        for (const z of [0, 1]) out.push([m, d, z])
      }
    }
    return out
  }

  it.each([
    ['desktop', 1200, 380],
    ['mobile', 360, 300],
    ['square', 500, 500],
  ])('fits the whole field inside %s without overflowing the insets', (_label, w, h) => {
    const cam = fitCamera(w, h, YAW_BASE, PITCH_BASE)
    const pts = corners().map(([m, d, z]) => project(worldFromField(m, d, z), cam))
    expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThanOrEqual(DEFAULT_INSETS.left - 0.5)
    expect(Math.max(...pts.map((p) => p.x))).toBeLessThanOrEqual(w - DEFAULT_INSETS.right + 0.5)
    expect(Math.min(...pts.map((p) => p.y))).toBeGreaterThanOrEqual(DEFAULT_INSETS.top - 0.5)
    expect(Math.max(...pts.map((p) => p.y))).toBeLessThanOrEqual(h - DEFAULT_INSETS.bottom + 0.5)
  })

  it('keeps the orbit angles it was handed', () => {
    const cam = fitCamera(1200, 380, YAW_BASE, PITCH_BASE)
    expect(cam.yaw).toBe(YAW_BASE)
    expect(cam.pitch).toBe(PITCH_BASE)
    expect(cam.zoom).toBeGreaterThan(0)
  })

  it('is deterministic for a given viewport and angle', () => {
    expect(fitCamera(900, 400, YAW_BASE, PITCH_BASE)).toEqual(
      fitCamera(900, 400, YAW_BASE, PITCH_BASE)
    )
  })
})

describe('clamp', () => {
  it('bounds both ways', () => {
    expect(clamp(-1, 0, 1)).toBe(0)
    expect(clamp(2, 0, 1)).toBe(1)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})
