import { MatchEvidenceExplorer } from '@/components/league/MatchEvidenceExplorer'
import { validEvidenceDate } from '@/lib/matchEvidence'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Match evidence explorer · Pitchverse' }
export default async function EvidencePage({ params, searchParams }: {
  params: Promise<{ leagueId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { leagueId } = await params
  const query = await searchParams
  const today = new Date().toISOString().slice(0, 10)
  const asOf = validEvidenceDate(query.asOf) && query.asOf <= today ? query.asOf : today
  const from = validEvidenceDate(query.from) && query.from <= asOf ? query.from : new Date(Date.parse(asOf) - 90 * 86400000).toISOString().slice(0, 10)
  return <MatchEvidenceExplorer leagueId={leagueId} today={today} initialFrom={from} initialAsOf={asOf} initialTeam={typeof query.team === 'string' ? query.team.slice(0, 100) : ''} />
}
