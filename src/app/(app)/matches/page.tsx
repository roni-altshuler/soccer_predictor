import { redirect } from 'next/navigation'

/**
 * Superseded surface — this was a near-clone of Today (`/`) with a league
 * chip row, reachable only from the match-detail error screen. One scores
 * surface, not two.
 */
export default function MatchesRedirect() {
  redirect('/')
}
