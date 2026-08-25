import fs from 'fs'
import path from 'path'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'

import { DOCS, docsRoute } from '@/lib/docs'

/**
 * The handbook, rendered in-app.
 *
 * Every "learn more" used to eject the reader onto github.com — raw markdown,
 * another tab, no way back into the product. The files are unchanged and the
 * GitHub anchors still resolve (rehype-slug uses GitHub's slugger); this
 * route just keeps the reader on the site. Rendering happens at build time
 * (`force-static` + `dynamicParams = false`), so there is no runtime
 * filesystem access and no serverless tracing to configure.
 */

const HANDBOOK_ROOT = path.join(process.cwd(), 'docs', 'handbook')

export const dynamic = 'force-static'
export const dynamicParams = false

function walkMarkdown(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkMarkdown(full))
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

export function generateStaticParams() {
  return walkMarkdown(HANDBOOK_ROOT).map((file) => {
    const rel = path
      .relative(HANDBOOK_ROOT, file)
      .split(path.sep)
      .join('/')
      .replace(/\.md$/, '')
    return { slug: rel === 'README' ? [] : rel.split('/') }
  })
}

/** Slug segments → absolute file path, refusing anything outside the root. */
function resolveDoc(slug: string[] | undefined): string | null {
  const rel = slug && slug.length > 0 ? slug.join('/') : 'README'
  if (rel.includes('..')) return null
  const full = path.join(HANDBOOK_ROOT, `${rel}.md`)
  if (!full.startsWith(HANDBOOK_ROOT)) return null
  return fs.existsSync(full) ? full : null
}

/**
 * Handbook documents cross-link each other with relative `.md` hrefs, which
 * is right for GitHub. Rewrite them onto this route; leave true URLs alone.
 */
function rewriteHref(href: string, currentDir: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href
  const [target, hash] = href.split('#')
  if (!target.endsWith('.md')) return href
  const resolved = path.posix.normalize(path.posix.join(currentDir, target))
  return `${docsRoute(`docs/handbook/${resolved}`)}${hash ? `#${hash}` : ''}`
}

const PROSE = {
  h2: 'mt-10 text-[15px] font-semibold text-[var(--text-primary)]',
  h3: 'mt-8 text-[13px] font-semibold text-[var(--text-primary)]',
  p: 'mt-3 text-[13px] leading-relaxed text-[var(--text-secondary)]',
  li: 'text-[13px] leading-relaxed text-[var(--text-secondary)]',
} as const

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}) {
  const { slug } = await params
  const file = resolveDoc(slug)
  if (!file) notFound()

  const markdown = fs.readFileSync(file, 'utf8')
  const currentDir = path.posix.dirname(
    path.relative(HANDBOOK_ROOT, file).split(path.sep).join('/'),
  )
  const isIndex = !slug || slug.length === 0

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        {!isIndex && (
          <Link
            href="/docs"
            className="-ml-1 inline-flex min-h-[36px] items-center px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            ← Handbook
          </Link>
        )}
      </header>

      <article>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSlug]}
          components={{
            h1: ({ children, ...props }) => (
              <h1 {...props} className="text-[22px] font-semibold text-[var(--text-primary)] md:text-[26px]">
                {children}
              </h1>
            ),
            h2: ({ children, ...props }) => (
              <h2 {...props} className={PROSE.h2}>{children}</h2>
            ),
            h3: ({ children, ...props }) => (
              <h3 {...props} className={PROSE.h3}>{children}</h3>
            ),
            p: ({ children }) => <p className={PROSE.p}>{children}</p>,
            ul: ({ children }) => <ul className="mt-3 list-disc space-y-1.5 pl-5">{children}</ul>,
            ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1.5 pl-5">{children}</ol>,
            li: ({ children }) => <li className={PROSE.li}>{children}</li>,
            a: ({ href, children }) => {
              const rewritten = rewriteHref(href ?? '', currentDir)
              const external = /^[a-z]+:/i.test(rewritten)
              return external ? (
                <a
                  href={rewritten}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent-info)] underline underline-offset-2 hover:text-[var(--text-primary)]"
                >
                  {children}
                </a>
              ) : (
                <Link
                  href={rewritten}
                  className="text-[var(--accent-info)] underline underline-offset-2 hover:text-[var(--text-primary)]"
                >
                  {children}
                </Link>
              )
            },
            table: ({ children }) => (
              <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border-color)]">
                <table className="w-full text-left text-[12px]">{children}</table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border-b border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] px-3 py-2 tabular-nums text-[var(--text-secondary)]">
                {children}
              </td>
            ),
            code: ({ children, className }) =>
              className ? (
                <code className={`${className} block overflow-x-auto rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3 font-mono text-[12px] text-[var(--text-secondary)]`}>
                  {children}
                </code>
              ) : (
                <code className="rounded bg-[var(--muted-bg)] px-1 py-0.5 font-mono text-[12px] text-[var(--text-primary)]">
                  {children}
                </code>
              ),
            pre: ({ children }) => <pre className="mt-4">{children}</pre>,
            blockquote: ({ children }) => (
              <blockquote className="mt-3 border-l-2 border-[var(--border-color)] pl-4 text-[var(--text-tertiary)]">
                {children}
              </blockquote>
            ),
            hr: () => <hr className="my-8 border-[var(--border-color)]" />,
          }}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}) {
  const { slug } = await params
  const rel = slug && slug.length > 0 ? `docs/handbook/${slug.join('/')}.md` : 'docs/handbook/README.md'
  const entry = Object.values(DOCS).find((d) => d.path === rel)
  return {
    title: `${entry?.title ?? 'Handbook'} · Pitchverse`,
    description: entry?.blurb ?? 'Everything the site does not say on the page.',
  }
}
