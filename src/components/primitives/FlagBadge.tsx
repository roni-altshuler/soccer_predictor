'use client'

import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

interface FlagBadgeProps {
  /** Country name (national teams) — resolved to a flag via flagcdn. */
  country?: string
  /** Team/country name (required) — alt text + monogram source. */
  teamName: string
  /** Direct logo/crest URL — tried first. */
  logoUrl?: string
  /** Pixel diameter (default 24). */
  size?: number
  className?: string
}

/**
 * ISO 3166-1 alpha-2 codes for common football nations (plus the UK home
 * nations via flagcdn subdivision codes). Keys are lowercased country names.
 */
const COUNTRY_ISO2: Record<string, string> = {
  spain: 'es',
  portugal: 'pt',
  croatia: 'hr',
  austria: 'at',
  switzerland: 'ch',
  algeria: 'dz',
  argentina: 'ar',
  egypt: 'eg',
  australia: 'au',
  'cape verde': 'cv',
  morocco: 'ma',
  ghana: 'gh',
  colombia: 'co',
  norway: 'no',
  brazil: 'br',
  mexico: 'mx',
  england: 'gb-eng',
  scotland: 'gb-sct',
  wales: 'gb-wls',
  'northern ireland': 'gb-nir',
  usa: 'us',
  'united states': 'us',
  france: 'fr',
  germany: 'de',
  italy: 'it',
  netherlands: 'nl',
  belgium: 'be',
  denmark: 'dk',
  sweden: 'se',
  poland: 'pl',
  ukraine: 'ua',
  serbia: 'rs',
  'czech republic': 'cz',
  czechia: 'cz',
  turkey: 'tr',
  'türkiye': 'tr',
  greece: 'gr',
  ireland: 'ie',
  japan: 'jp',
  'south korea': 'kr',
  korea: 'kr',
  'saudi arabia': 'sa',
  qatar: 'qa',
  iran: 'ir',
  nigeria: 'ng',
  senegal: 'sn',
  cameroon: 'cm',
  ivorycoast: 'ci',
  "cote d'ivoire": 'ci',
  "côte d'ivoire": 'ci',
  'ivory coast': 'ci',
  tunisia: 'tn',
  'south africa': 'za',
  uruguay: 'uy',
  chile: 'cl',
  peru: 'pe',
  ecuador: 'ec',
  paraguay: 'py',
  canada: 'ca',
  'costa rica': 'cr',
  panama: 'pa',
  russia: 'ru',
  hungary: 'hu',
  romania: 'ro',
  slovakia: 'sk',
  slovenia: 'si',
  finland: 'fi',
  iceland: 'is',
  wales_uk: 'gb-wls',
  jamaica: 'jm',
  'new zealand': 'nz',
  china: 'cn',
  // 2026 World Cup qualifiers + other national sides seen in feeds
  uzbekistan: 'uz',
  jordan: 'jo',
  'curaçao': 'cw',
  curacao: 'cw',
  haiti: 'ht',
  honduras: 'hn',
  'el salvador': 'sv',
  guatemala: 'gt',
  'trinidad and tobago': 'tt',
  bolivia: 'bo',
  venezuela: 've',
  'united arab emirates': 'ae',
  uae: 'ae',
  iraq: 'iq',
  oman: 'om',
  bahrain: 'bh',
  kuwait: 'kw',
  lebanon: 'lb',
  syria: 'sy',
  palestine: 'ps',
  israel: 'il',
  india: 'in',
  indonesia: 'id',
  malaysia: 'my',
  thailand: 'th',
  vietnam: 'vn',
  'north korea': 'kp',
  'dr congo': 'cd',
  'congo dr': 'cd',
  mali: 'ml',
  'burkina faso': 'bf',
  zambia: 'zm',
  zimbabwe: 'zw',
  kenya: 'ke',
  uganda: 'ug',
  tanzania: 'tz',
  angola: 'ao',
  mozambique: 'mz',
  gabon: 'ga',
  benin: 'bj',
  togo: 'tg',
  guinea: 'gn',
  'guinea-bissau': 'gw',
  'equatorial guinea': 'gq',
  gambia: 'gm',
  libya: 'ly',
  sudan: 'sd',
  ethiopia: 'et',
  madagascar: 'mg',
  mauritania: 'mr',
  niger: 'ne',
  rwanda: 'rw',
  albania: 'al',
  'bosnia and herzegovina': 'ba',
  bosnia: 'ba',
  bulgaria: 'bg',
  cyprus: 'cy',
  estonia: 'ee',
  georgia: 'ge',
  kosovo: 'xk',
  latvia: 'lv',
  lithuania: 'lt',
  luxembourg: 'lu',
  malta: 'mt',
  moldova: 'md',
  montenegro: 'me',
  'north macedonia': 'mk',
  armenia: 'am',
  azerbaijan: 'az',
  kazakhstan: 'kz',
  belarus: 'by',
  'faroe islands': 'fo',
  gibraltar: 'gi',
  andorra: 'ad',
  'san marino': 'sm',
  liechtenstein: 'li',
}

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

/**
 * FlagBadge — a compact circular identity mark for a team or nation. Tries,
 * in order: an explicit `logoUrl`, a country flag (flagcdn) when the country
 * resolves, then a monogram fallback. The onError chain steps forward through
 * these options so a broken image never leaves an empty box.
 */
export function FlagBadge({
  country,
  teamName,
  logoUrl,
  size = 24,
}: FlagBadgeProps) {
  const iso2 = country ? COUNTRY_ISO2[country.trim().toLowerCase()] : undefined
  const flagUrl = iso2 ? `https://flagcdn.com/w40/${iso2}.png` : undefined

  const candidates = useMemo(
    () => [logoUrl, flagUrl].filter((u): u is string => Boolean(u)),
    [logoUrl, flagUrl]
  )

  const [failedCount, setFailedCount] = useState(0)
  const src = candidates[failedCount]

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={teamName}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        loading="lazy"
        onError={() => setFailedCount((c) => c + 1)}
      />
    )
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--muted-bg)] font-semibold text-[var(--text-secondary)]'
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-label={teamName}
    >
      {initialFor(teamName)}
    </span>
  )
}
