'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Status = 'ok' | 'degraded' | 'down'

interface HealthPayload {
  status: Status
}

const POLL_INTERVAL_MS = 60_000
const DISMISS_KEY = 'pitchwise:status-banner-dismissed'
const DIAGNOSTICS_HREF = '/diagnostics'

/**
 * Production health banner — env-gated. Polls /api/health when
 * `NEXT_PUBLIC_ENABLE_HEALTH_CHECK=true`; silent otherwise.
 *
 * Why the gate: /api/health reports 'down' if DB or model-artifact checks
 * fail. On Vercel deploys where the FastAPI backend isn't running and the
 * .pt model files are gitignored, those checks fail by design — turning
 * the banner into a permanent red false alarm. Flip the flag only after
 * the live infrastructure makes /api/health trustworthy.
 *
 * Network errors from /api/health itself are NOT treated as 'down' — if
 * the route is unreachable that's a build-config issue, not a runtime
 * outage worth showing to end users.
 */
export function StatusBanner() {
  const [status, setStatus] = useState<Status | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const enabled = process.env.NEXT_PUBLIC_ENABLE_HEALTH_CHECK === 'true'

  useEffect(() => {
    if (!enabled) return

    if (typeof window !== 'undefined') {
      setDismissed(window.sessionStorage.getItem(DISMISS_KEY) === '1')
    }

    let cancelled = false
    const poll = async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        // 503 still returns JSON; parse and trust the explicit status.
        const data = (await response.json()) as HealthPayload
        if (!cancelled && data && typeof data.status === 'string') {
          setStatus(data.status)
        }
      } catch {
        // Silent — see component-level comment.
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [enabled])

  if (!enabled) return null
  if (!status || status === 'ok') return null
  if (status === 'degraded' && dismissed) return null

  const isDown = status === 'down'
  const background = isDown ? 'var(--accent-loss)' : 'var(--accent-warn)'
  const message = isDown
    ? 'Service is temporarily unavailable — some features may not work.'
    : 'Live predictions are catching up...'

  const handleDismiss = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DISMISS_KEY, '1')
    }
    setDismissed(true)
  }

  return (
    <div
      role={isDown ? 'alert' : 'status'}
      aria-live={isDown ? 'assertive' : 'polite'}
      className="sticky top-0 z-50 w-full text-white shadow-sm"
      style={{ backgroundColor: background }}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-1.5 text-[12px] sm:text-[13px] font-medium">
        <span className="flex-1 truncate">{message}</span>
        <Link
          href={DIAGNOSTICS_HREF}
          className="shrink-0 underline underline-offset-2 opacity-90 hover:opacity-100"
        >
          details
        </Link>
        {!isDown && (
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss status notice"
            className="shrink-0 rounded px-1.5 py-0.5 text-white/90 hover:bg-black/10 hover:text-white"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export default StatusBanner
