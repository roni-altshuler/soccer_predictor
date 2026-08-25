'use client'

import { useEffect, useRef } from 'react'

/**
 * The tactics-board match — the animated half of the ambient layer.
 *
 * Two chalk teams play a simulated game behind the product: circles (green
 * cast) against X-marks (white cast), a ball that is passed, carried,
 * intercepted and shot, lines that push up in possession and compress out
 * of it, and a quiet ring pulse when a goal goes in before everything
 * resets to kickoff. It is drawn in the same 1600×1000 world as the
 * PitchBackdrop SVG and mapped with the same "slice" fit, so the game runs
 * on the drawn pitch.
 *
 * Bounds, all load-bearing:
 * - It is DECORATION. It must never render a score, a name, a clock, or
 *   anything readable as data — a fake number in the background of a
 *   product whose whole grammar is real numbers would be a lie.
 * - One <canvas>, ~23 entities, capped at 30fps, dt clamped; rAF stops on
 *   hidden tabs by itself. Under prefers-reduced-motion it draws a single
 *   static formation and never animates.
 * - Mark alpha stays ≤0.25 and the ball ≤0.4 — above the pitch lines,
 *   far below content. Colours are casts of the existing palette, never a
 *   new hue.
 */

const W = 1600
const H = 1000
const GOAL_TOP = 430
const GOAL_BOT = 570

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
}

interface Sim {
  players: Player[]
  ball: { x: number; y: number }
  /** 1 → team 0 attacks +x; team 1 mirrors. */
  holder: Player | null
  flight: { fromX: number; fromY: number; toX: number; toY: number; t: number; dur: number; shot: boolean } | null
  possession: 0 | 1
  holdUntil: number
  goalPulse: { x: number; y: number; t: number } | null
  kickoffAt: number
  time: number
}

const dirOf = (team: 0 | 1) => (team === 0 ? 1 : -1)

