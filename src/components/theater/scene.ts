import {
  THEATER_BUCKET_MAX,
  THEATER_BUCKET_STEP,
  THEATER_DIFF_MAX,
  THEATER_DIFF_MIN,
  THEATER_DOMAIN_MAX,
  type TheaterCell,
  type TheaterData,
} from './field'
import {
  CLOCK_TICKS,
  project,
  signedArea,
  worldFromField,
  type Camera,
  type Projected,
  type Vec3,
} from './projection'

/** Axis label type — matches the app's 11px meta scale. */
const THEATER_LABEL_FONT =
  '600 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/**
 * Scene assembly + Canvas 2D painting for the win-chance landscape.
 *
 * Every counted cell becomes a solid tile: a flat top at its exact w/n height
 * plus cliff faces down to whichever neighbour is lower (or to the floor at
 * the field's edge). Nothing is smoothed between cells — the steps ARE the
 * data, exactly as the 2D river renders them as steps.
 *
 * The match path is stitched into the same depth-sorted primitive list as the
 * terrain, so a ridge standing in front of the path correctly hides it.
 */

export type RGB = [number, number, number]

export interface Palette {
  /** Home-win end of the elevation ramp. */
  home: RGB
  /** Away-win end of the ramp. */
  away: RGB
  /** The balance point of the ramp. */
  draw: RGB
  /** Card surface — the atmospheric-perspective target and label halo. */
  card: RGB
  border: RGB
  text: RGB
  textDim: RGB
}

interface Quad {
  kind: 'quad'
  pts: Projected[]
  depth: number
  fill: string
  stroke?: string
}

interface Seg {
  kind: 'seg'
  a: Projected
  b: Projected
  depth: number
}

interface Dot {
  kind: 'dot'
  at: Projected
  depth: number
  r: number
  fill: string
}

type Primitive = Quad | Seg | Dot

export interface PathHit {
  spanIndex: number
  ax: number
  ay: number
  bx: number
  by: number
}

export interface SceneResult {
  /** Screen-space path segments, for hover/tap hit-testing. */
  hits: PathHit[]
  /** Primitive count actually painted — reported by the perf probe. */
  primitives: number
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ]
}

export function rgba(c: RGB, alpha = 1): string {
  return alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
}

/**
 * Elevation ramp: away-win red at the floor, draw amber at the balance point,
 * home-win green at the ceiling — the same three tokens the 2D river's legend
 * uses, so the colours mean the identical thing on both surfaces.
 */
export function rampColor(p: number, palette: Palette): RGB {
  const hue =
    p <= 0.5 ? mix(palette.away, palette.draw, p * 2) : mix(palette.draw, palette.home, (p - 0.5) * 2)
  // Lift the value with elevation too: the three home-leading terraces are all
  // green, and only a brightness step separates them at a glance.
  return p >= 0.5
    ? mix(hue, [255, 255, 255], (p - 0.5) * 0.34)
    : mix(hue, [0, 0, 0], (0.5 - p) * 0.34)
}

/** Fixed per-face lighting so the relief reads without a normal calculation. */
const FACE_LIGHT = { top: 1, east: 0.74, west: 0.6, north: 0.52, south: 0.84 }

function shade(c: RGB, palette: Palette, light: number, haze: number): RGB {
  // Darken toward a deep neutral, then fade toward the card for aerial depth.
  const lit = mix([Math.round(c[0] * 0.28), Math.round(c[1] * 0.28), Math.round(c[2] * 0.3)], c, light)
  return mix(lit, palette.card, haze)
}

// ---------------------------------------------------------------------------
// Scene assembly
// ---------------------------------------------------------------------------

function cellX0(minute: number): number {
  return minute
}

function cellX1(minute: number): number {
  return minute >= THEATER_BUCKET_MAX ? THEATER_DOMAIN_MAX : minute + THEATER_BUCKET_STEP
}

/**
 * The terrain's own silhouette, for {@link fitCamera}: every counted tile's
 * top corners plus the floor under its viewer-facing edge, so the framing
 * hugs the relief instead of an empty bounding box.
 */
