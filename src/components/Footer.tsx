'use client'

import Link from 'next/link'

export const Footer = () => {
  return (
    <footer className="bg-[var(--card-bg)] border-t border-[var(--border-color)] mt-auto">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-[var(--accent-primary)] flex items-center justify-center">
              <span className="text-sm font-bold text-black">⚽</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-bold text-[var(--text-primary)]">FotPredict</span>
              <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-[var(--accent-ai)] text-white">AI</span>
            </div>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Link href="/matches" className="text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] transition-colors">Leagues</Link>
            <Link href="/predict" className="text-[var(--text-tertiary)] hover:text-[var(--accent-ai)] transition-colors">AI Predict</Link>
            <Link href="/tracking" className="text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] transition-colors">Accuracy</Link>
            <Link href="/news" className="text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] transition-colors">News</Link>
            <Link href="/about" className="text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] transition-colors">About</Link>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-4 pt-4 border-t border-[var(--border-color)] flex flex-col md:flex-row justify-between items-center gap-2">
          <div className="flex flex-col gap-1">
            <p className="text-[10px] text-[var(--text-tertiary)]">
              Powered by{' '}
              <a href="https://www.fotmob.com" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent-primary)] underline underline-offset-2">
                FotMob
              </a>
              {' '}and{' '}
              <a href="https://www.espn.com/soccer/" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent-primary)] underline underline-offset-2">
                ESPN
              </a>
              {' '}match data.
            </p>
            <p className="text-[10px] text-[var(--text-tertiary)]">
            &copy; {new Date().getFullYear()} Ron Oshri Altshuler. All Rights Reserved.
            </p>
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)]">
            ⚠️ For educational and entertainment purposes only.
          </p>
        </div>
      </div>
    </footer>
  )
}
