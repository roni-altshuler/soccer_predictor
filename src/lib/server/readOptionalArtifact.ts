import { promises as fs } from 'fs'

/** Absence is valid; unreadable or malformed evidence must remain a failure. */
export async function readOptionalArtifact(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid artifact object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}
