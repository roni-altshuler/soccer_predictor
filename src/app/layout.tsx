import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { AuthProvider } from '@/contexts/AuthContext'
import './globals.css'

// Single typeface — Inter — wired into both the sans & display CSS variables
// referenced by tailwind.config.js (`font-sans`, `font-display`) and globals.css.
// Legacy `--font-body` / `--font-heading` are kept as aliases so older
// components that hard-coded them keep rendering during the transition.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
})

// JetBrains Mono — used only for tabular scoreboard digits, minute counters,
// and other monospaced numerics. Exposed as `--font-mono-numeric` and accessible
// via the `font-numeric` Tailwind family (configured in tailwind.config.js).
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-numeric',
  display: 'swap',
  weight: ['500', '700'],
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pitchverse.vercel.app'

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
  // Matches --background. The old value was the retired navy theme, so the
  // browser chrome around the app disagreed with the app.
  themeColor: '#000000',
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
      className={`dark ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* Alias the legacy --font-body/--font-heading vars to Inter so any
            older inline styles or third-party CSS keeps working. */}
        <style>{`:root { --font-body: var(--font-sans); --font-heading: var(--font-sans); --font-display: var(--font-sans); }`}</style>
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