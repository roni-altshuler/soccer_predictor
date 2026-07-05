import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Match Centre', href: '/' },
      { label: 'AI Predict', href: '/predict' },
      { label: 'Accuracy', href: '/accuracy' },
      { label: 'Championship Simulator', href: '/simulator' },
      { label: 'Prediction history', href: '/history' },
    ],
  },
  {
    heading: 'Explore',
    links: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Features', href: '#features' },
      { label: 'Live demo', href: '#prediction-demo' },
      { label: 'Technology', href: '#technology' },
    ],
  },
  {
    heading: 'About',
    links: [
      { label: 'The project', href: '/about' },
      { label: 'Diagnostics', href: '/diagnostics' },
      { label: 'News', href: '/news' },
    ],
  },
]

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--border-color)] bg-[var(--background-secondary)]">
      <div className="mx-auto w-full max-w-[var(--shell-content-max)] px-5 py-14 sm:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          {/* Brand block */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/welcome" className="inline-flex min-h-[44px] items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent-ai)] to-[var(--accent-primary)] text-[var(--accent-on-primary)]">
                <span className="text-sm font-black">P</span>
              </span>
              <span className="text-[15px] font-extrabold tracking-tight text-[var(--text-primary)]">
                Pitchwise
              </span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--text-tertiary)]">
              Calibrated football intelligence — live scores, AI match probabilities, and
              accuracy you can verify, for the men&apos;s and women&apos;s game.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="mkt-eyebrow">{col.heading}</p>
              <ul className="mt-1.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {/* min-h keeps every footer link a ≥40px touch target (rule 7) */}
                    <Link
                      href={link.href}
                      className="inline-flex min-h-[40px] items-center text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--accent-primary)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Disclaimer + legal */}
        <div className="mt-12 flex flex-col gap-4 border-t border-[var(--border-color)] pt-6">
          <div className="flex items-start gap-2.5 text-xs leading-relaxed text-[var(--text-tertiary)]">
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-warn)]"
              aria-hidden="true"
            />
            <p className="max-w-3xl">
              Pitchwise is a personal, educational research project for visualising calibrated
              football probabilities. It is <strong className="text-[var(--text-secondary)]">not a betting product</strong> and its
              outputs must not be used for betting or any financial decision. Even a
              well-calibrated model loses regularly.
            </p>
          </div>
          <p className="text-xs text-[var(--text-tertiary)]">
            © {2026} Pitchwise · Calibrated football intelligence
          </p>
        </div>
      </div>
    </footer>
  )
}
