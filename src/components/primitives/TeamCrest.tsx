'use client'

import { useMemo, useState } from 'react'

import crestData from '@/data/teamCrests.json'
import { cn } from '@/lib/utils'

/**
 * A club's real crest, with an honest fallback.
 *
 * A reader finds their team in a twenty-row table by its badge long before
 * they finish reading the names — which is why every scoreboard product leads
 * with crests, and why a table without them reads as a spreadsheet.
 *
 * The map is built offline by `build_team_crests.py` and keyed by the SAME
 * normalisation the forecast keys its tables by, so a crest can only attach to
 * a club the forecast already recognises. 174 of 180 published clubs resolve;
 * the rest are sides promoted this summer whose name has not yet been seen by
 * both data sources. Those get a monogram rather than a neighbour's badge — a
 * wrong crest is worse than no crest, because it is not read as missing, it is
 * read as a fact.
 */

const CRESTS = (crestData as { crests: Record<string, Record<string, string>> })
  .crests

const SIZES = {
  xs: { box: 'h-4 w-4', text: 'text-[8px]' },
  sm: { box: 'h-5 w-5', text: 'text-[9px]' },
  md: { box: 'h-6 w-6', text: 'text-[10px]' },
  lg: { box: 'h-8 w-8', text: 'text-[11px]' },
} as const

/**
 * The port of `norm_team` in build_canonical.py, which produced these keys.
 *
 * It has to agree with the Python character for character or a club silently
 * loses its crest, so it mirrors the same four steps: NFKD, drop combining
 * marks, lowercase, punctuation to spaces, then drop the structural tokens in
 * `NOISE` — the same frozenset, in the same order.
 *
 * The punctuation class is Unicode-aware (`\p{L}`) rather than `[^a-z]`, which
 * is not a detail: `[^a-z]` deletes the Turkish dotless i, so `Kasımpaşa`
 * normalises to `kas mpasa` here and `kasimpasa` in Python, and Kasımpaşa
 * loses its badge. Every such club is Turkish, which is exactly the kind of
 * bug that survives a review done in English.
 */
const NOISE = new Set([
  'fc', 'cf', 'afc', 'sc', 'ac', 'as', 'ss', 'us', 'ud', 'cd', 'rc', 'rcd',
  'sv', 'tsv', 'vfl', 'vfb', 'fsv', 'bsc', 'sd', 'ca', 'club', 'de', 'the',
  'calcio', 'futbol', 'football', 'futebol', 'kv', 'rsc', 'kaa', 'sk', 'if',
])

export function normTeam(name: string): string {
  if (!name) return ''
  const stripped = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = stripped.split(' ').filter((t) => t && !NOISE.has(t))
  return (tokens.length ? tokens : stripped.split(' ')).join(' ')
}

/** Initials, capped at three, for a club with no crest on file. */
function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

export function crestUrl(
  competitionId: string | undefined,
  team: string,
): string | null {
  if (!competitionId) return null
  const byLeague = CRESTS[competitionId]
  if (!byLeague) return null
  return byLeague[normTeam(team)] ?? null
}

export function TeamCrest({
  team,
  competitionId,
  size = 'md',
  className,
}: {
  team: string
  competitionId?: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const s = SIZES[size]
  const url = useMemo(() => crestUrl(competitionId, team), [competitionId, team])
  // A URL on file can still 404. One failure and the monogram takes over for
  // the life of the component rather than leaving a broken-image glyph.
  const [failed, setFailed] = useState(false)

  if (!url || failed) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full',
          'bg-[var(--card-hover)] font-mono font-semibold tracking-tight',
          'text-[var(--text-tertiary)]',
          s.box,
          s.text,
          className,
        )}
      >
        {monogram(team)}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn('shrink-0 object-contain', s.box, className)}
    />
  )
}
