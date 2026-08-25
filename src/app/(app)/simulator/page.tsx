import { redirect } from 'next/navigation'

/**
 * Superseded surface — the Monte Carlo simulator and the what-if lab are the
 * Simulator tab of every league page (`/leagues/[id]`), which is where the
 * nav consolidation put them. This standalone copy was reachable only from
 * the desktop-only footer, so it was invisible on mobile entirely.
 */
export default function SimulatorRedirect() {
  redirect('/leagues')
}
