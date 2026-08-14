import { ESPN_SERVER_HEADERS, ESPN_SITE } from '@/lib/espnHost'
import { normTeam } from '@/lib/normTeam'

/**
 * Joining a bracket tie to the real fixture behind it.
 *
 * `tournaments.json` names the two clubs and the first-leg date; it carries no
 * match id, so reaching ESPN's match detail means a NAME join — the thing this
 * project measured at **68.9%** when it was tried on the season snapshots, and
 * dropped the rest silently so the sample merely looked small.
 *
 * So it was measured here too, over 520 ties across all fourteen competitions
 * and two editions each, before anything was built on it:
 *
 * | rule | resolved |
 * |---|---|
 * | pairing + date, our competition ids | 76.7% |
 * | + ESPN's own slugs (`uefa.europa.conf`, `afc.asian.cup`) | 91.3% |
 * | + one-name relaxation, gated on uniqueness | **99.2%** |
 *
 * The last step is the interesting one. Our warehouse says `Inter` where ESPN
 * says `Internazionale`, and 42 of the 520 differ that way. Accepting a single
 * matching name would also accept Inter Miami, so it is accepted only when
 * exactly ONE event in the competition sits on the tie's own kickoff date with
 * a side we recognise — the same uniqueness discipline `load_groups` uses to
 * place `inter` in MLS without fusing it into Internazionale.
 *
 * The four ties that still do not resolve return null and the page says the
 * match detail is unavailable. Two are genuine data disagreements — a
 * Libertadores tie our fixture list dates a week before ESPN does — and
 * showing *some* match rather than none is precisely the failure this refuses.
 */

/** Our warehouse ids are not ESPN's slugs; this is the map in `ingest_tournaments.py`. */
export const ESPN_SLUG: Record<string, string> = {
  'uefa.conference': 'uefa.europa.conf',
  'afc.asian': 'afc.asian.cup',
}

export const espnSlug = (competitionId: string): string =>
  ESPN_SLUG[competitionId] ?? competitionId

export interface ResolveInput {
  competitionId: string
  /** First-leg date, `YYYY-MM-DD`, as the artifact publishes it. */
  kickoff: string
  teamA: string
  teamB: string
  twoLegged: boolean
}

export interface Resolution {
  eventIds: string[]
  /** Which rule matched, so a page or a test can tell an exact join from a relaxed one. */
  how: 'both-names' | 'one-name-and-date'
}

interface ScoreboardEvent {
  id: string
  date: string
  names: string[]
}

const DAY = 86_400_000
const dayDiff = (a: string, b: string) =>
  Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY)

const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

const compact = (iso: string) => iso.replace(/-/g, '')

/**
 * Every event a competition played in a window.
 *
 * The window runs to +21 days because a two-legged tie's second leg does, and
 * `limit` is explicit because ESPN's scoreboard silently caps at 100 events
 * with no error and no field saying so.
 */
async function scoreboard(
  slug: string,
  from: string,
  to: string,
): Promise<ScoreboardEvent[]> {
  const url = `${ESPN_SITE}/${slug}/scoreboard?dates=${compact(from)}-${compact(to)}&limit=400`
  const res = await fetch(url, {
    headers: ESPN_SERVER_HEADERS,
    next: { revalidate: 900 },
  })
  if (!res.ok) return []
  const body = (await res.json()) as {
    events?: Array<{
      id?: string
      date?: string
      competitions?: Array<{ competitors?: Array<{ team?: { displayName?: string } }> }>
    }>
  }
  const out: ScoreboardEvent[] = []
  for (const e of body.events ?? []) {
    const names = (e.competitions?.[0]?.competitors ?? [])
      .map((c) => normTeam(c.team?.displayName ?? ''))
      .filter(Boolean)
    if (names.length !== 2 || !e.id || !e.date) continue
    out.push({ id: e.id, date: e.date.slice(0, 10), names })
  }
  return out
}

const samePair = (names: string[], want: Set<string>) =>
  names.length === 2 && want.has(names[0]) && want.has(names[1]) && names[0] !== names[1]

