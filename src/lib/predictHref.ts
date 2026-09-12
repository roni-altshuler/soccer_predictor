/**
 * The matchup builder's deep link: `/predict?home=&away=&league=`.
 *
 * `/predict` reads these on load, prices the pairing at once and keeps the
 * URL in step as the reader changes it — so a matchup is shareable, and a
 * fixture row or match card can hand a reader straight into a priced one.
 * `league` may be an ESPN competition id (`eng.1`) or a catalog name; the
 * page resolves either.
 */
export function predictHref(home: string, away: string, league?: string | null): string {
  const q = new URLSearchParams({ home, away })
  if (league) q.set('league', league)
  return `/predict?${q.toString()}`
}
