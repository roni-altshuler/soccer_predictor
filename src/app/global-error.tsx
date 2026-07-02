'use client'

import { useEffect } from 'react'

/**
 * Last-resort boundary: catches errors thrown by the root layout itself.
 * Must render its own <html>/<body> because the root layout has crashed,
 * so styles are inlined rather than relying on globals.css.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global error]', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b1220',
          color: '#e7ecf5',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: 420 }}>
          <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚽</p>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>
            Pitchwise hit an unexpected error
          </h1>
          <p style={{ fontSize: '0.875rem', opacity: 0.7, margin: '0 0 1.25rem' }}>
            Reload to get back to the Match Centre. If this keeps happening,
            please try again in a few minutes.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: '0.5rem 1.25rem',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.2)',
              background: '#16a34a',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