function homeFor(p: Player, ballX: number, ballY: number, time: number): { x: number; y: number } {
  const line = LINES[p.line]
  const dir = dirOf(p.team)
  const baseX = p.team === 0 ? line.x * W : W - line.x * W
  const adv = dir === 1 ? ballX / W - 0.5 : 0.5 - ballX / W
  let x = baseX + dir * adv * line.stretch * W
  let y = p.laneY + (ballY - p.laneY) * line.pull
  x += Math.sin(time * 0.7 + p.phase) * 9
  y += Math.sin(time * 0.9 + p.phase * 1.7) * 12
  return { x: Math.max(24, Math.min(W - 24, x)), y: Math.max(30, Math.min(H - 30, y)) }
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
        })
      }
    })
  }
  return {
    players,
    ball: { x: W / 2, y: H / 2 },
    holder: null,
    flight: null,
    possession: 0,
    holdUntil: 0.8,
    goalPulse: null,
    kickoffAt: 0,
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

function pickPass(s: Sim, holder: Player): Player {
  const dir = dirOf(holder.team)
  let best: Player | null = null
  let bestScore = -Infinity
  for (const p of s.players) {
    if (p.team !== holder.team || p === holder || p.isGK) continue
    const forward = dir * (p.x - holder.x)
    const dist = Math.hypot(p.x - holder.x, p.y - holder.y)
    const score = forward + Math.random() * 260 - dist * 0.2
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return best ?? nearest(s.players, holder.team, holder.x, holder.y, true)
}

function kickoff(s: Sim, toTeam: 0 | 1) {
  s.ball.x = W / 2
  s.ball.y = H / 2
  s.flight = null
  s.possession = toTeam
  s.holder = nearest(s.players, toTeam, W / 2, H / 2, true)
  s.holdUntil = s.time + 1.1
}

function startPass(s: Sim, from: Player, toX: number, toY: number, shot: boolean) {
  const speed = shot ? 920 : 540
  const d = Math.hypot(toX - from.x, toY - from.y)
  s.flight = { fromX: s.ball.x, fromY: s.ball.y, toX, toY, t: 0, dur: Math.max(0.3, d / speed), shot }
  s.holder = null
}

function tick(s: Sim, dt: number) {
  s.time += dt
  const { ball } = s

  // Players drift toward their phase-dependent homes; the nearest defender
  // presses the ball instead.
  const presser = nearest(s.players, s.possession === 0 ? 1 : 0, ball.x, ball.y, true)
  for (const p of s.players) {
    const home = homeFor(p, ball.x, ball.y, s.time)
    let tx = home.x
    let ty = home.y
    if (p === presser && !s.goalPulse) {
      tx = ball.x - dirOf(p.team) * 26
      ty = ball.y
    }
    const k = Math.min(1, dt * (p === presser ? 1.6 : 2.2))
    p.x += (tx - p.x) * k
    p.y += (ty - p.y) * k
  }

  if (s.goalPulse) {
    s.goalPulse.t += dt
    if (s.goalPulse.t > 1.5) {
      const conceded = s.goalPulse.x < W / 2 ? 0 : 1
      s.goalPulse = null
      kickoff(s, conceded)
    }
    return
  }

  if (s.flight) {
    const f = s.flight
    f.t += dt
    const u = Math.min(1, f.t / f.dur)
    const e = 1 - (1 - u) * (1 - u) // ease-out
    ball.x = f.fromX + (f.toX - f.fromX) * e
    ball.y = f.fromY + (f.toY - f.fromY) * e
    // A pass can be cut out at midflight.
    if (!f.shot && u > 0.45 && u < 0.55 && Math.random() < 0.045) {
      s.possession = s.possession === 0 ? 1 : 0
      s.holder = nearest(s.players, s.possession, ball.x, ball.y, true)
      s.flight = null
      s.holdUntil = s.time + 0.5
      return
    }
    if (u >= 1) {
      if (f.shot) {
        const attackers = s.possession
        const inMouth = ball.y > GOAL_TOP - 14 && ball.y < GOAL_BOT + 14
        const scored = inMouth && Math.random() < 0.4
        if (scored) {
          // Pulse a touch inside the touchline: the slice fit crops up to
          // ~40px off each end on common aspect ratios, and a goal that
          // celebrates off-screen may as well not have happened.
          s.goalPulse = { x: f.toX < W / 2 ? 48 : W - 48, y: (GOAL_TOP + GOAL_BOT) / 2, t: 0 }
          s.flight = null
          s.holder = null
        } else {
          // Saved or wide — keeper gathers, possession flips.
          const newTeam = attackers === 0 ? 1 : 0
          s.possession = newTeam
          s.holder = nearest(s.players, newTeam, ball.x, ball.y)
          s.flight = null
          s.holdUntil = s.time + 0.9
        }
      } else {
        s.holder = nearest(s.players, s.possession, ball.x, ball.y)
        s.flight = null
        s.holdUntil = s.time + 0.35 + Math.random() * 0.7
      }
    }
    return
  }

  if (s.holder) {
    // Carry: the ball rides just ahead of the holder while they dribble.
    const dir = dirOf(s.holder.team)
    ball.x = s.holder.x + dir * 14
    ball.y = s.holder.y
    if (s.time >= s.holdUntil) {
      const progress = dir === 1 ? ball.x / W : 1 - ball.x / W
      if (progress > 0.68 && Math.random() < 0.55) {
        const gx = dir === 1 ? W - 34 : 34
        const gy = GOAL_TOP + 20 + Math.random() * (GOAL_BOT - GOAL_TOP - 40)
        startPass(s, s.holder, gx, gy, true)
      } else {
        const to = pickPass(s, s.holder)
        startPass(s, s.holder, to.x, to.y, false)
      }
    }
    return
  }

  // No holder and nothing in flight (first frame): give it to someone.
  kickoff(s, s.possession)
}

function draw(ctx: CanvasRenderingContext2D, s: Sim) {
  ctx.clearRect(-W, -H, W * 3, H * 3)

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

  ctx.fillStyle = 'rgba(255, 255, 255, 0.38)'
  ctx.beginPath()
  ctx.arc(s.ball.x, s.ball.y, 3.4, 0, Math.PI * 2)
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
