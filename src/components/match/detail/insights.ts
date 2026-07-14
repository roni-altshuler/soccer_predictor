import type { NarrativeInsight } from '@/components/viz'

import type { MatchDetails } from './types'

export function formatProbability(value: number): string {
  return `${Math.round(value * 100)}%`
}

function getPredictionRank(match: MatchDetails) {
  if (!match.prediction) return []
  return [
    { key: 'home' as const, label: match.home_team, shortLabel: 'Home', value: match.prediction.home_win },
    { key: 'draw' as const, label: 'Draw', shortLabel: 'Draw', value: match.prediction.draw },
    { key: 'away' as const, label: match.away_team, shortLabel: 'Away', value: match.prediction.away_win },
  ].sort((a, b) => b.value - a.value)
}

/**
 * "What the model sees" — a small pure rule engine that turns the fields the
 * page already holds (win probabilities, table positions, head-to-head record,
 * goal expectancy) into 2–4 tone-tagged football insights for `NarrativeCard`.
 * Every rule checks its underlying field first; when nothing fires the card
 * renders nothing (no fabricated angles).
 */
export function buildModelInsights(match: MatchDetails): NarrativeInsight[] {
  const insights: NarrativeInsight[] = []
  const p = match.prediction
  if (!p) return insights

  // 1) Pick clarity — clear lean is an edge, a coin-flip is a risk.
  const ranked = getPredictionRank(match)
  const leader = ranked[0]
  const runnerUp = ranked[1]
  if (leader && runnerUp) {
    const margin = Math.round((leader.value - runnerUp.value) * 100)
    if (margin >= 12) {
      insights.push({
        tone: 'edge',
        title: `Clear lean: ${leader.label}`,
        detail: `${formatProbability(leader.value)} win probability, ${margin} points clear of the next most likely result.`,
      })
    } else if (margin < 7) {
      insights.push({
        tone: 'risk',
        title: 'Tight call',
        detail: `Only ${margin} point${margin === 1 ? '' : 's'} separate ${leader.shortLabel.toLowerCase()} and ${runnerUp.shortLabel.toLowerCase()} — this one could swing either way.`,
      })
    }
  }

  // 2) League table gap — only when both teams sit in the same table.
  if (match.homeStanding && match.awayStanding) {
    const posGap = match.awayStanding.position - match.homeStanding.position
    const ptsGap = match.homeStanding.points - match.awayStanding.points
    if (Math.abs(posGap) >= 5) {
      const stronger = posGap > 0 ? match.home_team : match.away_team
      insights.push({
        tone: 'edge',
        title: `${stronger} arrive as the form side`,
        detail: `#${match.homeStanding.position} vs #${match.awayStanding.position} in the table${
          Math.abs(ptsGap) > 0 ? `, a ${Math.abs(ptsGap)}-point gap` : ''
        }.`,
      })
    } else if (Math.abs(posGap) <= 1) {
      insights.push({
        tone: 'note',
        title: 'Little between them',
        detail: `The sides sit #${match.homeStanding.position} and #${match.awayStanding.position} — a genuine peer matchup.`,
      })
    }
  }

  // 3) Head-to-head history — needs a real sample.
  const h2hTotal = match.h2h.homeWins + match.h2h.draws + match.h2h.awayWins
  if (h2hTotal >= 4) {
    const homeShare = match.h2h.homeWins / h2hTotal
    const awayShare = match.h2h.awayWins / h2hTotal
    const record = `${match.h2h.homeWins}–${match.h2h.draws}–${match.h2h.awayWins}`
    if (homeShare >= 0.6 || awayShare >= 0.6) {
      const owner = homeShare >= 0.6 ? match.home_team : match.away_team
      insights.push({
        tone: 'watch',
        title: `${owner} own this fixture`,
        detail: `${homeShare >= 0.6 ? match.h2h.homeWins : match.h2h.awayWins} wins in the last ${h2hTotal} meetings (${record}).`,
      })
    } else if (match.h2h.draws / h2hTotal >= 0.4) {
      insights.push({
        tone: 'watch',
        title: 'Draw-heavy history',
        detail: `${match.h2h.draws} of the last ${h2hTotal} meetings ended level (${record}).`,
      })
    }
  }

  // 4) Goal expectancy.
  const totalGoals = p.total_goals ?? p.predicted_score.home + p.predicted_score.away
  if (Number.isFinite(totalGoals)) {
    const overText =
      p.over_2_5 !== undefined ? ` Over 2.5 goals is priced at ${formatProbability(p.over_2_5)}.` : ''
    if (totalGoals >= 3.0) {
      insights.push({
        tone: 'watch',
        title: 'Goals expected',
        detail: `Expected total of ${totalGoals.toFixed(1)} goals.${overText}`,
      })
    } else if (totalGoals <= 2.0) {
      insights.push({
        tone: 'note',
        title: 'Low-scoring profile',
        detail: `Expected total of just ${totalGoals.toFixed(1)} goals.${overText}`,
      })
    }
  }

  // 5) Both ends threatened.
  if (p.btts_yes !== undefined && p.btts_yes >= 0.62) {
    insights.push({
      tone: 'watch',
      title: 'Both ends threatened',
      detail: `Both teams to score is priced at ${formatProbability(p.btts_yes)}.`,
    })
  }

  return insights.slice(0, 4)
}
