'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { DOCS, docsUrl, type DocKey } from '@/lib/docs'
import { cn } from '@/lib/utils'

/**
 * "Learn more" — the one shape a documentation link takes here.
 *
 * Every page that used to carry an explanation now carries one of these
 * instead. Keeping it a single component is what stops the site drifting back:
 * a link that is styled per page invites a sentence of context per page, and a
 * sentence of context per page is the wall of methodology prose these links
 * replaced.
 *
 * These stay in-app now — `/docs` renders the same handbook files that used
 * to require a trip to github.com, so following one no longer costs the
 * reader their place in the product.
 */
export function DocsLink({
  doc,
  hash,
  label,
  className,
}: {
  doc: DocKey
  /** Heading anchor inside the document, as GitHub generates it. */
  hash?: string
  /** Defaults to the document's own title. */
  label?: string
  className?: string
}) {
  return (
    <Link
      href={docsUrl(doc, hash)}
      className={cn(
        'inline-flex items-baseline gap-0.5 font-mono text-[11px] uppercase tracking-[0.08em]',
        'text-[var(--text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--accent-primary)] hover:underline',
        className,
      )}
    >
      {label ?? DOCS[doc].title}
      <ArrowRight className="h-3 w-3 shrink-0 translate-y-[1px]" aria-hidden="true" />
    </Link>
  )
}

/**
 * A row of documentation links, for the foot of a section.
 *
 * Two or three related documents read as a set rather than as three separate
 * afterthoughts, which is how they were landing when each panel ended with its
 * own single link.
 */
export function DocsRow({
  docs,
  className,
}: {
  docs: Array<{ doc: DocKey; hash?: string; label?: string }>
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {docs.map((d) => (
        <DocsLink key={`${d.doc}-${d.hash ?? ''}`} doc={d.doc} hash={d.hash} label={d.label} />
      ))}
    </div>
  )
}
