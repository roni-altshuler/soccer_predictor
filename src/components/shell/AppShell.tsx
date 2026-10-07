'use client'

import { type ReactNode } from 'react'
import { usePathname } from 'next/navigation'

import { TooltipProvider } from '@/components/ui/tooltip'
import { PageTransition } from '@/components/motion'
import { PitchBackdrop } from '@/components/PitchBackdrop'
import { useNavDepthTracker } from '@/lib/useSmartBack'

import { MobileBottomNav } from './MobileBottomNav'
import { SidebarNav } from './SidebarNav'
import { TopBar } from './TopBar'

/**
 * Top-level layout shell:
 *   - Fixed 220px sidebar with always-visible labels (desktop)
 *   - Topbar with the brand mark (mobile) and the account control
 *   - Fixed bottom tab bar (mobile)
 *
 * There is no global search, no command palette and no footer — the sidebar's
 * bottom block carries the one disclaimer line, same as the sibling apps.
 * Children render the page contents; the shell leaves left padding for the
 * sidebar on desktop and bottom padding for the tab bar on mobile.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // Counts in-app navigations so detail-page back controls can distinguish
  // "came from inside the app" from "landed on a deep link".
  useNavDepthTracker()
  const pathname = usePathname() || '/'
  const matchFlow = pathname === '/' || pathname.startsWith('/matches/')
  const neutralFlow = matchFlow || (pathname.startsWith('/leagues/') && pathname.endsWith('/compare'))

  return (
    // Single app-wide TooltipProvider so any <Tooltip> downstream works
    // without ceremony. Nested providers (CalibrationPlot, ConfidenceIndicator,
    // FactorsPanel) are harmless per Radix docs.
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      <div className={neutralFlow ? 'match-flow-shell' : undefined}>
        {!neutralFlow && <PitchBackdrop />}
        <SidebarNav matchFlow={neutralFlow} />
        <div className="flex min-h-screen flex-col md:pl-[var(--shell-sidebar-w)]">
          <TopBar matchFlow={neutralFlow} />
          <main id="main" className="flex-1 pb-20 md:pb-0">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <MobileBottomNav matchFlow={neutralFlow} />
      </div>
    </TooltipProvider>
  )
}
