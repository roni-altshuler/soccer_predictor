import { Marquee } from '@/components/magicui/marquee'
import { FlagBadge } from '@/components/primitives'
import { leaguesForGender, type LeagueAccent } from '@/lib/leagueAccents'

/**
 * ESPN league crests for competitions that don't carry a `logoUrl` in
 * leagueAccents.ts. Every URL verified against ESPN's own scoreboard API
 * (leagues[0].logos) on 2026-07-02 — names matched, all 200 image/png.
 */
const EXTRA_LEAGUE_CRESTS: Record<string, string> = {
  'uefa.champions': 'https://a.espncdn.com/i/leaguelogos/soccer/500/2.png',
  'uefa.europa': 'https://a.espncdn.com/i/leaguelogos/soccer/500/2310.png',
  'uefa.europa.conf': 'https://a.espncdn.com/i/leaguelogos/soccer/500/20296.png',
  'fifa.world': 'https://a.espncdn.com/i/leaguelogos/soccer/500/4.png',
  'uefa.euro': 'https://a.espncdn.com/i/leaguelogos/soccer/500/74.png',
  'conmebol.america': 'https://a.espncdn.com/i/leaguelogos/soccer/500/83.png',
  'eng.1.w': 'https://a.espncdn.com/i/leaguelogos/soccer/500/2314.png',
  'usa.1.w': 'https://a.espncdn.com/i/leaguelogos/soccer/500/2323.png',
  'uefa.champions.w': 'https://a.espncdn.com/i/leaguelogos/soccer/500/2408.png',
  'uefa.euro.w': 'https://a.espncdn.com/i/leaguelogos/soccer/500/2381.png',
  'fifa.world.w': 'https://a.espncdn.com/i/leaguelogos/soccer/500/60.png',
}

/** League chip — real crest (FlagBadge chain: crest → country flag →
 *  monogram) + name. No emoji (rule 1), no letter avatars (rule 2).
 *  Non-interactive on purpose: the marquee repeats its children, so
 *  focusable chips would spam the tab order. min-h keeps ≥40px rhythm. */
function MarqueeLeagueChip({ league }: { league: LeagueAccent }) {
  return (
    <div
      className="mx-2 flex min-h-[40px] shrink-0 items-center gap-2.5 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2"
      style={{ borderColor: league.accentBg }}
    >
      <FlagBadge
        teamName={league.displayName}
        country={league.country}
        logoUrl={league.logoUrl ?? EXTRA_LEAGUE_CRESTS[league.competitionId]}
        size={22}
      />
      <span className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
        {league.displayName}
      </span>
    </div>
  )
}

/**
 * Coverage trust-bar. Two marquees (men's then women's) of accent-tinted
 * league chips, scrolling in opposite directions. Pauses on hover and
 * respects reduced-motion (global CSS neutralizes the marquee animation).
 */
export function CoverageMarquee() {
  const mens = leaguesForGender('M')
  const womens = leaguesForGender('F')

  return (
    <section
      aria-labelledby="coverage-heading"
      className="relative overflow-hidden border-y border-[var(--border-color)] bg-[var(--background-secondary)] py-10"
    >
      <div className="mx-auto mb-6 max-w-[var(--shell-content-max)] px-5 text-center sm:px-8">
        <h2 id="coverage-heading" className="mkt-eyebrow">
          One engine · every major competition · men&apos;s &amp; women&apos;s
        </h2>
      </div>

      <div className="relative">
        <Marquee pauseOnHover className="[--duration:40s]">
          {mens.map((l) => (
            <MarqueeLeagueChip key={l.competitionId} league={l} />
          ))}
        </Marquee>
        <Marquee reverse pauseOnHover className="mt-3 [--duration:36s]">
          {womens.map((l) => (
            <MarqueeLeagueChip key={l.competitionId} league={l} />
          ))}
        </Marquee>

        {/* Edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[var(--background-secondary)] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[var(--background-secondary)] to-transparent" />
      </div>
    </section>
  )
}
