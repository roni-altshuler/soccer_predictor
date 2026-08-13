import fs from 'fs'
import path from 'path'

import type { TournamentForecast } from '@/components/tournament/TournamentPicker'

/**
 * The tournaments page against the artifact it actually serves.
 *
 * This exists because the smoke tests could not catch the break that shipped.
 * They feed a hand-written fixture, and when `predict_tournaments` went from
 * publishing one entry per competition to publishing the last eight EDITIONS
 * of each, the fixture stayed at one-per-competition. Every test stayed green
 * while the real page put seventy-nine rows in a fourteen-row picker, six of
 * them reading "UEFA Champions League", and resolved all six to the same
 * edition because the lookup matched on `competition_id` alone.
 *
 * A fixture proves the component works on the shape someone imagined. This
 * proves the shape is the one on disk.
 */

const artifact = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'backend/data/predictions/tournaments.json'),
    'utf8',
  ),
) as {
  method: { states: Record<string, string> }
  tournaments: TournamentForecast[]
}

const editions = artifact.tournaments

// Every state the picker knows how to render. A status outside this set falls
// through to the "completed" copy, which would describe an unfinished
// tournament as a settled record.
const RENDERED = new Set([
  'upcoming',
  'in_progress',
  'completed',
  'awaiting_draw',
  'not_reconstructed',
  'insufficient_history',
])

const byCompetition = () => {
  const map = new Map<string, TournamentForecast[]>()
  for (const e of editions) {
    const list = map.get(e.competition_id)
    if (list) list.push(e)
    else map.set(e.competition_id, [e])
  }
  return map
}

describe('tournaments.json — the shape the page is built on', () => {
  it('is not empty', () => {
    expect(editions.length).toBeGreaterThan(0)
  })

  it('carries every field the picker reads', () => {
    for (const e of editions) {
      expect(typeof e.competition_id).toBe('string')
      expect(typeof e.name).toBe('string')
      expect(typeof e.season).toBe('number')
      expect(Array.isArray(e.bracket)).toBe(true)
    }
  })

  it('only uses states the page can render', () => {
    const unknown = [...new Set(editions.map((e) => e.status))].filter(
      (s) => !RENDERED.has(s),
    )
    expect(unknown).toEqual([])
  })

  it('documents every state it uses', () => {
    // The method block is what /tournaments quotes when it explains itself. A
    // status with no entry there is one the page describes by guessing.
    const documented = new Set(Object.keys(artifact.method.states))
    const undocumented = [...new Set(editions.map((e) => e.status))].filter(
      (s) => !documented.has(s),
    )
    expect(undocumented).toEqual([])
  })

  it('names exactly one current edition per competition', () => {
    // The picker opens on `is_current`. Two of them is ambiguous and none of
    // them silently falls back to the newest season, which is not the same
    // thing — a competition whose next edition has one qualifying tie played
    // would open on a tournament that has barely started.
    for (const [id, list] of byCompetition()) {
      expect([id, list.filter((e) => e.is_current).length]).toEqual([id, 1])
    }
  })

  it('never repeats a season within a competition', () => {
    // The season row keys on the year, and two 2025 rows would render two
    // identical buttons of which only the first is reachable.
    for (const [id, list] of byCompetition()) {
      const seasons = list.map((e) => e.season)
      expect([id, seasons.length]).toEqual([id, new Set(seasons).size])
    }
  })

  it('never publishes an edition after the current one', () => {
    // Anything later has no draw, and a bracket printed for a tournament that
    // does not exist yet reads as a forecast of it.
    for (const [id, list] of byCompetition()) {
      const current = list.find((e) => e.is_current)!
      const ahead = list.filter((e) => e.season > current.season).map((e) => e.season)
      expect([id, ahead]).toEqual([id, []])
    }
  })

  it('calls an edition undrawn only while it still has ties to play', () => {
    // `awaiting_draw` prints "Draw not made" on the page. Nine finished
    // editions carried it — including the 2020-21 Champions League, whose
    // final Chelsea won on 2021-05-29 with the bracket printing it in full.
    for (const e of editions.filter((x) => x.status === 'awaiting_draw')) {
      const pending = (e.bracket ?? []).flatMap((r) => r.ties).filter((t) => t.pending)
      expect([e.competition_id, e.season, pending.length > 0]).toEqual([
        e.competition_id,
        e.season,
        true,
      ])
    }
  })

  it('prices a tie or settles it, never both and never neither', () => {
    // A played tie has a score and a winner; an undecided one has a
    // probability. A percentage next to a finished tie would be read as a
    // forecast of something already known.
    for (const e of editions) {
      for (const round of e.bracket ?? []) {
        for (const tie of round.ties) {
          const where = `${e.competition_id} ${e.season} ${round.display} ${tie.team_a}-${tie.team_b}`
          if (tie.pending) {
            expect([where, tie.score, tie.winner_id]).toEqual([where, null, null])
          } else {
            expect([where, tie.p_team_a]).toEqual([where, null])
          }
        }
      }
    }
  })

  it('never puts the same team on both sides of a tie', () => {
    // ESPN publishes undrawn rounds with competitors like "Group A 2nd
    // Place", and fuzzy-matching those onto one invented club produced a tie
    // whose two sides were the same team — a guaranteed advance.
    for (const e of editions) {
      for (const round of e.bracket ?? []) {
        for (const tie of round.ties) {
          expect([e.competition_id, tie.team_a_id === tie.team_b_id]).toEqual([
            e.competition_id,
            false,
          ])
        }
      }
    }
  })

  it('gives every round a heading a reader would recognise', () => {
    // The fallback spaces a slug out on its separators, so a one-word slug
    // came through as "Firststage" and a Nations League division as
    // "Leaguea". Both are true and neither is what the round is called.
    for (const e of editions) {
      for (const round of e.bracket ?? []) {
        expect(round.display).not.toMatch(/^(First|Second|Third|Fourth|Fifth|League|Round)[a-z]/)
      }
    }
  })

  it('states a reason wherever it declines to forecast', () => {
    for (const e of editions) {
      if (['awaiting_draw', 'not_reconstructed', 'insufficient_history'].includes(e.status)) {
        expect([e.competition_id, e.season, Boolean(e.reason)]).toEqual([
          e.competition_id,
          e.season,
          true,
        ])
        expect(e.odds ?? []).toEqual([])
      }
    }
  })
})
