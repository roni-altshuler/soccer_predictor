'use client'

import { type ReactNode } from 'react'

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

  return (
    // Single app-wide TooltipProvider so any <Tooltip> downstream works
    // without ceremony. Nested providers (CalibrationPlot, ConfidenceIndicator,
    // FactorsPanel) are harmless per Radix docs.
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      <PitchBackdrop />
      <SidebarNav />
      {/* No background on the column — body paints --background and the
          pitch backdrop sits between it and the content (z-index -1). An
          opaque column here would blank the one ambient layer the app has. */}
      <div className="flex min-h-screen flex-col md:pl-[var(--shell-sidebar-w)]">
        <TopBar />
        <main id="main" className="flex-1 pb-20 md:pb-0">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <MobileBottomNav />
    </TooltipProvider>
  )
}
