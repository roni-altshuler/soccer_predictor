import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Diagnostics | FotPredict AI',
  description: 'Diagnostics moved into the unified Tracking center.',
}

export default function DiagnosticsPage() {
  redirect('/tracking?view=diagnostics')
}
