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
              <span className="text-sm font-bold text-[var(--text-primary)]">Pitchverse</span>
              <span className="text-[10px] text-[var(--text-tertiary)]">Calibrated football intelligence</span>
            </div>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
            <Link href="/leagues" className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] hover:border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] transition-colors">Leagues</Link>
            <Link href="/predict" className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--accent-ai)] hover:border-[color-mix(in_srgb,var(--accent-ai)_40%,transparent)] transition-colors">AI Predict</Link>
            <Link href="/accuracy" className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] hover:border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] transition-colors">Accuracy</Link>
            <Link href="/simulator" className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] hover:border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] transition-colors">Title &amp; Relegation</Link>
            <Link href="/about" className="px-2.5 py-1 rounded-full border border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] hover:border-[color-mix(in_srgb,var(--accent-primary)_40%,transparent)] transition-colors">How it works</Link>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-4 pt-4 border-t border-[var(--border-color)] flex flex-col md:flex-row justify-between items-center gap-2">
          <p className="text-[10px] text-[var(--text-tertiary)]">
            &copy; {new Date().getFullYear()} Ron Oshri Altshuler. All Rights Reserved.
          </p>
          {/* The old "educational and entertainment purposes only" line was
              retired with the pivot (docs/PIVOT_2026-08.md): the product now
              shows model probability against the market, so pretending it is
              not decision-relevant would be the dishonest option. What
              replaces it is the measured position — the model trails the
              closing line — with a link to the page that proves it. */}
          <p className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Probability estimates, not advice. Every pick is{' '}
            <Link href="/accuracy" className="underline underline-offset-2 hover:text-[var(--text-secondary)]">
              scored against the closing line
            </Link>
            .
          </p>
        </div>
      </div>
    </footer>
  )
}
