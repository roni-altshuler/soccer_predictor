import { redirect } from 'next/navigation'

/**
 * /tracking used to host the full "Prediction Intelligence Center"
 * dashboard. That content now lives at:
 *
 *   - /accuracy     — public-facing "How accurate is the AI?" view.
 *   - /diagnostics  — engineer-facing audit dashboard.
 *
 * Keeping this redirect so any bookmark or external link still lands
 * somewhere useful instead of 404-ing.
 */
export default function TrackingRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const rawView = searchParams?.view
  const view = Array.isArray(rawView) ? rawView[0] : rawView
  if (view === 'diagnostics' || view === 'learning') {
    redirect(`/diagnostics?view=${view}`)
  }
  redirect('/accuracy')
}

export const metadata = {
  title: 'Tracking | FotPredict AI',
}