/** The fixture(s) behind a tie, or null when nothing can be said honestly. */
export async function resolveTie(tie: ResolveInput): Promise<Resolution | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tie.kickoff)) return null
  const events = await scoreboard(
    espnSlug(tie.competitionId),
    shift(tie.kickoff, -1),
    shift(tie.kickoff, 21),
  )
  if (!events.length) return null

  const want = new Set([normTeam(tie.teamA), normTeam(tie.teamB)])
  let how: Resolution['how'] = 'both-names'
  let hits = events
    .filter((e) => samePair(e.names, want))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!hits.length) {
    // One spelling differs. Anchor on the date and require uniqueness: two
    // candidates means we do not know which, and guessing shows a reader a
    // match that is not the one they clicked.
    const sameDay = events.filter(
      (e) => dayDiff(e.date, tie.kickoff) <= 1 && e.names.some((n) => want.has(n)),
    )
    if (sameDay.length !== 1) return null
    const pair = sameDay[0].names
    hits = events
      .filter((e) => e.names.length === 2 && pair.every((n) => e.names.includes(n)))
      .sort((a, b) => a.date.localeCompare(b.date))
    how = 'one-name-and-date'
  }

  // The first leg has to be the tie's own date. Without this a rematch later
  // in the same edition — the AFCON group stage and its final — would satisfy
  // the pairing and hand back the wrong fixture.
  if (!hits.length || dayDiff(hits[0].date, tie.kickoff) > 1) return null

  const need = tie.twoLegged ? 2 : 1
  if (hits.length < need) return null
  return { eventIds: hits.slice(0, need).map((e) => e.id), how }
}

/* ------------------------------------------------------------------ *
 * The match card itself
 * ------------------------------------------------------------------ */

export interface CardSide {
  id: string
  name: string
  abbreviation: string
  score: string | null
  winner: boolean
  logo: string | null
  homeAway: 'home' | 'away'
}

export interface TimelineEvent {
  id: string
  minute: string
  type: string
  scoring: boolean
  teamId: string | null
  text: string
  short: string
  players: string[]
}

export interface CommentaryLine {
  sequence: number
  minute: string
  text: string
}

export interface StatRow {
  name: string
  label: string
  home: string
  away: string
  /** Both sides as numbers when they are comparable, for the bar. */
  homeValue: number | null
  awayValue: number | null
}

export interface LineupPlayer {
  id: string
  name: string
  /** ESPN's own abbreviation — "V. Júnior". Never derived: dropping the first
   *  token turns Vinícius Júnior into "Júnior", which is not what anyone calls
   *  him, and the rule that works for European names fails for Brazilian ones. */
  short: string
  jersey: string
  position: string
  formationPlace: number
  subbedIn: boolean
  subbedOut: boolean
}

export interface Lineup {
  teamId: string
  homeAway: 'home' | 'away'
  formation: string | null
  starters: LineupPlayer[]
  bench: LineupPlayer[]
}

export interface Meeting {
  id: string
  date: string
  competition: string | null
  home: { name: string; score: string | null; winner: boolean }
  away: { name: string; score: string | null; winner: boolean }
}

export interface FormGame {
  id: string
  date: string
  opponent: string
  atVs: string
  score: string
  result: string
  competition: string | null
}

export interface MatchCard {
  eventId: string
  date: string
  state: 'pre' | 'in' | 'post'
  statusDetail: string
  leg: string | null
  neutralSite: boolean
  home: CardSide
  away: CardSide
  venue: { name: string; city: string | null; country: string | null } | null
  attendance: number | null
  officials: string[]
  events: TimelineEvent[]
  commentary: CommentaryLine[]
  stats: StatRow[]
  lineups: Lineup[]
  headToHead: { summary: string | null; meetings: Meeting[] } | null
  form: Array<{ teamId: string; games: FormGame[] }>
}

/**
 * The statistics worth a row, in the order a reader scans them.
 *
 * ESPN publishes about forty per side, most of them derived from one another
 * (`Accurate Crosses` next to `Crosses` next to `Cross %`). Printing all of
 * them is not more information, it is a wall — this is the FotMob set.
 */
const STAT_ORDER = [
  'possessionPct',
  'totalShots',
  'shotsOnTarget',
  'wonCorners',
  'foulsCommitted',
  'offsides',
  'saves',
  'yellowCards',
  'redCards',
  'accuratePasses',
  'passPct',
] as const

const numeric = (v: string): number | null => {
  const m = /^-?\d+(\.\d+)?/.exec(v.trim())
  return m ? Number(m[0]) : null
}

