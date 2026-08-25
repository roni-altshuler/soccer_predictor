import { AppShell } from '@/components/shell'

/**
 * Layout for the product surfaces. Everything is wrapped in the <AppShell>
 * chrome — fixed sidebar rail (desktop), topbar, mobile bottom tab bar.
 * The `(app)` route group keeps original paths (`/`, `/leagues`, …).
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AppShell>{children}</AppShell>
}
