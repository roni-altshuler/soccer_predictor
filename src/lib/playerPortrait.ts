/** Provider IDs are separate namespaces, including when their digits collide. */
export interface PlayerIdentity { provider: 'espn' | 'fotmob'; id: string }
export interface PlayerPortrait {
  subject: PlayerIdentity
  asset: PlayerIdentity
  subject_verified: true
  subject_evidence: string
  rights: { status: 'permitted'; evidence: string }
  crosswalk?: { subject: PlayerIdentity; asset: PlayerIdentity; verified: true; evidence: string }
  source_url: string
  path: string
  sha256: string
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const evidence = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function playerIdentityKey(value: unknown): string | undefined {
  const identity = record(value)
  if (!identity || typeof identity.provider !== 'string' || !['espn', 'fotmob'].includes(identity.provider)) return undefined
  if (typeof identity.id !== 'string' || !/^[1-9][0-9]*$/.test(identity.id)) return undefined
  return `${identity.provider}:${identity.id}`
}

export function approvedPlayerPortrait(identity: unknown, value: unknown): PlayerPortrait | undefined {
  const key = playerIdentityKey(identity)
  const entry = record(value)
  if (!key || !entry || playerIdentityKey(entry.subject) !== key) return undefined
  const asset = record(entry.asset)
  const assetKey = playerIdentityKey(asset)
  if (!asset || !assetKey || entry.subject_verified !== true || !evidence(entry.subject_evidence)) return undefined
  const rights = record(entry.rights)
  if (!rights || rights.status !== 'permitted' || !evidence(rights.evidence)) return undefined
  if (assetKey !== key || entry.crosswalk != null) {
    const crosswalk = record(entry.crosswalk)
    if (!crosswalk || crosswalk.verified !== true || playerIdentityKey(crosswalk.subject) !== key
      || playerIdentityKey(crosswalk.asset) !== assetKey || !evidence(crosswalk.evidence)) return undefined
  }
  const source = asset.provider === 'espn'
    ? `https://a.espncdn.com/i/headshots/soccer/players/full/${asset.id}.png`
    : `https://images.fotmob.com/image_resources/playerimages/${asset.id}.png`
  if (entry.source_url !== source || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) return undefined
  if (entry.path !== `/headshots/${asset.provider}/${asset.id}-${entry.sha256}.webp`) return undefined
  return entry as unknown as PlayerPortrait
}
