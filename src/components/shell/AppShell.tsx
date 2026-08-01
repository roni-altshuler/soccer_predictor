'use client'

import { type ReactNode } from 'react'

import { TooltipProvider } from '@/components/ui/tooltip'
import { AskRail } from '@/components/companion/AskRail'
import { CompanionProvider } from '@/components/companion/CompanionProvider'
import { PageTransition } from '@/components/motion'

import { CommandPalette } from './CommandPalette'
import { MobileBottomNav } from './MobileBottomNav'
import { SidebarNav } from './SidebarNav'
import { TopBar } from './TopBar'

/**
 * Top-level layout shell. Provides:
 *   - Fixed icon-rail sidebar (desktop) that expands on hover
 *   - Glass topbar with global search trigger + auth controls
 *   - Mobile bottom-nav (with Search action that opens the palette)
 *   - Cmd+K / Ctrl+K / "/" command palette (mounted globally)
 *
 * Children should render the page contents — the shell itself takes care
 * of leaving enough left padding on desktop for the sidebar.
 */
export function AppShell({
  children,
  footer,
}: {
  children: ReactNode
  /** Optional footer rendered below main, still inside the right-of-sidebar column. */
  footer?: ReactNode
}) {
  return (
    // Single app-wide TooltipProvider so any <Tooltip> downstream works
    // without ceremony. Nested providers (CalibrationPlot, ConfidenceIndicator,
    // FactorsPanel) are harmless per Radix docs.
    <TooltipProvider delayDuration={200} skipDelayDuration={400}>
      <CompanionProvider>
        <SidebarNav />
        <div
          // The rail is docked from xl, so the content column reserves its
          // width there and reclaims it below — the data grid keeps its
          // density on laptops rather than being squeezed by chrome.
          className="flex min-h-screen flex-col bg-[var(--background)] md:pl-[var(--shell-sidebar-w)] xl:pr-[var(--shell-rail-w)]"
        >
          <TopBar />
          <main id="main" className="flex-1 pb-20 md:pb-0">
            <PageTransition>{children}</PageTransition>
          </main>
          {footer}
        </div>
        <MobileBottomNav />
        <CommandPalette />
        <AskRail />
      </CompanionProvider>
    </TooltipProvider>
  )
}