export function fieldFitPoints(data: TheaterData): Vec3[] {
  const points: Vec3[] = []
  for (const cell of data.cells) {
    const x0 = cellX0(cell.minute)
    const x1 = cellX1(cell.minute)
    const y0 = cell.diff - 0.5
    const y1 = cell.diff + 0.5
    points.push(
      worldFromField(x0, y0, cell.pHome),
      worldFromField(x1, y0, cell.pHome),
      worldFromField(x1, y1, cell.pHome),
      worldFromField(x0, y1, cell.pHome),
      // The cliff under the near edge is visible, so it has to be in frame.
      worldFromField(x0, y0, 0),
      worldFromField(x1, y0, 0)
    )
  }
  return points
}

/** Normalised depth for atmospheric haze: 0 at the near edge, 1 at the far. */
function hazeOf(depth: number, cam: Camera): number {
  const t = (depth - (cam.distance - 1.6)) / 3.2
  return t < 0 ? 0 : t > 0.85 ? 0.85 : t
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  data: TheaterData,
  cam: Camera,
  palette: Palette,
  opts: { width: number; height: number; hoveredSpan: number | null }
): SceneResult {
  const { width, height } = opts
  ctx.clearRect(0, 0, width, height)

  const byKey = new Map<string, TheaterCell>()
  for (const c of data.cells) byKey.set(`${c.diff}:${c.minute}`, c)
  const heightAt = (diff: number, minute: number): number | null => {
    const c = byKey.get(`${diff}:${minute}`)
    return c ? c.pHome : null
  }

  const prims: Primitive[] = []

  // -- terrain -------------------------------------------------------------
  for (const cell of data.cells) {
    const x0 = cellX0(cell.minute)
    const x1 = cellX1(cell.minute)
    const y0 = cell.diff - 0.5
    const y1 = cell.diff + 0.5
    const z = cell.pHome

    const top = [
      project(worldFromField(x0, y0, z), cam),
      project(worldFromField(x1, y0, z), cam),
      project(worldFromField(x1, y1, z), cam),
      project(worldFromField(x0, y1, z), cam),
    ]
    const depth = (top[0].depth + top[1].depth + top[2].depth + top[3].depth) / 4
    const haze = hazeOf(depth, cam)
    const base = rampColor(z, palette)

    prims.push({
      kind: 'quad',
      pts: top,
      depth,
      fill: rgba(shade(base, palette, FACE_LIGHT.top, haze * 0.7)),
      stroke: rgba(palette.border, 0.28),
    })

    // Cliff faces — only where the neighbour is lower or absent, so interior
    // walls are never painted and the mesh stays cheap.
    const faces: Array<{ nz: number | null; light: number; a: [number, number]; b: [number, number] }> = [
      // toward the viewer (away-leading side)
      { nz: heightAt(cell.diff - 1, cell.minute), light: FACE_LIGHT.south, a: [x0, y0], b: [x1, y0] },
      // away from the viewer (home-leading side)
      { nz: heightAt(cell.diff + 1, cell.minute), light: FACE_LIGHT.north, a: [x1, y1], b: [x0, y1] },
      // later in the match
      { nz: heightAt(cell.diff, cell.minute + THEATER_BUCKET_STEP), light: FACE_LIGHT.east, a: [x1, y0], b: [x1, y1] },
      // earlier in the match
      { nz: heightAt(cell.diff, cell.minute - THEATER_BUCKET_STEP), light: FACE_LIGHT.west, a: [x0, y1], b: [x0, y0] },
    ]
    for (const face of faces) {
      const floor = face.nz === null ? 0 : face.nz
      if (floor >= z - 1e-6) continue
      const pts = [
        project(worldFromField(face.a[0], face.a[1], z), cam),
        project(worldFromField(face.b[0], face.b[1], z), cam),
        project(worldFromField(face.b[0], face.b[1], floor), cam),
        project(worldFromField(face.a[0], face.a[1], floor), cam),
      ]
      if (signedArea(pts) <= 0) continue // back-facing
      const fd = (pts[0].depth + pts[1].depth + pts[2].depth + pts[3].depth) / 4
      prims.push({
        kind: 'quad',
        pts,
        depth: fd + 0.002, // ties break behind the top face
        fill: rgba(shade(base, palette, face.light, hazeOf(fd, cam) * 0.8)),
      })
    }
  }

  // -- the match path ------------------------------------------------------
  // Lifted a hair above the surface so it never z-fights with the tile it
  // rests on; every height is still the tile's own counted value.
  const LIFT = 0.014
  const hits: PathHit[] = []
  const pathPrims: Array<{ seg: Seg; spanIndex: number | null }> = []

  for (let i = 0; i < data.spans.length; i++) {
    const s = data.spans[i]
    const a = project(worldFromField(s.x0, s.diff, s.pHome + LIFT), cam)
    const b = project(worldFromField(s.x1, s.diff, s.pHome + LIFT), cam)
    pathPrims.push({
      seg: { kind: 'seg', a, b, depth: (a.depth + b.depth) / 2 },
      spanIndex: i,
    })
    hits.push({ spanIndex: i, ax: a.x, ay: a.y, bx: b.x, by: b.y })

    const next = data.spans[i + 1]
    if (!next) continue
    // The connector between runs: a vertical step at a five-minute mark, or a
    // slide across to the neighbouring ridge when a goal changed the score.
    const c = project(worldFromField(next.x0, next.diff, next.pHome + LIFT), cam)
    pathPrims.push({
      seg: { kind: 'seg', a: b, b: c, depth: (b.depth + c.depth) / 2 },
      spanIndex: null,
    })
  }

  for (const p of pathPrims) prims.push(p.seg)

  // -- event markers -------------------------------------------------------
  const dots: Dot[] = []
  for (const ev of data.events) {
    // Sit the marker on the path: find the run covering this instant.
    const span =
      data.spans.find((s) => ev.x >= s.x0 && ev.x < s.x1) ?? data.spans[data.spans.length - 1]
    const at = project(worldFromField(ev.x, span.diff, span.pHome + LIFT), cam)
    const tint = ev.type === 'red_card' ? palette.away : ev.team === 'home' ? palette.home : palette.away
    dots.push({ kind: 'dot', at, depth: at.depth - 0.01, r: 4.2, fill: rgba(tint) })
  }
  for (const d of dots) prims.push(d)

  // -- paint, far to near --------------------------------------------------
  prims.sort((a, b) => b.depth - a.depth)

  const pathColor = rgba(palette.text)
  for (const prim of prims) {
    if (prim.kind === 'quad') {
      ctx.beginPath()
      ctx.moveTo(prim.pts[0].x, prim.pts[0].y)
      for (let i = 1; i < prim.pts.length; i++) ctx.lineTo(prim.pts[i].x, prim.pts[i].y)
      ctx.closePath()
      ctx.fillStyle = prim.fill
      ctx.fill()
      if (prim.stroke) {
        ctx.strokeStyle = prim.stroke
        ctx.lineWidth = 0.6
        ctx.stroke()
      }
    } else if (prim.kind === 'seg') {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      // Soft halo, then a card-coloured outline, then the line itself: the
      // path stays legible over both the green ridge and the red trough.
      ctx.strokeStyle = rgba(palette.text, 0.14)
      ctx.lineWidth = 9
      ctx.beginPath()
      ctx.moveTo(prim.a.x, prim.a.y)
      ctx.lineTo(prim.b.x, prim.b.y)
      ctx.stroke()
      ctx.strokeStyle = rgba(palette.card, 0.9)
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(prim.a.x, prim.a.y)
      ctx.lineTo(prim.b.x, prim.b.y)
      ctx.stroke()
      ctx.strokeStyle = pathColor
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.moveTo(prim.a.x, prim.a.y)
      ctx.lineTo(prim.b.x, prim.b.y)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(prim.at.x, prim.at.y, prim.r + 1.6, 0, Math.PI * 2)
      ctx.fillStyle = rgba(palette.card)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(prim.at.x, prim.at.y, prim.r, 0, Math.PI * 2)
      ctx.fillStyle = prim.fill
      ctx.fill()
    }
  }

  // -- highlighted run (drawn last so the readout's subject is unmistakable) --
  if (opts.hoveredSpan !== null && data.spans[opts.hoveredSpan]) {
    const hit = hits.find((h) => h.spanIndex === opts.hoveredSpan)
    if (hit) {
      ctx.lineCap = 'round'
      ctx.strokeStyle = rgba(palette.card, 0.95)
      ctx.lineWidth = 7
      ctx.beginPath()
      ctx.moveTo(hit.ax, hit.ay)
      ctx.lineTo(hit.bx, hit.by)
      ctx.stroke()
      ctx.strokeStyle = pathColor
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(hit.ax, hit.ay)
      ctx.lineTo(hit.bx, hit.by)
      ctx.stroke()
    }
  }

  drawAxes(ctx, cam, palette, data)

  return { hits, primitives: prims.length }
}

