'use client'

import useSWRImmutable from 'swr/immutable'
import { approvedPlayerPortrait, playerIdentityKey, type PlayerIdentity, type PlayerPortrait } from '@/lib/playerPortrait'

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
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
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
 * Qualified identity + explicit subject/rights evidence are required. Legacy
 * numeric entries remain on disk but cannot establish a player's portrait.
 */
export function useHeadshotManifest() {
  const { data, isLoading } = useSWRImmutable<Record<string, unknown>>(withBase('/headshots/manifest.json'), fetchManifest)
  return {
    isLoading,
    resolve: (identity: PlayerIdentity | undefined): PlayerPortrait | undefined => {
      const key = playerIdentityKey(identity)
      return key ? approvedPlayerPortrait(identity, data?.[key]) : undefined
    },
    path: withBase,
  }
}

/**
 * Team badge manifest. Populated by `backend/scripts/fetch_team_badges.py`
 * which writes `/public/badges/manifest.json`.
 */
export function useTeamBadgeManifest(): ManifestHookResult {
  return useManifestAt('/badges/manifest.json')
}
