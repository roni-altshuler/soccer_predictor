import type { ForkDistribution } from '@/components/match/detail/engineClient'
import type { BaseRate } from '@/components/match/detail/liveWinProbabilityV2'

import type { OutcomeProbs } from './types'

export type ReadTone = 'edge' | 'risk' | 'watch' | 'note'

export interface LiveRead {
  tone: ReadTone
  text: string
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

interface ReadInputs {
  homeTeam: string
  awayTeam: string
  /** Current three-way read (engine now, or the pre-match model for upcoming). */
  current: OutcomeProbs
  /** Engine pre-match baseline — only meaningful for a live match. */
  baseline: OutcomeProbs | null
  /** Exact-count historical base rate for the live score-state (home-side view). */
  baseRate: BaseRate | null
  /** Kernel's continuation distribution (for the likeliest finish). */
  distribution: ForkDistribution | null
  isLive: boolean
  homeGoals: number
  awayGoals: number
  minute: number | null
}

/**
 * Turn the numbers the surface already holds into 2–4 short, honest match reads.
 * Every rule checks its underlying field before firing; when a signal is absent
 * (no baseline, thin base-rate sample, no distribution) its read is simply not
 * produced — no fabricated angles.
 */
export function buildLiveReads(input: ReadInputs): LiveRead[] {
  const reads: LiveRead[] = []
  const { current, baseline, baseRate, distribution, isLive } = input

  const labelFor = (key: 'home' | 'draw' | 'away'): string =>
    key === 'home' ? input.homeTeam : key === 'away' ? input.awayTeam : 'A draw'

  // 1) The lean — a clear favourite is an edge, a coin-flip is a risk.
  const ranked = (['home', 'draw', 'away'] as const)
    .map((key) => ({ key, value: current[key] }))
    .sort((a, b) => b.value - a.value)
  const leader = ranked[0]
  const runnerUp = ranked[1]
  if (leader && runnerUp) {
    const margin = leader.value - runnerUp.value
    const who = labelFor(leader.key)
    if (leader.value >= 0.65) {
      reads.push({
        tone: 'edge',
        text:
          leader.key === 'draw'
            ? `The model leans heavily toward a draw at ${pct(leader.value)}.`
            : `${who} are strong favourites at ${pct(leader.value)} to ${isLive ? 'see this out' : 'win'}.`,
      })
    } else if (margin < 0.08) {
      reads.push({
        tone: 'risk',
        text: `Too close to call — ${pct(leader.value)} plays ${pct(runnerUp.value)} at the top.`,
      })
    } else {
      reads.push({
        tone: 'note',
        text:
          leader.key === 'draw'
            ? `The draw edges it in the model at ${pct(leader.value)}.`
            : `${who} lead the model's read at ${pct(leader.value)}.`,
      })
    }
  }

  // 2) The swing since kickoff — only for a live match with a comparable baseline.
  if (isLive && baseline) {
    const movers = (['home', 'draw', 'away'] as const)
      .map((key) => ({ key, delta: current[key] - baseline[key] }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    const top = movers[0]
    const pts = Math.round(top.delta * 100)
    if (Math.abs(pts) >= 8) {
      const who = labelFor(top.key)
      const noun = top.key === 'draw' ? 'the draw' : `${who}`
      reads.push({
        tone: 'watch',
        text:
          pts > 0
            ? `The board has swung toward ${noun} — up ${pts} pts since kickoff.`
            : `${noun.charAt(0).toUpperCase() + noun.slice(1)} ${top.key === 'draw' ? 'has' : 'have'} drifted ${Math.abs(pts)} pts since kickoff.`,
      })
    }
  }

  // 3) Historical corroboration — the modal outcome from matches in this exact spot.
  if (isLive && baseRate) {
    const br = baseRate.probabilities
    const brRanked: { key: 'home' | 'draw' | 'away'; value: number }[] = [
      { key: 'home' as const, value: br.home_win },
      { key: 'draw' as const, value: br.draw },
      { key: 'away' as const, value: br.away_win },
    ].sort((a, b) => b.value - a.value)
    const modal = brRanked[0]
    const sample = baseRate.sample.toLocaleString()
    if (modal.key === 'home') {
      reads.push({
        tone: 'note',
        text: `History backs the hosts here: ${pct(modal.value)} of sides in this exact spot went on to win (${sample} matches).`,
      })
    } else if (modal.key === 'away') {
      reads.push({
        tone: 'note',
        text: `History backs the visitors: sides in this position lost ${pct(modal.value)} of the time (${sample} matches).`,
      })
    } else {
      reads.push({
        tone: 'note',
        text: `This state most often stays level — ${pct(modal.value)} of ${sample} similar matches finished drawn.`,
      })
    }
  }

  // 4) The likeliest finish — the kernel's top full-time scoreline.
  if (distribution && distribution.topScorelines.length > 0) {
    const top = distribution.topScorelines[0]
    if (Number.isFinite(top.home) && Number.isFinite(top.away) && top.p > 0) {
      reads.push({
        tone: 'watch',
        text: `${isLive ? 'Likeliest finish from here' : "Model's likeliest scoreline"}: ${top.home}–${top.away} (${pct(top.p)}).`,
      })
    }
  }

  return reads.slice(0, 4)
}
