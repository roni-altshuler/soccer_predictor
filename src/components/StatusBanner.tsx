'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Status = 'ok' | 'degraded' | 'down'

interface HealthPayload {
  status: Status
}

const POLL_INTERVAL_MS = 60_000
const DISMISS_KEY = 'fotpredict:status-banner-dismissed'

// /diagnostics is shipped today (see src/app/diagnostics/page.tsx) — we still
// guard against it being removed by feature-flagging the link via a constant.
const DIAGNOSTICS_HREF = '/diagnostics'

export function StatusBanner() {
  const [status, setStatus] = useState<Status | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(window.sessionStorage.getItem(DISMISS_KEY) === '1')
    }

    let cancelled = false
    const poll = async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' })
        // 503 still returns JSON; only bail on opaque/network errors.
        const data = (await response.json()) as HealthPayload
        if (!cancelled && data && typeof data.status === 'string') {
          setStatus(data.status)
        }
      } catch {
        // Network failures usually mean the API itself is unreachable — treat
        // as "down" so users get the strongest signal.
        if (!cancelled) setStatus('down')
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (!status || status === 'ok') return null
  if (status === 'degraded' && dismissed) return null

  const isDown = status === 'down'
  const background = isDown ? '#ef4444' : '#f59e0b'
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
