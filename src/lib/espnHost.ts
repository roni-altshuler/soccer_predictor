/**
 * The one place the ESPN host is named.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every live surface in the app — standings, scoreboards, the season
 * simulation, team pages — reads ESPN's public JSON. Two of ESPN's edge hosts
 * serve byte-identical payloads for the same paths, and they behave very
 * differently:
 *
 *   site.api.espn.com      403 Access Denied (Akamai) from datacentre IPs,
 *                          and its error page carries no CORS headers, so a
 *                          browser fetch dies with `net::ERR_FAILED`.
 *   site.web.api.espn.com  200, and returns `access-control-allow-origin: *`.
 *
 * Measured 2026-08-08: every `site.api` request from this machine and every
 * browser-side `site.api` request returned 403 / blocked-by-CORS, while the
 * identical path on `site.web.api` returned 200. Server-side that took out the
 * whole season simulation ("Simulation unavailable"); client-side it took out
 * live standings, fixtures and recent results on all five league pages.
 *
 * So: import from here, never hardcode a host. If ESPN moves again, one edit
 * fixes every caller instead of twenty-eight.
 */

/** `/apis/site/v2/...` — scoreboards, summaries, teams, news, statistics. */
export const ESPN_SITE = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer'

/** `/apis/v2/...` — league standings (a different prefix on the same host). */
export const ESPN_V2 = 'https://site.web.api.espn.com/apis/v2/sports/soccer'

/**
 * ESPN rejects requests with no browser-ish User-Agent. Server-side callers
 * must send these; browser callers must not (the browser sets them itself and
 * a custom header would force a CORS preflight ESPN does not answer).
 */
export const ESPN_SERVER_HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
} as const
