'use client'

import { type ReactNode } from 'react'

import { TooltipProvider } from '@/components/ui/tooltip'

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
      <SidebarNav />
      <div
        className="ambient-bg flex min-h-screen flex-col md:pl-[var(--shell-sidebar-w)]"
      >
        <TopBar />
        <main id="main" className="flex-1 pb-24 md:pb-0">
          {children}
        </main>
        {footer}
      </div>
      <MobileBottomNav />
      <CommandPalette />
    </TooltipProvider>
  )
}
