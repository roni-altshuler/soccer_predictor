'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

interface SectionErrorBoundaryProps {
  children: ReactNode
  /** Short label for what failed, e.g. "match predictions" */
  section?: string
  /** Optional refetch to run alongside the boundary reset */
  onRetry?: () => void
  className?: string
}

interface SectionErrorBoundaryState {
  hasError: boolean
}

/**
 * Catches render/runtime errors inside one section of a page so a
 * single failing widget can't blank the whole surface. Shows a compact,
 * token-styled fallback with a retry affordance.
 */
export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): SectionErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[SectionErrorBoundary${this.props.section ? `:${this.props.section}` : ''}]`, error, info.componentStack)
  }

  private handleRetry = () => {
    this.props.onRetry?.()
    this.setState({ hasError: false })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { section, className } = this.props
    return (
      <div
        role="alert"
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-6 py-8 text-center ${className ?? ''}`}
      >
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {section ? `Couldn’t load ${section}` : 'Something went wrong here'}
        </p>
        <p className="max-w-xs text-xs text-[var(--text-tertiary)]">
          The rest of the page is unaffected. Try again — if this keeps
          happening the data source may be briefly unavailable.
        </p>
        <button
          type="button"
          onClick={this.handleRetry}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      </div>
    )
  }
}

export default SectionErrorBoundary
