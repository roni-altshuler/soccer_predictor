import { TeamComparison } from '@/components/league/TeamComparison'

export const metadata = { title: 'Compare clubs · Pitchverse', description: 'Compare two clubs within the same recorded season snapshot.' }

export default async function ComparePage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params
  return <TeamComparison leagueId={leagueId} />
}
