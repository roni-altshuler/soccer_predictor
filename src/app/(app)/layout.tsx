import { Suspense } from 'react'

import { AppShell } from '@/components/shell'
import { Footer } from '@/components/Footer'
import { PageLoader } from '@/components/PageLoader'
import { StatusBanner } from '@/components/StatusBanner'

/**
 * Layout for the functional product surfaces (Match Centre, Predict, Accuracy,
 * Simulator, …). Everything here is wrapped in the <AppShell> chrome — the
 * fixed sidebar rail, glass topbar, mobile bottom-nav, and Cmd+K palette.
 *
 * This lives in the `(app)` route group so the `(marketing)` landing page can
 * opt out of the app chrome entirely while sharing the slim root layout
 * (fonts, <html class="dark">, AuthProvider, skip-link). Route groups don't
 * affect URLs — these pages keep their original paths (`/`, `/predict`, …).
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <StatusBanner />
      <Suspense fallback={null}>
        <PageLoader />
      </Suspense>
      <AppShell footer={<div className="hidden md:block"><Footer /></div>}>
        {children}
      </AppShell>
    </>
  )
}
