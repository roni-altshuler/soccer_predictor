import type { Metadata } from 'next'
import { ForecastLab } from '@/components/forecast/ForecastLab'
import { readForecastLab } from '@/lib/server/forecastLab'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Forecast Lab',
  description: 'Explore football through AI: match probabilities, likely scorelines and the points at stake. Every number comes from a recorded forecast.',
}

export default async function LabPage({ searchParams }: { searchParams: Promise<{ fixture?: string }> }) {
  const query = await searchParams
  const fixture = typeof query.fixture === 'string' ? query.fixture : undefined
  return <ForecastLab initialData={await readForecastLab(fixture)} initialFixture={fixture} />
}
