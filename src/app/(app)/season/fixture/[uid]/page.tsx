import { redirect } from 'next/navigation'

/**
 * Superseded surface — the forecast fixture card lives on `/matches/[id]`
 * (the shared MatchDetail renders on every match surface), and the only page
 * that ever linked here (`/season`) is itself redirected. A forecast uid
 * cannot be mapped to an ESPN event id here without the name-and-date join,
 * so old deep links land on the league directory rather than a wrong match.
 */
export default function SeasonFixtureRedirect() {
  redirect('/leagues')
}
