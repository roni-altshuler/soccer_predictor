import { readFile } from 'fs/promises'
import path from 'path'
import { labFromArtifact } from '@/lib/forecastLab'

export async function readForecastLab(requested?: string) {
  try {
    const raw = await readFile(path.join(process.cwd(), 'backend/data/predictions/season_fixtures.json'), 'utf8')
    return labFromArtifact(JSON.parse(raw), new Date(), requested)
  } catch {
    return labFromArtifact(null)
  }
}
