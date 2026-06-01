import { Marquee } from '@/components/magicui/marquee'
import { leaguesForGender, type LeagueAccent } from '@/lib/leagueAccents'

/** League chip — accent-tinted pill using the single source of truth for
 *  competition branding (lib/leagueAccents.ts). */
function LeagueChip({ league }: { league: LeagueAccent }) {
  return (
    <div
      className="mx-2 flex shrink-0 items-center gap-2.5 rounded-full border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2"
      style={{ borderColor: league.accentBg }}
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-black"
        style={{ background: league.accentBg, color: league.accent }}
      >
        {league.shortName.slice(0, 1)}
      </span>
      <span className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
        {league.displayName}
      </span>
      <span aria-hidden="true" className="text-sm leading-none">
        {league.flag}
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
          One model · every major competition · men&apos;s &amp; women&apos;s
        </h2>
      </div>

      <div className="relative">
        <Marquee pauseOnHover className="[--duration:40s]">
          {mens.map((l) => (
            <LeagueChip key={l.competitionId} league={l} />
          ))}
        </Marquee>
        <Marquee reverse pauseOnHover className="mt-3 [--duration:36s]">
          {womens.map((l) => (
            <LeagueChip key={l.competitionId} league={l} />
          ))}
        </Marquee>

        {/* Edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[var(--background-secondary)] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[var(--background-secondary)] to-transparent" />
      </div>
    </section>
  )
}
