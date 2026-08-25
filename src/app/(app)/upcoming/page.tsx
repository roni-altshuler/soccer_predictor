import { redirect } from 'next/navigation'

/**
 * Superseded surface — zero inbound links anywhere in the product. Today
 * (`/`) shows what is on with the date strip, and each league page carries
 * its own fixture list.
 */
export default function UpcomingRedirect() {
  redirect('/')
}
