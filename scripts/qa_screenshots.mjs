// Screenshot QA harness — captures key pages at desktop/tablet/mobile and
// runs lightweight automated checks (horizontal overflow, tiny tap targets,
// console errors). Not committed as a test; a dev/QA aid.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3000'
const OUT = process.env.QA_OUT || '/tmp/pitchwise-qa'
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
]

const PAGES = [
  ['home', '/'],
  ['welcome', '/welcome'],
  ['about', '/about'],
  ['world-cup', '/world-cup'],
  ['wc-compare', '/world-cup/compare'],
  ['league-epl', '/leagues/eng.1'],
  ['accuracy', '/accuracy'],
  ['predict', '/predict'],
  ['simulator', '/simulator'],
  ['ai', '/ai'],
  ['news', '/news'],
  ['history', '/history'],
  ['tournaments', '/tournaments'],
  ['diagnostics', '/diagnostics'],
  ['upcoming', '/upcoming'],
  // Dynamic routes: override via env when the defaults go stale.
  ['match-detail', `/matches/${process.env.QA_MATCH_ID || '760497'}`],
  ['team-detail', `/teams/${process.env.QA_TEAM_ID || '360'}`],
]

const results = []

const browser = await chromium.launch()
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
  for (const [label, path] of PAGES) {
    const page = await ctx.newPage()
    const consoleErrors = []
    const failedResources = []
    // Provider images with graceful in-app fallbacks (PlayerAvatar initials,
    // crest monograms): ESPN simply doesn't host headshots for many players,
    // so their 404s are expected noise, not defects.
    const EXEMPT_RESOURCE = /a\.espncdn\.com\/i\/(headshots|teamlogos)|flagcdn\.com/
    page.on('response', (r) => {
      if (r.status() >= 400 && !EXEMPT_RESOURCE.test(r.url())) failedResources.push(`${r.status()} ${r.url()}`)
    })
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      // Let data fetches + animations settle (networkidle never fires with
      // persistent CSS animations; dev-mode compiles and live API fetches
      // need the longer default — tune via QA_SETTLE_MS).
      await page.waitForTimeout(Number(process.env.QA_SETTLE_MS || 5000))
      // Scroll through the page so whileInView reveals fire — otherwise
      // fullPage captures show below-the-fold content stuck at opacity 0.
      await page.evaluate(async () => {
        const step = window.innerHeight * 0.8
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 120))
        }
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(700)
      const file = `${OUT}/${label}-${vp.name}.png`
      await page.screenshot({ path: file, fullPage: true })
      // horizontal overflow check
      const overflow = await page.evaluate(() => {
        const de = document.documentElement
        return Math.max(0, de.scrollWidth - de.clientWidth)
      })
      // tiny interactive targets (links/buttons < 24px in either dim, visible)
      const tinyTargets = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('a,button,select,[role=button]'))
        let n = 0
        for (const el of els) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (r.width < 24 || r.height < 24) n++
        }
        return n
      })
      // "Failed to load resource" console entries carry no URL; when every
      // failed response this page produced was an exempt fallback image,
      // those entries are the expected noise — drop them.
      const filteredConsole =
        failedResources.length === 0
          ? consoleErrors.filter((c) => !/Failed to load resource/.test(c))
          : consoleErrors
      results.push({ page: label, vp: vp.name, overflowPx: overflow, tinyTargets, consoleErrors: filteredConsole.slice(0, 5), failedResources: failedResources.slice(0, 5) })
    } catch (e) {
      results.push({ page: label, vp: vp.name, error: String(e).slice(0, 200) })
    }
    await page.close()
  }
  await ctx.close()
}
await browser.close()

// Report
let issues = 0
for (const r of results) {
  const flags = []
  if (r.error) flags.push(`LOAD_ERROR ${r.error}`)
  if (r.overflowPx > 1) flags.push(`H_OVERFLOW ${r.overflowPx}px`)
  if (r.consoleErrors && r.consoleErrors.length) flags.push(`CONSOLE x${r.consoleErrors.length}`)
  if (flags.length) {
    issues++
    console.log(`✗ ${r.page} @ ${r.vp}: ${flags.join(' | ')}`)
    if (r.consoleErrors) r.consoleErrors.forEach((c) => console.log(`    · ${c.slice(0, 160)}`))
  } else {
    console.log(`✓ ${r.page} @ ${r.vp} (tinyTargets=${r.tinyTargets})`)
  }
}
console.log(`\n${issues} page/viewport combos flagged out of ${results.length}. Screenshots in ${OUT}`)
