'use client'

import { useEffect, useRef } from 'react'

/**
 * The tactics-board match — the animated half of the ambient layer.
 *
 * Two chalk teams play a simulated game behind the product: circles (green
 * cast) against X-marks (white cast). The play has phases, not just passes:
 * patient circulation in build-up, through balls that lead a forward's run,
 * lofted switches and crosses that arc with a ground shadow, one-twos,
 * dribble bursts, four seconds of sprint-tempo counterattack after an
 * interception, a keeper who dives at shots, and a goal celebration — the
 * scorer wheels away, the nearest teammates converge, a ring pulses, then
 * everyone jogs back for kickoff. Drawn in the same 1600×1000 world as the
 * PitchBackdrop SVG and mapped with the same "slice" fit.
 *
 * Bounds, all load-bearing:
 * - It is DECORATION. It must never render a score, a name, a clock, or
 *   anything readable as data — a fake number in the background of a
 *   product whose whole grammar is real numbers would be a lie.
 * - One <canvas>, ~23 entities, capped at 30fps, dt clamped; rAF stops on
 *   hidden tabs by itself. Under prefers-reduced-motion it draws a single
 *   static formation and never animates.
 * - Mark alpha ≤0.25, ball ≤0.4, trail fades below the ball, pass flashes
 *   ≤0.12 — above the pitch lines, far below content. Colours are casts of
 *   the existing palette, never a new hue.
 */

const W = 1600
const H = 1000
const GOAL_TOP = 430
const GOAL_BOT = 570
const GOAL_Y = (GOAL_TOP + GOAL_BOT) / 2

/** Formation lines as [distance from own goal 0..1, lane ys, push factor]. */
const LINES: Array<{ x: number; ys: number[]; stretch: number; pull: number }> = [
  { x: 0.045, ys: [500], stretch: 0.04, pull: 0 }, // GK
  { x: 0.17, ys: [230, 410, 590, 770], stretch: 0.16, pull: 0.05 },
  { x: 0.37, ys: [290, 500, 710], stretch: 0.27, pull: 0.12 },
  { x: 0.57, ys: [250, 500, 750], stretch: 0.38, pull: 0.16 },
]

interface Player {
  team: 0 | 1
  line: number
  laneY: number
  x: number
  y: number
  phase: number
  isGK: boolean
  /** Sprint destination that overrides the formation home while it lasts. */
  run: { tx: number; ty: number; until: number } | null
}

type FlightKind = 'short' | 'through' | 'loft' | 'shot'

interface Flight {
  kind: FlightKind
  fromX: number
  fromY: number
  toX: number
  toY: number
  t: number
  dur: number
  /** Peak arc height in world px; 0 for flat balls. */
  loft: number
  /** Preferred receiver (through balls lead a specific runner). */
  receiver: Player | null
}

interface Sim {
  players: Player[]
  ball: { x: number; y: number; h: number }
  holder: Player | null
  flight: Flight | null
  possession: 0 | 1
  holdUntil: number
  /** Sprint-tempo window after an interception. */
  counterUntil: number
  /** Returns the ball to the wall-passer when a one-two is on. */
  oneTwoBack: Player | null
  shooter: Player | null
  celebration: { scorer: Player; until: number } | null
  goalPulse: { x: number; y: number; t: number } | null
  trail: Array<{ x: number; y: number }>
  flashes: Array<{ x1: number; y1: number; x2: number; y2: number; t: number }>
  time: number
}

const dirOf = (team: 0 | 1) => (team === 0 ? 1 : -1)
const clampX = (x: number) => Math.max(24, Math.min(W - 24, x))
const clampY = (y: number) => Math.max(30, Math.min(H - 30, y))
/** Attacking progress of an x for a team, 0 at own goal → 1 at the other. */
const progressOf = (team: 0 | 1, x: number) => (team === 0 ? x / W : 1 - x / W)