// ---------------------------------------------------------------------------
// Axes — drawn last, with a halo, so they stay readable over the terrain
// ---------------------------------------------------------------------------

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  palette: Palette,
  align: CanvasTextAlign,
  dim = true
) {
  ctx.font = THEATER_LABEL_FONT
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 3.5
  ctx.lineJoin = 'round'
  ctx.strokeStyle = rgba(palette.card, 0.92)
  ctx.strokeText(text, x, y)
  ctx.fillStyle = rgba(dim ? palette.textDim : palette.text)
  ctx.fillText(text, x, y)
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  palette: Palette,
  data: TheaterData
) {
  // Clock, along the near edge of the field.
  const nearDiff = THEATER_DIFF_MIN - 0.5
  for (const m of CLOCK_TICKS) {
    const p = project(worldFromField(m, nearDiff, 0), cam)
    label(ctx, m === 45 ? 'HT' : m === THEATER_BUCKET_MAX ? "90'" : `${m}'`, p.x, p.y + 13, palette, 'center')
  }

  // Score difference, in a screen-space gutter left of everything the terrain
  // occupies: a row's tag can then never sit on a tile it does not describe,
  // whatever the orbit angle is.
  const rowStart = new Map<number, TheaterCell>()
  for (const cell of data.cells) {
    const seen = rowStart.get(cell.diff)
    if (!seen || cell.minute < seen.minute) rowStart.set(cell.diff, cell)
  }
  let gutterX = Infinity
  const rows: Array<{ diff: number; y: number }> = []
  for (const [diff, cell] of rowStart) {
    const p = project(worldFromField(cell.minute, diff - 0.5, cell.pHome), cam)
    gutterX = Math.min(gutterX, p.x)
    rows.push({ diff, y: p.y })
  }
  if (Number.isFinite(gutterX)) {
    for (const row of rows) {
      const text = row.diff === 0 ? 'level' : row.diff > 0 ? `+${row.diff}` : `−${Math.abs(row.diff)}`
      label(ctx, text, gutterX - 8, row.y, palette, 'right')
    }
  }

  // Win-chance ruler, standing off the near-right corner where its zero mark
  // sits level with the floor the terrain rests on.
  const rulerMinute = THEATER_DOMAIN_MAX
  const rulerDiff = THEATER_DIFF_MIN - 0.9
  const top = project(worldFromField(rulerMinute, rulerDiff, 1), cam)
  const bottom = project(worldFromField(rulerMinute, rulerDiff, 0), cam)
  ctx.strokeStyle = rgba(palette.border, 1)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(bottom.x, bottom.y)
  ctx.lineTo(top.x, top.y)
  ctx.stroke()
  for (const v of [0, 0.5, 1]) {
    const p = project(worldFromField(rulerMinute, rulerDiff, v), cam)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x + 4, p.y)
    ctx.stroke()
    label(ctx, `${Math.round(v * 100)}%`, p.x + 8, p.y, palette, 'left')
  }
}
