import LeagueHomePage from '@/components/league/LeagueHomePage'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { LeagueTrackRecord } from '@/components/accuracy/LeagueTrackRecord'

/**
 * Wave A only.
 *
 * The pivot (docs/PIVOT_2026-08.md §5) scopes the product to the five big
 * European men's leagues until the model is measured against the closing line
 * on each of them. MLS is Wave B; UCL/UEL/Euros/World Cup/Copa América are
 * Wave C and only return once their wave's evidence gate is met. The tournament
 * branch that used to live here went with them.
 */
const LEAGUE_CONFIG: Record<string, { name: string; country: string }> = {
  'eng.1': { name: 'Premier League', country: 'England' },
  'esp.1': { name: 'La Liga', country: 'Spain' },
  'ger.1': { name: 'Bundesliga', country: 'Germany' },
  'ita.1': { name: 'Serie A', country: 'Italy' },
  'fra.1': { name: 'Ligue 1', country: 'France' },
}

interface LeaguePageParams {
  params: Promise<{
    leagueId: string
  }>
}

export default async function LeaguePage({ params }: LeaguePageParams) {
  const { leagueId } = await params
  const config = LEAGUE_CONFIG[leagueId] || {
    name: leagueId.replace(/[_-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
    country: 'Unknown',
  }

  return (
    <>
      <div className="max-w-6xl mx-auto px-4 pt-3 pb-1">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Leagues', href: '/leagues' },
            { label: config.name },
          ]}
        />
      </div>
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
  return Object.keys(LEAGUE_CONFIG).map((leagueId) => ({
    leagueId,
  }))
}

export async function generateMetadata({ params }: LeaguePageParams) {
  const { leagueId } = await params
  const config = LEAGUE_CONFIG[leagueId]
  const name = config?.name || leagueId

  return {
    title: `${name} · Pitchverse`,
    description: `Match predictions, standings, fixtures and results for ${name}.`,
  }
}