interface EspnSummary {
  header?: {
    competitions?: Array<{
      date?: string
      neutralSite?: boolean
      notes?: Array<{ headline?: string }>
      status?: { type?: { state?: string; detail?: string } }
      competitors?: Array<{
        id?: string
        homeAway?: string
        score?: string
        winner?: boolean
        team?: { displayName?: string; abbreviation?: string; logo?: string }
      }>
    }>
  }
  gameInfo?: {
    venue?: { fullName?: string; address?: { city?: string; country?: string } }
    attendance?: number
    officials?: Array<{ displayName?: string; fullName?: string }>
  }
  keyEvents?: Array<Record<string, unknown>>
  commentary?: Array<Record<string, unknown>>
  boxscore?: {
    teams?: Array<{
      homeAway?: string
      statistics?: Array<{ name?: string; label?: string; displayValue?: string }>
    }>
  }
  rosters?: Array<Record<string, unknown>>
  seasonseries?: Array<Record<string, unknown>>
  lastFiveGames?: Array<Record<string, unknown>>
}

/** One fixture, trimmed from ESPN's ~400KB summary to what the card draws. */
export async function matchCard(
  competitionId: string,
  eventId: string,
): Promise<MatchCard | null> {
  const url = `${ESPN_SITE}/${espnSlug(competitionId)}/summary?event=${eventId}`
  const res = await fetch(url, { headers: ESPN_SERVER_HEADERS, next: { revalidate: 60 } })
  if (!res.ok) return null
  const d = (await res.json()) as EspnSummary

  const comp = d.header?.competitions?.[0]
  const competitors = comp?.competitors ?? []
  const side = (which: 'home' | 'away'): CardSide | null => {
    const c = competitors.find((x) => x.homeAway === which)
    if (!c?.team?.displayName) return null
    return {
      id: String(c.id ?? ''),
      name: c.team.displayName,
      abbreviation: c.team.abbreviation ?? '',
      score: c.score ?? null,
      winner: Boolean(c.winner),
      logo: c.team.logo ?? null,
      homeAway: which,
    }
  }
  const home = side('home')
  const away = side('away')
  if (!home || !away) return null

  const stateRaw = comp?.status?.type?.state
  const state: MatchCard['state'] =
    stateRaw === 'in' ? 'in' : stateRaw === 'pre' ? 'pre' : 'post'

  const events: TimelineEvent[] = (d.keyEvents ?? [])
    .map((raw) => {
      const e = raw as {
        id?: string
        type?: { type?: string; text?: string }
        clock?: { displayValue?: string }
        scoringPlay?: boolean
        team?: { id?: string }
        text?: string
        shortText?: string
        participants?: Array<{ athlete?: { displayName?: string } }>
      }
      return {
        id: String(e.id ?? ''),
        minute: e.clock?.displayValue ?? '',
        type: e.type?.type ?? '',
        scoring: Boolean(e.scoringPlay),
        teamId: e.team?.id ? String(e.team.id) : null,
        text: e.text ?? '',
        short: e.shortText ?? e.type?.text ?? '',
        players: (e.participants ?? [])
          .map((p) => p.athlete?.displayName ?? '')
          .filter(Boolean),
      }
    })
    // Kickoff, half-time and full-time markers are structure, not incident.
    .filter((e) => !['kickoff', 'halftime', 'start-2nd-half', 'end-regular-time'].includes(e.type))

  const commentary: CommentaryLine[] = (d.commentary ?? [])
    .map((raw) => {
      const c = raw as { sequence?: number; time?: { displayValue?: string }; text?: string }
      return {
        sequence: Number(c.sequence ?? 0),
        minute: c.time?.displayValue ?? '',
        text: c.text ?? '',
      }
    })
    .filter((c) => c.text)
    .sort((a, b) => b.sequence - a.sequence)

  const boxHome = d.boxscore?.teams?.find((t) => t.homeAway === 'home')?.statistics ?? []
  const boxAway = d.boxscore?.teams?.find((t) => t.homeAway === 'away')?.statistics ?? []
  const statBy = (list: typeof boxHome, name: string) => list.find((s) => s.name === name)
  const stats: StatRow[] = STAT_ORDER.map((name): StatRow | null => {
    const h = statBy(boxHome, name)
    const a = statBy(boxAway, name)
    if (!h?.displayValue || !a?.displayValue) return null
    return {
      name,
      label: h.label ?? name,
      home: h.displayValue,
      away: a.displayValue,
      homeValue: numeric(h.displayValue),
      awayValue: numeric(a.displayValue),
    }
  }).filter((r): r is StatRow => r !== null)

  const lineups: Lineup[] = (d.rosters ?? []).map((raw) => {
    const r = raw as {
      homeAway?: string
      formation?: string
      team?: { id?: string }
      roster?: Array<{
        starter?: boolean
        jersey?: string
        formationPlace?: string
        subbedIn?: boolean
        subbedOut?: boolean
        position?: { abbreviation?: string; displayName?: string }
        athlete?: { id?: string; displayName?: string; shortName?: string }
      }>
    }
    const squad = (r.roster ?? []).map((p) => ({
      starter: Boolean(p.starter),
      player: {
        id: String(p.athlete?.id ?? ''),
        name: p.athlete?.displayName ?? p.athlete?.shortName ?? '',
        short: p.athlete?.shortName ?? p.athlete?.displayName ?? '',
        jersey: p.jersey ?? '',
        position: p.position?.abbreviation ?? '',
        formationPlace: Number(p.formationPlace ?? 0),
        subbedIn: Boolean(p.subbedIn),
        subbedOut: Boolean(p.subbedOut),
      } satisfies LineupPlayer,
    }))
    return {
      teamId: String(r.team?.id ?? ''),
      homeAway: r.homeAway === 'away' ? 'away' : 'home',
      formation: r.formation ?? null,
      // `formationPlace` is the slot on the pitch, which is what the shape is
      // dealt from — the roster arrives in whatever order ESPN filed it.
      starters: squad
        .filter((x) => x.starter)
        .map((x) => x.player)
        .sort((a, b) => a.formationPlace - b.formationPlace),
      bench: squad.filter((x) => !x.starter).map((x) => x.player),
    }
  })

  const series = (d.seasonseries ?? []).find(
    (s) => (s as { type?: string }).type === 'head-to-head',
  ) as
    | { summary?: string; events?: Array<Record<string, unknown>> }
    | undefined
  const meetings: Meeting[] = (series?.events ?? [])
    .map((raw) => {
      const e = raw as {
        id?: string
        date?: string
        season?: { slug?: string }
        competitors?: Array<{
          homeAway?: string
          winner?: boolean
          score?: string
          team?: { displayName?: string }
        }>
        notes?: Array<{ headline?: string }>
      }
      const at = (which: string) => {
        const c = e.competitors?.find((x) => x.homeAway === which)
        return {
          name: c?.team?.displayName ?? '',
          score: c?.score ?? null,
          winner: Boolean(c?.winner),
        }
      }
      return {
        id: String(e.id ?? ''),
        date: (e.date ?? '').slice(0, 10),
        competition: e.notes?.[0]?.headline ?? null,
        home: at('home'),
        away: at('away'),
      }
    })
    .filter((m) => m.home.name && m.away.name)

  const form = (d.lastFiveGames ?? []).map((raw) => {
    const g = raw as {
      team?: { id?: string; displayName?: string }
      events?: Array<Record<string, unknown>>
    }
    const teamId = String(g.team?.id ?? '')
    return {
      teamId,
      games: (g.events ?? [])
        .map((raw2) => {
          const e = raw2 as {
            id?: string
            gameDate?: string
            atVs?: string
            score?: string
            gameResult?: string
            competitionName?: string
            homeTeamId?: string
            awayTeamId?: string
            opponentTeamName?: string
            homeTeamName?: string
            awayTeamName?: string
          }
          const opponent =
            String(e.homeTeamId ?? '') === teamId
              ? e.awayTeamName ?? e.opponentTeamName ?? ''
              : e.homeTeamName ?? e.opponentTeamName ?? ''
          return {
            id: String(e.id ?? ''),
            date: (e.gameDate ?? '').slice(0, 10),
            opponent,
            atVs: e.atVs ?? '',
            score: e.score ?? '',
            result: e.gameResult ?? '',
            competition: e.competitionName ?? null,
          }
        })
        .filter((e) => e.score),
    }
  })

  const venue = d.gameInfo?.venue?.fullName
    ? {
        name: d.gameInfo.venue.fullName,
        city: d.gameInfo.venue.address?.city ?? null,
        country: d.gameInfo.venue.address?.country ?? null,
      }
    : null

  return {
    eventId,
    date: comp?.date ?? '',
    state,
    statusDetail: comp?.status?.type?.detail ?? '',
    leg: comp?.notes?.[0]?.headline ?? null,
    neutralSite: Boolean(comp?.neutralSite),
    home,
    away,
    venue,
    attendance: d.gameInfo?.attendance ?? null,
    officials: (d.gameInfo?.officials ?? [])
      .map((o) => o.displayName ?? o.fullName ?? '')
      .filter(Boolean),
    events,
    commentary,
    stats,
    lineups,
    headToHead: meetings.length ? { summary: series?.summary ?? null, meetings } : null,
    form,
  }
}
