import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import TrackingCenter from '@/components/tracking/TrackingCenter'

/**
 * Smoke tests for the diagnostics surface. /diagnostics is a server
 * component (no 'use client'), so we test the client child it composes —
 * TrackingCenter — directly. That's where every interactive widget lives
 * (the page wrapper is just a hero + the embedded TrackingCenter + a
 * static "continuous learning pipeline" section).
 */

beforeEach(() => {
  // Every /api/v1/tracking/* endpoint is stubbed to return an empty,
  // type-shaped payload so the component runs through its data-flow paths
  // without crashing.
  const emptyAccuracySummary = {
    overall: {
      winner_accuracy: 0,
      brier_score: 0,
      expected_calibration_error: 0,
      completed_predictions: 0,
      pending_predictions: 0,
    },
  }
  const emptyDiagnostics = { top_alerts: [], leagues: {} }
  const emptyStatus = {
    total_completed: 0,
    total_pending: 0,
    outcomes_since_retrain: 0,
    retrain_threshold: 50,
  }
  const emptyModelInfo = {
    summary: { total_leagues: 0, neural_ensemble_count: 0 },
  }

  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    let body: object = {}
    if (url.includes('/accuracy/summary')) body = emptyAccuracySummary
    else if (url.includes('/diagnostics')) body = emptyDiagnostics
    else if (url.includes('/outcome-status')) body = emptyStatus
    else if (url.includes('/model-info')) body = emptyModelInfo
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('TrackingCenter (diagnostics page body)', () => {
  it('mounts without crashing and shows the diagnostics hub header', async () => {
    render(<TrackingCenter initialView="diagnostics" />)
    expect(
      screen.getByText(/Diagnostics hub/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: /Accuracy, Diagnostics, and Learning/i,
      }),
    ).toBeInTheDocument()
  })

  it('renders all 4 view tabs with proper role + aria-selected on the initial view', () => {
    render(<TrackingCenter initialView="diagnostics" />)
    const tablist = screen.getByRole('tablist', { name: /Diagnostics views/i })
    expect(tablist).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(4)
    const diagnostics = screen.getByRole('tab', { name: /Diagnostics \+ Drift/i })
    expect(diagnostics).toHaveAttribute('aria-selected', 'true')
  })

  it('switches the active panel when a different view tab is clicked', async () => {
    render(<TrackingCenter initialView="diagnostics" />)
    const learningTab = screen.getByRole('tab', { name: /League Learning Loop/i })
    fireEvent.click(learningTab)
    await waitFor(() =>
      expect(learningTab).toHaveAttribute('aria-selected', 'true'),
    )
    // After switching, the learning-panel content ("League adaptation"
    // SectionHeader in the Broadcast redesign) should be in the document.
    expect(
      screen.getByRole('heading', { name: /League adaptation/i }),
    ).toBeInTheDocument()
  })

  it('exposes role=tabpanel on the active view container', async () => {
    render(<TrackingCenter initialView="learning" />)
    const panel = document.getElementById('tracking-panel-learning')
    expect(panel).toBeTruthy()
    expect(panel).toHaveAttribute('role', 'tabpanel')
  })

  it('shows the online-learning progress bar with sensible defaults', () => {
    render(<TrackingCenter initialView="overview" />)
    expect(
      screen.getByText(/Online learning cycle progress/i),
    ).toBeInTheDocument()
    // With outcomes_since_retrain=0 and threshold=50, the label shows "0/50".
    expect(screen.getByText(/0\/50 outcomes toward/i)).toBeInTheDocument()
  })
})
