import type { Standing } from '@/lib/api'
import { ESPN_V2 } from '@/lib/espnHost'

/**
 * Shared helpers for the /simulator surfaces — probability formatting,
 * finishing-zone classification, and client-side team-identity resolution
 * (crest id + brand colour) for league simulations, whose payload carries
 * team names only.
 */

/** Display-honest probability format: whole % ≥10, one decimal below. */
export function formatPct(prob: number): string {
  const pct = prob * 100
  if (pct < 0.05) return '<0.1%'
  if (pct < 10) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}

/** 1 → "1st", 2 → "2nd", 11 → "11th"… */
export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

export type TableZone = 'title' | 'cl' | 'europa' | 'mid' | 'releg'

/** Zone accent token per finishing zone (mid gets none). */
export const ZONE_COLOR: Record<Exclude<TableZone, 'mid'>, string> = {
  title: 'var(--accent-primary)',
  cl: 'var(--accent-primary)',
  europa: 'var(--accent-info)',
  releg: 'var(--accent-loss)',
}

export const ZONE_LABEL: Record<Exclude<TableZone, 'mid'>, string> = {
  title: 'Title',
  cl: 'Champions League',
  europa: 'Europa',
  releg: 'Relegation',
}

/**
 * Finishing zone for a 1-based final position. Mirrors the league engine:
 * top 4 = Champions League places, 5–7 = Europa places, last 3 = drop zone.
 */
export function zoneForPosition(position: number, numTeams: number): TableZone {
  if (position === 1) return 'title'
  if (position <= 4) return 'cl'
  if (position <= 7 && numTeams > 10) return 'europa'
  if (position > numTeams - 3) return 'releg'
  return 'mid'
}

/** Largest single-position probability across the whole standings set. */
export function maxDistributionProbability(standings: Standing[]): number {
  let max = 0
  for (const team of standings) {
    for (const p of Object.values(team.position_distribution ?? {})) {
      if (p > max) max = p
    }
  }
  return max
}

// ---------------------------------------------------------------------------
// Team identity (crest id + brand colour) resolution
// ---------------------------------------------------------------------------

export interface TeamMeta {
  /** ESPN team id — feeds TeamBadge's crest CDN lookup. */
  id?: string
  /** Usable brand colour (hex with #), luminance-guarded for both themes. */
  color?: string
}

function hexLuminance(hex: string): number {
  const value = hex.replace('#', '')
  if (value.length !== 6) return 0.5
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Pick a brand colour that stays visible on both light and dark surfaces. */
export function pickUsableColor(
  color?: string,
  alternate?: string,
): string | undefined {
  for (const candidate of [color, alternate]) {
    if (!candidate || !/^[0-9a-fA-F]{6}$/.test(candidate.replace('#', ''))) continue
    const lum = hexLuminance(candidate)
    if (lum >= 0.06 && lum <= 0.85) {
      return candidate.startsWith('#') ? candidate : `#${candidate}`
    }
  }
  return undefined
}

interface EspnStandingEntryLike {
  team?: {
    id?: string | number
    displayName?: string
    color?: string
    alternateColor?: string
  }
}

/**
 * Resolve crest ids + brand colours for a league by reading the same ESPN
 * standings feed the simulation route parses — team names therefore match
 * the simulation payload exactly. Returns an empty map on any failure
 * (crests then fall back to TeamBadge's initials chip; nothing is faked).
 */
export async function fetchLeagueTeamMeta(
  espnLeagueId: string,
  signal?: AbortSignal,
): Promise<Record<string, TeamMeta>> {
  try {
    const res = await fetch(
      `${ESPN_V2}/${espnLeagueId}/standings`,
      { signal },
    )
    if (!res.ok) return {}
    const data = await res.json()
    const meta: Record<string, TeamMeta> = {}
    for (const child of data?.children ?? []) {
      for (const entry of (child?.standings?.entries ?? []) as EspnStandingEntryLike[]) {
        const name = entry.team?.displayName
        if (!name) continue
        meta[name] = {
          id: entry.team?.id != null ? String(entry.team.id) : undefined,
          color: pickUsableColor(entry.team?.color, entry.team?.alternateColor),
        }
      }
    }
    return meta
  } catch {
    return {}
  }
}
