import fs from 'fs'
import path from 'path'

import { DOCS, docsUrl, type DocKey } from '@/lib/docs'

/**
 * The handbook, checked against the filesystem.
 *
 * The site now points at `docs/handbook/` wherever it used to explain itself
 * in place. That trade is only honest if the documents exist and say what the
 * pages stopped saying — a "learn more" link that 404s is worse than the
 * paragraph it replaced, because the paragraph at least contained the answer.
 *
 * So this file pins three things:
 *
 *   1. every link the app can render resolves to a file in this repository
 *   2. every cross-link inside the handbook resolves too
 *   3. the specific claims that were REMOVED from pages are present in the
 *      documents they were moved into
 *
 * (3) is the one that matters most. Deleting a page's honesty note and calling
 * it "moved to the docs" is a real risk of this reorganisation, and nothing
 * else in the suite would catch it.
 */

const ROOT = process.cwd()
const HANDBOOK = path.join(ROOT, 'docs', 'handbook')

/**
 * Read a document with its line wrapping collapsed.
 *
 * Markdown here is hard-wrapped at 80 columns, so a sentence this file needs
 * to find is routinely split across two lines. A test that failed on that
 * would be a test that forbids re-wrapping a paragraph.
 */
const read = (p: string) => fs.readFileSync(p, 'utf8').replace(/\s+/g, ' ')

/** Every markdown file in the handbook, as repo-relative paths. */
function handbookFiles(dir = HANDBOOK): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return handbookFiles(full)
    return entry.name.endsWith('.md') ? [full] : []
  })
}

describe('the documentation the app links to', () => {
  it('resolves every registered document to a real file', () => {
    const missing = (Object.keys(DOCS) as DocKey[]).filter(
      (key) => !fs.existsSync(path.join(ROOT, DOCS[key].path)),
    )
    expect(missing).toEqual([])
  })

  it('gives every document a title and a one-line description', () => {
    for (const key of Object.keys(DOCS) as DocKey[]) {
      const entry = DOCS[key]
      expect([key, entry.title.length > 0, entry.blurb.length > 0]).toEqual([key, true, true])
    }
  })

  it('builds an in-app /docs route with the GitHub-style anchor intact', () => {
    // Docs render in-app now (/docs/[[...slug]]) — a "learn more" that ejects
    // the reader onto github.com costs them their place in the product. The
    // anchor scheme is unchanged: rehype-slug generates the same slugs GitHub
    // does, so every hash written for the old URLs still resolves.
    const url = docsUrl('scoring', 'calibration')
    expect(url).toBe('/docs/concepts/scoring#calibration')
    // No hash means no trailing '#'.
    expect(docsUrl('scoring')).toBe('/docs/concepts/scoring')
    // The README is the /docs index itself, not /docs/README.
    expect(docsUrl('handbook')).toBe('/docs')
  })

  it('resolves every cross-link inside the handbook', () => {
    // A handbook whose own links rot is a handbook nobody finishes reading.
    const broken: string[] = []
    for (const file of handbookFiles()) {
      const body = read(file)
      for (const [, target] of body.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target)) continue
        const [relative] = target.split('#')
        if (!relative) continue
        const resolved = path.resolve(path.dirname(file), relative)
        if (!fs.existsSync(resolved)) {
          broken.push(`${path.relative(ROOT, file)} → ${target}`)
        }
      }
    }
    expect(broken).toEqual([])
  })
})

describe('what the pages stopped saying, the handbook must still say', () => {
  const scoring = read(path.join(HANDBOOK, 'concepts', 'scoring.md'))
  const models = read(path.join(HANDBOOK, 'concepts', 'models.md'))
  const evaluation = read(path.join(HANDBOOK, 'concepts', 'evaluation.md'))

  it('keeps the feature groups that were measured and dropped', () => {
    // These were chips on the season page's evidence panel. They are the
    // clearest evidence in the product that features were tested rather than
    // accumulated, and the expensive one — referee — is the whole point.
    for (const dropped of ['referee', 'rest', 'head-to-head', 'venue', 'attendance', 'kickoff time']) {
      expect([dropped, models.toLowerCase().includes(dropped)]).toEqual([dropped, true])
    }
  })

  it('keeps the two-outcome framing the tournaments page used to open with', () => {
    // The reason /tournaments is not a tab on /accuracy: a knockout tie has
    // two outcomes and a league match has three, so 64.9% here is not a better
    // version of 52% there. Edited away, the numbers start overstating
    // themselves and nothing else would catch it.
    expect(models).toMatch(/knockout tie has two outcomes/i)
    expect(models).toMatch(/quarter of league matches are drawn/i)
  })

  it('keeps the floors every rate on the site is read against', () => {
    for (const floor of ['Coin flip', 'Base rate', 'Always home', 'Closing line']) {
      expect([floor, scoring.includes(floor)]).toEqual([floor, true])
    }
    expect(scoring).toMatch(/0\.6667|\.6667/)
    expect(scoring).toMatch(/\.2500/)
  })

  it('keeps the statement that the model trails the market', () => {
    // The product is betting-adjacent and the repository's own measurement
    // says backing it against the price loses money. That must survive any
    // amount of tidying.
    expect(scoring).toMatch(/loses money in every disagreement bucket/i)
    expect(scoring).toMatch(/not a profit target|not.{0,20}profit/i)
  })

  it('keeps the rule that the two records are never merged', () => {
    expect(evaluation).toMatch(/never added together|never merged/i)
    expect(evaluation).toMatch(/final_before_kickoff|before.{0,10}kickoff/i)
  })

  it('keeps the refusal to chart a sample too small to have a shape', () => {
    expect(scoring).toMatch(/not drawn below 200|below 200 scored/i)
  })
})
