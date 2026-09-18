import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/contexts/AuthContext'
import './globals.css'

// Native font stacks keep builds and first paint independent of font CDNs.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pitchverse.vercel.app'

// The reader's ambient preference (soft · vivid · off), applied to <html>
// BEFORE first paint so a reader who turned the pitch off never sees it
// flash on. Blocking on purpose and tiny (~170 bytes); the key and the
// states are defined in src/lib/ambient.ts — keep them in step.
const AMBIENT_BOOT =
  "(function(){var d=document.documentElement,v='soft';try{var s=localStorage.getItem('pitchverse-ambient');if(s==='vivid'||s==='off')v=s}catch(e){}d.dataset.ambient=v})()"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Pitchverse — Calibrated football intelligence',
    template: '%s · Pitchverse',
  },
  description:
    'Calibrated football intelligence across the world\'s leagues. Live scores, AI match probabilities, and accuracy tracking you can verify.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Pitchverse',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    siteName: 'Pitchverse',
    title: 'Pitchverse — Calibrated football intelligence',
    description:
      'Calibrated football intelligence across the world\'s leagues. Live scores, AI match probabilities, and accuracy tracking.',
    url: siteUrl,
    images: [
      {
        url: '/brand/og-default.png',
        width: 1200,
        height: 630,
        alt: 'Pitchverse',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pitchverse — Calibrated football intelligence',
    description: 'Calibrated AI football predictions for the world\'s top leagues.',
    images: ['/brand/og-default.png'],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // Matches --background (Floodlight night-pitch green).
  themeColor: '#071009',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="dark"
      data-ambient="soft"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: AMBIENT_BOOT }} />
        {/* Alias the legacy --font-body/--font-heading vars so any
            older inline styles or third-party CSS keeps working. */}
        <style>{`:root { --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --font-mono-numeric: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; --font-body: var(--font-sans); --font-heading: var(--font-sans); --font-display: var(--font-sans); }`}</style>
      </head>
      <body className="min-h-screen bg-[var(--background)] text-[var(--text-primary)] antialiased font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-[var(--card-bg)] focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg"
        >
          Skip to main content
        </a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}