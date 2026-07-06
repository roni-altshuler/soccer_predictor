'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export const Footer = () => {
  return (
    <footer className="mt-auto border-t border-[var(--border-color)] bg-[var(--nav-bg)] backdrop-blur">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-mark.svg" alt="" width={28} height={28} className="h-7 w-7" />
            <div className="flex flex-col">
              <span className="text-sm font-bold text-[var(--text-primary)]">Pitchwise</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">Calibrated football intelligence</span>
            </div>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
            <Link href="/leagues" className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] hover:border-[var(--accent-primary)]/40 transition-colors">Leagues</Link>
            <Link href="/predict" className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--accent-ai)] hover:border-[var(--accent-ai)]/40 transition-colors">AI Predict</Link>
            <Link href="/tracking" className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] hover:border-[var(--accent-primary)]/40 transition-colors">Accuracy</Link>
            <Link href="/news" className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] hover:border-[var(--accent-primary)]/40 transition-colors">News</Link>
            <Link href="/about" className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] hover:border-[var(--accent-primary)]/40 transition-colors">About</Link>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-4 pt-4 border-t border-[var(--border-color)] flex flex-col md:flex-row justify-between items-center gap-2">
          <p className="text-[10px] text-[var(--text-tertiary)]">
            &copy; {new Date().getFullYear()} Ron Oshri Altshuler. All Rights Reserved.
          </p>
          <p className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            For educational and entertainment purposes only.
          </p>
        </div>
      </div>
    </footer>
  )
}