function homeFor(p: Player, ballX: number, ballY: number, time: number): { x: number; y: number } {
  const line = LINES[p.line]
  const dir = dirOf(p.team)
  const baseX = p.team === 0 ? line.x * W : W - line.x * W
  const adv = dir === 1 ? ballX / W - 0.5 : 0.5 - ballX / W
  let x = baseX + dir * adv * line.stretch * W
  let y = p.laneY + (ballY - p.laneY) * line.pull
  x += Math.sin(time * 0.7 + p.phase) * 9
  y += Math.sin(time * 0.9 + p.phase * 1.7) * 12
  return { x: clampX(x), y: clampY(y) }
}

function buildSim(): Sim {
  const players: Player[] = []
  for (const team of [0, 1] as const) {
    LINES.forEach((line, li) => {
      for (const laneY of line.ys) {
        players.push({
          team,
          line: li,
          laneY,
          x: team === 0 ? line.x * W : W - line.x * W,
          y: laneY,
          phase: Math.random() * Math.PI * 2,
          isGK: li === 0,
          run: null,
        })
      }
    })
  }
  return {
    players,
    ball: { x: W / 2, y: H / 2, h: 0 },
    holder: null,
    flight: null,
    possession: 0,
    holdUntil: 0.8,
    counterUntil: 0,
    oneTwoBack: null,
    shooter: null,
    celebration: null,
    goalPulse: null,
    trail: [],
    flashes: [],
    time: 0,
  }
}

