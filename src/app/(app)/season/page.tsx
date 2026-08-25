import { redirect } from 'next/navigation'

/**
 * Superseded surface — one competition is one destination.
 *
 * The nav consolidation (see SidebarNav) folded the season forecast into the
 * league pages: `/leagues/[id]` carries the projected table, fixtures and
 * simulator that lived here. This page had no inbound link left anywhere in
 * the product; it redirects rather than 404s because old bookmarks exist.
 */
export default function SeasonRedirect() {
  redirect('/leagues')
}
