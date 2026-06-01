import { MarketingNav } from '@/components/marketing/MarketingNav'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'

/**
 * Layout for the marketing / flagship landing surfaces. Deliberately does NOT
 * use the app's <AppShell> (no sidebar rail, no topbar, no Cmd+K) — the
 * landing page gets a clean, full-bleed marketing chrome instead. Shares the
 * slim root layout (fonts, dark theme, AuthProvider, skip-link).
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)]">
      <MarketingNav />
      <main id="main" className="flex-1">
        {children}
      </main>
      <MarketingFooter />
    </div>
  )
}
