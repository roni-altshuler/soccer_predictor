import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { PageLoader } from '@/components/PageLoader'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { AuthProvider } from '@/contexts/AuthContext'
import './globals.css'

export const metadata: Metadata = {
  title: 'FotPredict AI — Live Scores & AI Match Predictions',
  description: 'AI-powered soccer predictions with live scores, league tracking, and match analysis across 11 top leagues.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'FotPredict AI',
  },
  icons: {
    icon: '/soccer-ball.png',
    apple: '/icons/icon-192x192.png',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
  },
  themeColor: '#00c853',
}

// Script to prevent flash of wrong theme - default to dark like Fotmob
const themeScript = `
  (function() {
    const stored = localStorage.getItem('theme');
    if (stored === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  })();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-[var(--background)] text-[var(--text-primary)] font-sans antialiased">
        <ThemeProvider>
          <AuthProvider>
            <Suspense fallback={null}>
              <PageLoader />
            </Suspense>
            <div className="flex flex-col min-h-screen">
              <Navbar />
              <main className="flex-grow pb-20 md:pb-0">
                {children}
              </main>
              <div className="hidden md:block">
                <Footer />
              </div>
            </div>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}