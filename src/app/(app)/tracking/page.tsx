import { redirect } from 'next/navigation'

/**
 * /tracking used to host the full "Prediction Intelligence Center"
 * dashboard. That content now lives at /accuracy — the public
 * "How accurate is the AI?" view.
 *
 * Keeping this redirect so any bookmark or external link still lands
 * somewhere useful instead of 404-ing.
 */
export default function TrackingRedirect() {
  redirect('/accuracy')
}

export const metadata = {
  title: 'Tracking | Pitchverse',
}
