import LeagueHomePage from '@/components/league/LeagueHomePage'
import { LeagueTrackRecord } from '@/components/accuracy/LeagueTrackRecord'
import { SERVED_COMPETITION_IDS, getLeagueAccent } from '@/lib/leagueAccents'

/**
 * The nine leagues `/season` projects are the ones this route is built for.
 *
 * It is NOT restricted to them, and must not be. A Champions League fixture on
 * a match page links to its own competition, and 404ing that link to keep the
 * directory tidy would break a page a reader actually reached from content
 * that exists. Anything the accent registry knows therefore still renders,
 * with its real name — the previous version hard-coded five leagues and fell
 * back to title-casing the slug, which is how `/leagues/bra.1` came to be
 * headed "Bra.1" in country "Unknown".
 *
 * `generateStaticParams` still pre-renders only the served nine, because those
 * are the ones linked from the directory and worth the build time.
 */
function leagueConfig(leagueId: string): { name: string; country: string } {
  const accent = getLeagueAccent(leagueId)
  if (accent.competitionId !== 'unknown') {
    return { name: accent.displayName, country: accent.country }
  }
  // A competition no source has ever named. Humanise the slug rather than
  // invent an identity for it.
  return {
    name: leagueId.replace(/[_-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
    country: '',
  }
}

interface LeaguePageParams {
  params: Promise<{
    leagueId: string
  }>
}

export default async function LeaguePage({ params }: LeaguePageParams) {
  const { leagueId } = await params
  const config = leagueConfig(leagueId)

  return (
    <>
      {/* No breadcrumb trail here — LeagueHomePage carries the one back
          control ("All leagues"), same grammar as the sibling apps. Two
          competing back affordances forty pixels apart was the old layout. */}
      {/* The league's report card sits here, OUTSIDE LeagueHomePage, on
          purpose. That component gates everything behind a loading state fed
          by live ESPN calls, so anything inside it disappears whenever the
          feed is slow or down — precisely when a reader most wants to see
          something solid. The track record is a committed static artifact and
          depends on no live provider, so it renders regardless. */}
      <div className="mx-auto max-w-6xl px-4 pt-2">
        <LeagueTrackRecord leagueId={leagueId} />
      </div>
      <LeagueHomePage
        leagueId={leagueId}
        leagueName={config.name}
        country={config.country}
      />
    </>
  )
}

export function generateStaticParams() {
  return SERVED_COMPETITION_IDS.map((leagueId) => ({ leagueId }))
}

export async function generateMetadata({ params }: LeaguePageParams) {
  const { leagueId } = await params
  const { name } = leagueConfig(leagueId)

  return {
    title: `${name} · Pitchverse`,
    description: `Match predictions, standings, fixtures and results for ${name}.`,
  }
}
