import LeagueHomePage from '@/components/league/LeagueHomePage'
import TournamentHomePage from '@/components/tournament/TournamentHomePage'
import { Breadcrumbs } from '@/components/Breadcrumbs'

type TournamentId = 'champions_league' | 'europa_league' | 'conference_league' | 'world_cup' | 'euro' | 'copa_america'

// League configuration for known leagues (FotMob-style IDs and names)
const LEAGUE_CONFIG: Record<string, { name: string; country: string; isTournament?: boolean; tournamentId?: TournamentId }> = {
  // ESPN-style IDs
  'eng.1': { name: 'Premier League', country: 'England' },
  'esp.1': { name: 'La Liga', country: 'Spain' },
  'ger.1': { name: 'Bundesliga', country: 'Germany' },
  'ita.1': { name: 'Serie A', country: 'Italy' },
  'fra.1': { name: 'Ligue 1', country: 'France' },
  'usa.1': { name: 'MLS', country: 'USA' },
  'ned.1': { name: 'Eredivisie', country: 'Netherlands' },
  'por.1': { name: 'Primeira Liga', country: 'Portugal' },
  'sco.1': { name: 'Scottish Premiership', country: 'Scotland' },
  'bel.1': { name: 'Belgian Pro League', country: 'Belgium' },
  'tur.1': { name: 'Süper Lig', country: 'Turkey' },
  'bra.1': { name: 'Brasileirão', country: 'Brazil' },
  'arg.1': { name: 'Liga Profesional', country: 'Argentina' },
  'mex.1': { name: 'Liga MX', country: 'Mexico' },
  'uefa.champions': { name: 'UEFA Champions League', country: 'Europe', isTournament: true, tournamentId: 'champions_league' },
  'uefa.europa': { name: 'UEFA Europa League', country: 'Europe', isTournament: true, tournamentId: 'europa_league' },
  'uefa.europa.conf': { name: 'UEFA Conference League', country: 'Europe', isTournament: true, tournamentId: 'conference_league' },
  'fifa.world': { name: 'FIFA World Cup', country: 'International', isTournament: true, tournamentId: 'world_cup' },
  'uefa.euro': { name: 'UEFA European Championship', country: 'Europe', isTournament: true, tournamentId: 'euro' },
  'conmebol.america': { name: 'Copa America', country: 'South America', isTournament: true, tournamentId: 'copa_america' },
  // Snake_case IDs
  'premier_league': { name: 'Premier League', country: 'England' },
  'la_liga': { name: 'La Liga', country: 'Spain' },
  'bundesliga': { name: 'Bundesliga', country: 'Germany' },
  'serie_a': { name: 'Serie A', country: 'Italy' },
  'ligue_1': { name: 'Ligue 1', country: 'France' },
  'champions_league': { name: 'UEFA Champions League', country: 'Europe', isTournament: true, tournamentId: 'champions_league' },
  'europa_league': { name: 'UEFA Europa League', country: 'Europe', isTournament: true, tournamentId: 'europa_league' },
  'conference_league': { name: 'UEFA Conference League', country: 'Europe', isTournament: true, tournamentId: 'conference_league' },
  'world_cup': { name: 'FIFA World Cup', country: 'International', isTournament: true, tournamentId: 'world_cup' },
  'euro': { name: 'UEFA European Championship', country: 'Europe', isTournament: true, tournamentId: 'euro' },
  'euros': { name: 'UEFA European Championship', country: 'Europe', isTournament: true, tournamentId: 'euro' },
  'copa_america': { name: 'Copa America', country: 'South America', isTournament: true, tournamentId: 'copa_america' },
  'mls': { name: 'MLS', country: 'USA' },
  'eredivisie': { name: 'Eredivisie', country: 'Netherlands' },
  'primeira_liga': { name: 'Primeira Liga', country: 'Portugal' },
  'scottish_premiership': { name: 'Scottish Premiership', country: 'Scotland' },
  'belgian_pro_league': { name: 'Belgian Pro League', country: 'Belgium' },
  'super_lig': { name: 'Süper Lig', country: 'Turkey' },
  'brasileirao': { name: 'Brasileirão', country: 'Brazil' },
  'liga_mx': { name: 'Liga MX', country: 'Mexico' },
  // FotMob numeric IDs (common ones)
  '47': { name: 'Premier League', country: 'England' },
  '87': { name: 'La Liga', country: 'Spain' },
  '54': { name: 'Bundesliga', country: 'Germany' },
  '55': { name: 'Serie A', country: 'Italy' },
  '53': { name: 'Ligue 1', country: 'France' },
  '130': { name: 'MLS', country: 'USA' },
  '57': { name: 'Eredivisie', country: 'Netherlands' },
  '61': { name: 'Primeira Liga', country: 'Portugal' },
  '42': { name: 'UEFA Champions League', country: 'Europe', isTournament: true, tournamentId: 'champions_league' },
  '73': { name: 'UEFA Europa League', country: 'Europe', isTournament: true, tournamentId: 'europa_league' },
}

interface LeaguePageParams {
  params: Promise<{
    leagueId: string
  }>
}

export default async function LeaguePage({ params }: LeaguePageParams) {
  const { leagueId } = await params
  const config = LEAGUE_CONFIG[leagueId] || { 
    name: leagueId.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    country: 'Unknown'
  }
  
  const breadcrumbs = (
    <div className="max-w-6xl mx-auto px-4 pt-3 pb-1">
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Leagues', href: '/matches' },
          { label: config.name },
        ]}
      />
    </div>
  )

  // Use TournamentHomePage for tournament competitions (UCL, UEL, World Cup)
  if (config.isTournament && config.tournamentId) {
    return (
      <>
        {breadcrumbs}
        <TournamentHomePage
          tournamentId={config.tournamentId}
          tournamentName={config.name}
        />
      </>
    )
  }

  return (
    <>
      {breadcrumbs}
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
    title: `${name} | Soccer Predictor`,
    description: `Latest standings, fixtures, results and predictions for ${name}`,
  }
}
