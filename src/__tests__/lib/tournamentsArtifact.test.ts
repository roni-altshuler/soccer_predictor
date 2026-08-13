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
  'awaiting_fixtures',
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

  it('publishes an edition after the current one only as an empty placeholder', () => {
    // The rule used to be "never forward", which left the page with nothing to
    // say about the next Champions League for the three months between one
    // final and the next draw. Forward editions are allowed now, but only as
    // `awaiting_fixtures`: no bracket, no odds, and a reason. A bracket
    // printed for a tournament that has not been drawn would read as a
    // forecast of it.
    for (const [id, list] of byCompetition()) {
      const current = list.find((e) => e.is_current)!
      for (const ahead of list.filter((e) => e.season > current.season)) {
        expect([id, ahead.season, ahead.status]).toEqual([id, ahead.season, 'awaiting_fixtures'])
        expect(ahead.bracket ?? []).toEqual([])
        expect(ahead.odds ?? []).toEqual([])
        expect(Boolean(ahead.reason)).toBe(true)
      }
    }
  })

  it('backs every upcoming edition with a real published fixture list', () => {
    // The placeholder exists because fixtures exist. Inventing "next season"
    // from the calendar would put a World Cup one year after the last one.
    for (const e of editions.filter((x) => x.status === 'awaiting_fixtures')) {
      expect([e.competition_id, e.next_fixture?.season]).toEqual([
        e.competition_id,
        e.season,
      ])
      expect((e.next_fixture?.fixtures ?? 0) > 0).toBe(true)
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

  // ------------------------------------------------------------- the bracket
  //
  // A bracket is only a bracket if the tie at slot s is fed by slots 2s and
  // 2s+1. Break that and the page still draws a tidy bracket — one in which
  // the wrong two teams appear to have played each other.

  it('never puts two ties of a round in the same slot', () => {
    for (const e of editions) {
      for (const round of e.bracket ?? []) {
        const slots = round.ties.map((t) => t.slot).filter((s) => s != null)
        expect([e.competition_id, e.season, round.display, slots.length]).toEqual([
          e.competition_id,
          e.season,
          round.display,
          new Set(slots).size,
        ])
      }
    }
  })

  it('keeps every slot inside the width of its round', () => {
    for (const e of editions) {
      for (const round of e.bracket ?? []) {
        for (const tie of round.ties) {
          if (tie.slot == null) continue
          expect([e.competition_id, round.display, tie.slot < (round.slots ?? 0)]).toEqual([
            e.competition_id,
            round.display,
            true,
          ])
        }
      }
    }
  })

  it('halves the bracket cleanly from its widest round to the final', () => {
    // Widths must be a power-of-two ladder. A round of 6 between a round of 8
    // and a semi-final is a data fault that would draw as a bracket anyway.
    for (const e of editions) {
      const widths = (e.bracket ?? [])
        .map((r) => r.slots ?? 0)
        .filter((n) => n > 0)
        .sort((a, b) => b - a)
      if (!widths.length) continue
      expect([e.competition_id, e.season, widths]).toEqual([
        e.competition_id,
        e.season,
        widths.map((_, i) => widths[0] / 2 ** i),
      ])
      expect([e.competition_id, widths[widths.length - 1]]).toEqual([e.competition_id, 1])
    }
  })

  it('gives a round outside the tree no slots and no positions', () => {
    // An entry round feeds the bracket without being part of it.
    for (const e of editions) {
      for (const round of (e.bracket ?? []).filter((r) => !(r.slots ?? 0))) {
        expect(round.ties.every((t) => t.slot == null)).toBe(true)
      }
    }
  })

  it('only projects empty rounds onto an edition with fixtures left', () => {
    // Empty boxes are a true statement about a draw that has not happened and
    // a false one about a tournament that is over.
    for (const e of editions) {
      const projected = (e.bracket ?? []).filter((r) => r.projected)
      if (!projected.length) continue
      const pending = (e.bracket ?? []).flatMap((r) => r.ties).some((t) => t.pending)
      expect([e.competition_id, e.season, pending]).toEqual([
        e.competition_id,
        e.season,
        true,
      ])
      expect(projected.every((r) => r.ties.length === 0)).toBe(true)
    }
  })

  it('states a reason wherever it declines to forecast', () => {
    for (const e of editions) {
      if (
        ['awaiting_draw', 'awaiting_fixtures', 'not_reconstructed', 'insufficient_history'].includes(
          e.status,
        )
      ) {
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
