import { TeamComparison } from '@/components/league/TeamComparison'
import { ScheduleRefreshNotice } from '@/components/forecast/ScheduleRefreshNotice'

export const metadata = { title: 'Compare clubs · Pitchverse', description: 'Compare two clubs within the same recorded season snapshot.' }

export default async function ComparePage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  return <><div className="mx-auto max-w-6xl px-4"><ScheduleRefreshNotice competitionId={leagueId} /></div><TeamComparison leagueId={leagueId} /></>
}
