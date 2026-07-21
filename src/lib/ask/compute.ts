/**
 * Ask Pitchverse — deterministic answer compute (server-only).
 *
 * Feeds a resolved `AskIntent` into the exact-count query layer (`@/lib/rarity`,
 * which reads the committed `backend/data/rarity/*.json` artifacts) and assembles
 * the full answer: numbers, verifier-gated narration, the focus-rate-vs-minute
 * curve, and precedents. THE NUMBERS COME ONLY FROM HERE — the LLM never
 * supplies a figure. Imports `fs` transitively via `@/lib/rarity`, so this
 * module must stay server-side (route handlers only).
 */

import { getRarityExamples, queryRarity } from '@/lib/rarity'

import { focusFigure, focusLabel, narrate, verifyNarration } from './narrate'
import { MINUTE_OPTIONS, THIN_SAMPLE, type AskIntent } from './schema'
import type { AskAnswer, AskProvenance, ChartSpec, CurvePoint } from './types'

export interface ComputedAnswer {
  answer: AskAnswer
  chartSpec?: ChartSpec
  provenance: AskProvenance
}

export function computeAnswer(intent: AskIntent): ComputedAnswer {
  const r = queryRarity(intent.gender, intent.diff, intent.minute)
  const counts = { n: r.n, w: r.w, d: r.d, l: r.l }

  const nar = narrate(intent, counts)

  // Honesty guard (defense-in-depth): keep only sentences that pass the
  // numeric verifier. Templated narration always passes; this ensures nothing
  // ungrounded could ever slip through, e.g. if narration were later swapped
  // for an LLM-written variant.
  const verified = nar.sentences.filter((s) => verifyNarration(s, nar.allowedKeys).ok)
  const narration = verified.length > 0 ? verified : ['Here is the exact split for that situation.']

  const focus = focusFigure(counts, intent.outcome)
  const numbers: AskAnswer['numbers'] = {
    n: r.n,
    w: r.w,
    d: r.d,
    l: r.l,
    winRate: r.n > 0 ? r.w / r.n : 0,
    drawRate: r.n > 0 ? r.d / r.n : 0,
    lossRate: r.n > 0 ? r.l / r.n : 0,
    avoidDefeatRate: r.n > 0 ? (r.w + r.d) / r.n : 0,
    focusCount: focus.count,
    focusRate: focus.rate,
  }

  const precedents = getRarityExamples(intent.gender, intent.diff, intent.minute).map((e) => ({
    match_id: e.match_id,
    home: e.home,
    away: e.away,
    final_score: e.final_score,
    date: e.date,
    competition_id: e.competition_id,
    side: e.side,
    outcome: e.outcome,
  }))

  const answer: AskAnswer = {
    numbers,
    narration,
    headline: nar.headline,
    precedents,
    thin: r.n > 0 && r.n < THIN_SAMPLE,
  }

  const provenance: AskProvenance = {
    sampleSize: r.n,
    basis: intent.gender,
    matchesCovered: r.matches_covered,
    stateKey: r.key,
  }

  // Chart only when the queried state actually has matches.
  let chartSpec: ChartSpec | undefined
  if (r.n > 0) {
    const points: CurvePoint[] = []
    for (const m of MINUTE_OPTIONS) {
      const rm = queryRarity(intent.gender, intent.diff, m)
      if (rm.n <= 0) continue
      points.push({ minute: m, rate: focusFigure(rm, intent.outcome).rate, n: rm.n })
    }
    chartSpec = {
      wdl: { n: r.n, w: r.w, d: r.d, l: r.l },
      focus: intent.outcome,
      focusLabel: focusLabel(intent.outcome, intent.diff),
      curve: { points, markMinute: r.minute_bucket },
    }
  }

  return { answer, chartSpec, provenance }
}