function nearest(players: Player[], team: 0 | 1, x: number, y: number, excludeGK = false): Player {
  let best: Player = players[0]
  let bestD = Infinity
  for (const p of players) {
    if (p.team !== team || (excludeGK && p.isGK)) continue
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

function teammates(s: Sim, of: Player): Player[] {
  return s.players.filter((p) => p.team === of.team && p !== of && !p.isGK)
}

function kickoff(s: Sim, toTeam: 0 | 1) {
  s.ball.x = W / 2
  s.ball.y = H / 2
  s.ball.h = 0
  s.flight = null
  s.trail = []
  s.possession = toTeam
  s.counterUntil = 0
  s.oneTwoBack = null
  s.shooter = null
  for (const p of s.players) p.run = null
  s.holder = nearest(s.players, toTeam, W / 2, H / 2, true)
  s.holdUntil = s.time + 1.1
}

function launch(s: Sim, kind: FlightKind, toX: number, toY: number, receiver: Player | null) {
  const counter = s.time < s.counterUntil
  const speed =
    kind === 'shot' ? 1150 : kind === 'through' ? 780 : kind === 'loft' ? 470 : 620
  const boosted = counter && kind !== 'shot' ? speed * 1.25 : speed
  const d = Math.hypot(toX - s.ball.x, toY - s.ball.y)
  s.flight = {
    kind,
    fromX: s.ball.x,
    fromY: s.ball.y,
    toX,
    toY,
    t: 0,
    dur: Math.max(0.28, d / boosted),
    loft: kind === 'loft' ? Math.min(90, 30 + d * 0.09) : 0,
    receiver,
  }
  if (kind === 'through' || kind === 'loft') {
    s.flashes.push({ x1: s.ball.x, y1: s.ball.y, x2: toX, y2: toY, t: 0 })
    if (s.flashes.length > 3) s.flashes.shift()
  }
  s.holder = null
}

/** Send a forward darting beyond the last line, and say who went. */
function sendRunner(s: Sim, from: Player): Player | null {
  const dir = dirOf(from.team)
  const fwds = teammates(s, from).filter((p) => p.line >= 3)
  if (!fwds.length) return null
  const runner = fwds[Math.floor(Math.random() * fwds.length)]
  runner.run = {
    tx: clampX(from.x + dir * (260 + Math.random() * 160)),
    ty: clampY(runner.y + (Math.random() - 0.5) * 180),
    until: s.time + 1.6,
  }
  return runner
}

function decide(s: Sim, holder: Player) {
  const dir = dirOf(holder.team)
  const counter = s.time < s.counterUntil
  const progress = progressOf(holder.team, s.ball.x)
  const wide = holder.y < 300 || holder.y > 700

  // A one-two's return leg fires before anything else.
  if (s.oneTwoBack && s.oneTwoBack.team === holder.team && s.oneTwoBack !== holder) {
    const back = s.oneTwoBack
    s.oneTwoBack = null
    const lead = back.run ? { x: back.run.tx, y: back.run.ty } : { x: back.x + dir * 90, y: back.y }
    launch(s, 'through', clampX(lead.x), clampY(lead.y), back)
    return
  }

  // Counterattack: hit the most advanced teammate, fast and direct.
  if (counter) {
    let target: Player | null = null
    let bestX = -Infinity
    for (const p of teammates(s, holder)) {
      const fwd = dir * p.x
      if (fwd > bestX) {
        bestX = fwd
        target = p
      }
    }
    if (target && dir * (target.x - holder.x) > 60) {
      sendRunner(s, holder)
      launch(s, 'through', clampX(target.x + dir * 70), target.y, target)
      return
    }
  }

  if (progress > 0.68) {
    // Final third. Wide + deep → cross to the far post; central → through
    // ball behind the line, or shoot.
    if (wide && progress > 0.74 && Math.random() < 0.6) {
      const runner = sendRunner(s, holder)
      const targetY = holder.y < H / 2 ? GOAL_Y + 60 + Math.random() * 60 : GOAL_Y - 60 - Math.random() * 60
      const targetX = dir === 1 ? W - 120 : 120
      launch(s, 'loft', targetX, clampY(targetY), runner)
      return
    }
    if (Math.random() < 0.3) {
      const runner = sendRunner(s, holder)
      if (runner?.run) {
        launch(s, 'through', runner.run.tx, runner.run.ty, runner)
        return
      }
    }
    if (Math.random() < 0.55) {
      s.shooter = holder
      const gx = dir === 1 ? W - 34 : 34
      const gy = GOAL_TOP + 20 + Math.random() * (GOAL_BOT - GOAL_TOP - 40)
      launch(s, 'shot', gx, gy, null)
      return
    }
  }

  // Build-up variety: one-twos, long switches, dribble bursts, short passes.
  const r = Math.random()
  if (r < 0.15) {
    // One-two: wall pass to a close teammate, then sprint for the return.
    let wall: Player | null = null
    let bestD = Infinity
    for (const p of teammates(s, holder)) {
      const d = Math.hypot(p.x - holder.x, p.y - holder.y)
      if (d > 60 && d < 260 && d < bestD) {
        bestD = d
        wall = p
      }
    }
    if (wall) {
      holder.run = {
        tx: clampX(holder.x + dir * 180),
        ty: clampY(holder.y + (Math.random() - 0.5) * 80),
        until: s.time + 1.4,
      }
      s.oneTwoBack = holder
      launch(s, 'short', wall.x, wall.y, wall)
      return
    }
  }
  if (r < 0.27) {
    // Switch of play: the lofted diagonal to the opposite flank.
    let far: Player | null = null
    let bestDy = 220
    for (const p of teammates(s, holder)) {
      const dy = Math.abs(p.y - holder.y)
      if (dy > bestDy && dir * (p.x - holder.x) > -80) {
        bestDy = dy
        far = p
      }
    }
    if (far) {
      launch(s, 'loft', far.x, far.y, far)
      return
    }
  }
  if (r < 0.45) {
    // Dribble burst: carry it forward at pace and decide again.
    holder.run = {
      tx: clampX(holder.x + dir * (120 + Math.random() * 90)),
      ty: clampY(holder.y + (Math.random() - 0.5) * 110),
      until: s.time + 0.8,
    }
    s.holdUntil = s.time + 0.8
    return
  }

  // Plain forward-biased pass.
  let best: Player | null = null
  let bestScore = -Infinity
  for (const p of teammates(s, holder)) {
    const forward = dir * (p.x - holder.x)
    const dist = Math.hypot(p.x - holder.x, p.y - holder.y)
    const score = forward + Math.random() * 260 - dist * 0.2
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  const to = best ?? nearest(s.players, holder.team, holder.x, holder.y, true)
  launch(s, 'short', to.x, to.y, to)
}

function tick(s: Sim, dt: number) {
  s.time += dt
  const { ball } = s
  const counter = s.time < s.counterUntil
  const defending = (s.possession === 0 ? 1 : 0) as 0 | 1

  for (const f of s.flashes) f.t += dt
  s.flashes = s.flashes.filter((f) => f.t < 0.5)

  // Movement. Runs beat pressing beats formation; counters sprint.
  const presser = nearest(s.players, defending, ball.x, ball.y, true)
  const shotIncoming = s.flight?.kind === 'shot' ? s.flight : null
  for (const p of s.players) {
    if (p.run && s.time > p.run.until) p.run = null
    let tx: number
    let ty: number
    let k = dt * 2.2
    if (s.celebration) {
      const c = s.celebration
      if (p === c.scorer) {
        // Wheel away toward the near corner.
        tx = c.scorer.x + dirOf(p.team) * 40
        ty = p.y < H / 2 ? Math.max(90, p.y - 160) : Math.min(H - 90, p.y + 160)
        k = dt * 3.2
      } else if (p.team === c.scorer.team && Math.hypot(p.x - c.scorer.x, p.y - c.scorer.y) < 420) {
        tx = c.scorer.x + (Math.random() - 0.5) * 30
        ty = c.scorer.y + (Math.random() - 0.5) * 30
        k = dt * 3.0
      } else {
        const home = homeFor(p, W / 2, H / 2, s.time)
        tx = home.x
        ty = home.y
      }
    } else if (shotIncoming && p.isGK && p.team === defending) {
      // The dive: attack the ball's line, hard.
      tx = shotIncoming.toX + dirOf(p.team) * 26
      ty = shotIncoming.toY
      k = dt * 5.2
    } else if (p.run) {
      tx = p.run.tx
      ty = p.run.ty
      k = dt * 3.6
    } else if (p === presser) {
      tx = ball.x - dirOf(p.team) * 26
      ty = ball.y
      k = dt * (counter ? 2.6 : 1.8)
    } else {
      const home = homeFor(p, ball.x, ball.y, s.time)
      tx = home.x
      ty = home.y
      if (counter && p.team === s.possession && p.line >= 2) k = dt * 3.2
    }
    const kk = Math.min(1, k)
    p.x += (tx - p.x) * kk
    p.y += (ty - p.y) * kk
  }

  if (s.goalPulse) {
    s.goalPulse.t += dt
    if (s.goalPulse.t > 2.1) {
      const conceded = (s.goalPulse.x < W / 2 ? 0 : 1) as 0 | 1
      s.goalPulse = null
      s.celebration = null
      kickoff(s, conceded)
    }
    return
  }

  if (s.flight) {
    const f = s.flight
    f.t += dt
    const u = Math.min(1, f.t / f.dur)
    const e = 1 - (1 - u) * (1 - u)
    ball.x = f.fromX + (f.toX - f.fromX) * e
    ball.y = f.fromY + (f.toY - f.fromY) * e
    ball.h = f.loft * Math.sin(Math.PI * u)
    s.trail.push({ x: ball.x, y: ball.y - ball.h })
    if (s.trail.length > 9) s.trail.shift()
    // Flat balls can be cut out at midflight — lofted ones sail over.
    if (f.kind === 'short' && u > 0.45 && u < 0.55 && Math.random() < 0.05) {
      s.possession = defending
      s.counterUntil = s.time + 4
      s.oneTwoBack = null
      s.holder = nearest(s.players, s.possession, ball.x, ball.y, true)
      s.flight = null
      ball.h = 0
      s.holdUntil = s.time + 0.35
      return
    }
    if (u >= 1) {
      ball.h = 0
      if (f.kind === 'shot') {
        const inMouth = ball.y > GOAL_TOP - 14 && ball.y < GOAL_BOT + 14
        const scored = inMouth && Math.random() < 0.42
        if (scored && s.shooter) {
          s.goalPulse = { x: f.toX < W / 2 ? 48 : W - 48, y: GOAL_Y, t: 0 }
          s.celebration = { scorer: s.shooter, until: s.time + 2.0 }
          s.flight = null
          s.holder = null
        } else {
          // The keeper got there — play restarts from their hands.
          s.possession = defending
          s.counterUntil = s.time + 3
          s.oneTwoBack = null
          s.holder = nearest(s.players, defending, ball.x, ball.y)
          s.flight = null
          s.holdUntil = s.time + 0.9
        }
        s.shooter = null
      } else {
        const catcher = f.receiver ?? nearest(s.players, s.possession, ball.x, ball.y)
        s.holder = catcher
        s.flight = null
        // A first-time finish: met a cross near goal → shoot immediately.
        const prog = progressOf(catcher.team, catcher.x)
        s.holdUntil =
          f.kind === 'loft' && prog > 0.78
            ? s.time + 0.12
            : s.time + (counter ? 0.2 : 0.35 + Math.random() * 0.7)
      }
    }
    return
  }

  if (s.holder) {
    const dir = dirOf(s.holder.team)
    ball.x = s.holder.x + dir * 14
    ball.y = s.holder.y
    s.trail.push({ x: ball.x, y: ball.y })
    if (s.trail.length > 9) s.trail.shift()
    if (s.time >= s.holdUntil) decide(s, s.holder)
    return
  }

  kickoff(s, s.possession)
}

function draw(ctx: CanvasRenderingContext2D, s: Sim) {
  ctx.clearRect(-W, -H, W * 3, H * 3)

  for (const f of s.flashes) {
    const a = 0.12 * (1 - f.t / 0.5)
    ctx.strokeStyle = `rgba(255, 255, 255, ${a})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(f.x1, f.y1)
    ctx.lineTo(f.x2, f.y2)
    ctx.stroke()
  }

  for (const p of s.players) {
    if (p.team === 0) {
      ctx.strokeStyle = 'rgba(120, 200, 110, 0.22)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
      ctx.lineWidth = 1.6
      const r = 5.5
      ctx.beginPath()
      ctx.moveTo(p.x - r, p.y - r)
      ctx.lineTo(p.x + r, p.y + r)
      ctx.moveTo(p.x + r, p.y - r)
      ctx.lineTo(p.x - r, p.y + r)
      ctx.stroke()
    }
  }

  // Trail first, then the ball on top of it.
  s.trail.forEach((t, i) => {
    const a = 0.2 * ((i + 1) / s.trail.length)
    ctx.fillStyle = `rgba(255, 255, 255, ${a})`
    ctx.beginPath()
    ctx.arc(t.x, t.y, 1.6, 0, Math.PI * 2)
    ctx.fill()
  })

  if (s.ball.h > 8) {
    // Ground shadow under a lofted ball.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)'
    ctx.beginPath()
    ctx.arc(s.ball.x, s.ball.y, 2.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.38)'
  ctx.beginPath()
  ctx.arc(s.ball.x, s.ball.y - s.ball.h, 3.4 + s.ball.h * 0.02, 0, Math.PI * 2)
  ctx.fill()

  if (s.goalPulse) {
    const u = Math.min(1, s.goalPulse.t / 1.2)
    ctx.strokeStyle = `rgba(120, 200, 110, ${0.24 * (1 - u)})`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(s.goalPulse.x, s.goalPulse.y, 12 + u * 90, 0, Math.PI * 2)
    ctx.stroke()
  }
}

export function PitchMatchAnimation() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return // jsdom and very old browsers: quietly render nothing

    const sim = buildSim()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    const fit = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1)
      const cw = canvas.clientWidth
      const ch = canvas.clientHeight
      canvas.width = Math.round(cw * dpr)
      canvas.height = Math.round(ch * dpr)
      // Same "slice" mapping as the SVG's preserveAspectRatio, so the game
      // runs on the drawn pitch.
      const scale = Math.max(cw / W, ch / H) * dpr
      ctx.setTransform(scale, 0, 0, scale, (cw * dpr - W * scale) / 2, (ch * dpr - H * scale) / 2)
    }
    fit()
    window.addEventListener('resize', fit)

    kickoff(sim, 0)

    let raf = 0
    let last = performance.now()
    let acc = 0
    const FRAME = 1 / 30

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      acc += dt
      if (acc >= FRAME) {
        tick(sim, acc)
        draw(ctx, sim)
        acc = 0
      }
      raf = requestAnimationFrame(loop)
    }

    if (reduced.matches) {
      // A single still of the kickoff shape — present, never moving.
      tick(sim, 0.001)
      draw(ctx, sim)
    } else {
      raf = requestAnimationFrame(loop)
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
    }
  }, [])

  return <canvas ref={canvasRef} className="pitch-backdrop__match" aria-hidden="true" />
}
