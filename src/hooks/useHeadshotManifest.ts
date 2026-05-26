'use client'

import useSWRImmutable from 'swr/immutable'

type Manifest = Record<string, string>

interface ManifestHookResult {
  manifest: Manifest | undefined
  resolve: (id: string) => string | undefined
  isLoading: boolean
}

async function fetchManifest(url: string): Promise<Manifest> {
  const res = await fetch(url)
  if (!res.ok) {
    // 404 is fine — the headshot pipeline may not have populated the file yet.
    return {}
  }
  const data = (await res.json()) as unknown
  if (!data || typeof data !== 'object') return {}
  return data as Manifest
}

function withBase(path: string): string {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BASE_PATH) {
    return `${process.env.NEXT_PUBLIC_BASE_PATH.replace(/\/$/, '')}${path}`
  }
  return path
}

function useManifestAt(path: string): ManifestHookResult {
  const { data, isLoading } = useSWRImmutable<Manifest>(withBase(path), fetchManifest)
  return {
    manifest: data,
    resolve: (id: string) => {
      const url = data?.[id]
      if (!url) return undefined
      return url.startsWith('http') ? url : withBase(url)
    },
    isLoading,
  }
}

/**
 * Player headshot manifest. Populated by `backend/scripts/fetch_player_headshots.py`
 * which writes `/public/headshots/manifest.json` of shape `{ playerId: '/headshots/12345.webp' }`.
 * SWR caches it forever (immutable, no revalidate) — the manifest is static per build.
 */
export function useHeadshotManifest(): ManifestHookResult {
  return useManifestAt('/headshots/manifest.json')
}

/**
 * Team badge manifest. Populated by `backend/scripts/fetch_team_badges.py`
 * which writes `/public/badges/manifest.json`.
 */
export function useTeamBadgeManifest(): ManifestHookResult {
  return useManifestAt('/badges/manifest.json')
}
