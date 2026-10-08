// Real production browser journeys; committed artifacts/sparse provider excerpt
// only. Optional faults affect transport/availability, never model probabilities.
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const port = process.env.QA_PORT || '3110'
const base = `http://127.0.0.1:${port}`
const out = process.env.QA_OUT || '/tmp/pitchverse-theme-quality'
const probe = process.env.QA_THEME_PROBE === '1'
const serverRoot = process.env.QA_THEME_SERVER_ROOT || process.cwd()
const excerpt = JSON.parse(await readFile('backend/tests/fixtures/espn/761660_scheduled_excerpt.json', 'utf8'))
const competition = excerpt.header.competitions[0]
const home = competition.competitors.find((c) => c.homeAway === 'home').team
const away = competition.competitors.find((c) => c.homeAway === 'away').team
const fixture = { id: excerpt.header.id, league: 'MLS', leagueId: 'usa.1', home_team: home.displayName, away_team: away.displayName, home_team_id: home.id, away_team_id: away.id, status: 'upcoming' }
const match = { ...fixture, date: competition.date, prediction: null, card: {
  eventId: fixture.id, date: competition.date, state: 'pre', statusDetail: 'Kickoff TBC', leg: null, neutralSite: false,
  home: { ...home, name: home.displayName, score: null, winner: false, logo: null, homeAway: 'home' },
  away: { ...away, name: away.displayName, score: null, winner: false, logo: null, homeAway: 'away' },
  venue: null, attendance: null, officials: [], events: [], commentary: [], stats: [], lineups: [], form: [], headToHead: null,
} }
const rows = [], errors = []
let server, browser
await mkdir(out, { recursive: true })
const measure = async (page) => page.evaluate(() => {
  const root = getComputedStyle(document.documentElement)
  const shell = document.querySelector('.match-flow-shell') || document.querySelector('#main').parentElement.parentElement
  const style = getComputedStyle(shell)
  const header = document.querySelector('header[role="banner"]')
  const signIn = [...(header?.querySelectorAll('button') || [])].find((button) => button.textContent === 'Sign In')
  const heading = document.querySelector('#main h1')
  return { theme: document.documentElement.dataset.theme, preference: document.documentElement.dataset.themePreference,
    rootCanvas: root.getPropertyValue('--background').trim(), canvas: style.getPropertyValue('--background').trim(),
    card: style.getPropertyValue('--card-bg').trim(), color: style.getPropertyValue('--text-primary').trim(),
    headingTransform: heading ? getComputedStyle(heading).textTransform : null,
    header: header ? getComputedStyle(header).backgroundColor : null,
    action: signIn ? [getComputedStyle(signIn).backgroundColor, getComputedStyle(signIn).color] : null,
    browserChrome: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    overflow: document.documentElement.scrollWidth > innerWidth }
})
async function capture(page, label, expected) {
  const values = await measure(page)
  rows.push({ label, ...values })
  if (!probe) {
    assert.equal(values.theme, expected)
    assert.equal(values.canvas, expected === 'light' ? '#f5f3ee' : '#071009', label)
    assert.equal(values.canvas, values.rootCanvas, `${label}: root and shell differ`)
    assert.equal(values.overflow, false, `${label}: overflow`)
    if (values.headingTransform) assert.equal(values.headingTransform, 'none')
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('header[role="banner"]'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })))
    assert.deepEqual(violations, [], `${label}: header accessibility`)
  }
  await page.screenshot({ path: `${out}/${label}.png` })
}
try {
  assert(/^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536)
  assert.equal(await fetch(base).then(() => true, () => false), false, 'QA port occupied')
  server = spawn(process.execPath, ['--require', resolve('scripts/lib/theme_server_replay.cjs'), resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', port], {
    cwd: serverRoot, stdio: ['ignore', 'ignore', 'inherit'],
  })
  const deadline = Date.now() + 60000
  while (true) {
    if (server.exitCode != null) throw new Error('QA server exited')
    if (await fetch(base).then((r) => r.ok, () => false)) break
    assert(Date.now() < deadline, 'QA server did not start')
    await new Promise((r) => setTimeout(r, 200))
  }
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  for (const width of [390, 768, 1440]) for (const preference of ['light', 'dark']) {
    console.log(`Theme journey ${width}px ${preference}${probe ? ' before' : ''}`)
    const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: preference === 'light' ? 'dark' : 'light', reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage()
    let state = 'ready', gate, release
    const contextErrors = []
    try {
      page.on('pageerror', (e) => contextErrors.push(e.message))
      page.on('console', (message) => { if (message.type() === 'error') contextErrors.push(message.text()) })
      await context.addInitScript(({ preference }) => {
        // Seed once so UI changes survive subsequent reloads.
        if (!sessionStorage.getItem('theme-qa-seeded')) {
          localStorage.setItem('theme', preference) // legacy reader preference
          localStorage.setItem('pitchverse-theme', preference)
          sessionStorage.setItem('theme-qa-seeded', '1')
        }
        localStorage.setItem('pitchverse-ambient', 'off')
        delete Object.getPrototypeOf(navigator).serviceWorker
        // Observe the canvas on animation frames from its first rendered body.
        window.__themeFrames = []
        const sample = () => {
          if (document.body) window.__themeFrames.push(getComputedStyle(document.body).backgroundColor)
          if (window.__themeFrames.length < 30) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }, { preference })
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(base).origin) {
          if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>' })
          return route.fulfill({ json: { children: [], events: [], leaders: [] } })
        }
        if (url.pathname === '/api/todays_matches') {
          if (state === 'loading') await gate
          return route.fulfill({ json: state === 'error' ? { source: 'error' } : { source: 'committed-sparse-excerpt', live: [], upcoming: state === 'empty' ? [] : [fixture], completed: [] } })
        }
        if (url.pathname.startsWith('/api/match/')) return route.fulfill({ json: match })
        if (url.pathname === '/api/v1/season/projections' || url.pathname === '/api/v1/match-evidence') return route.continue()
        if (url.pathname.includes('/api/')) return route.fulfill({ json: { available: false, standings: [], events: [], scorers: [], children: [] } })
        return route.continue()
      })
      const label = (name) => `${probe ? 'before' : 'after'}-${preference}-${width}-${name}`
      const currentTheme = async () => (await measure(page)).theme
      await page.goto(base, { waitUntil: 'networkidle' })
      await page.getByRole('region', { name: 'Match spotlight' }).waitFor()
      await capture(page, label('home'), preference)
      if (!probe) {
        assert.deepEqual([...new Set(await page.evaluate(() => window.__themeFrames))], [preference === 'light' ? 'rgb(245, 243, 238)' : 'rgb(7, 16, 9)'], 'First paint/hydration changed canvas')
      }
      const nav = width < 768 ? page.getByRole('navigation', { name: 'Mobile navigation' }) : page.getByRole('complementary', { name: 'Primary' })
      await nav.getByRole('link', { name: 'Leagues', exact: true }).click()
      await page.getByRole('heading', { name: 'Leagues', exact: true }).waitFor()
      await capture(page, label('leagues'), preference)
      await page.getByRole('link', { name: /Premier League/ }).first().click()
      await page.getByRole('heading', { name: 'Premier League', exact: true }).waitFor()
      await capture(page, label('league'), preference)
      await page.getByRole('link', { name: 'Compare clubs · Season snapshot' }).click()
      await page.getByRole('region', { name: 'Club comparison' }).waitFor()
      await capture(page, label('comparison'), preference)
      await page.goBack({ waitUntil: 'networkidle' })
      await page.getByRole('link', { name: 'Explore match evidence', exact: true }).click()
      await page.locator('.match-evidence h1').waitFor()
      await capture(page, label('evidence'), preference)
      await page.goBack({ waitUntil: 'networkidle' }); await page.goForward({ waitUntil: 'networkidle' })
      await capture(page, label('history'), preference)
      await nav.getByRole('link', { name: probe && preference ? /Today|Matchday/ : 'Matchday', exact: !probe }).click()
      await page.getByRole('link', { name: 'Match centre', exact: true }).click()
      await page.getByRole('tab', { name: 'Prediction', exact: true }).waitFor()
      await capture(page, label('match'), preference)
      // The shared sparse match card has no club link. Exercise its exact
      // provider subject as a deep link, through the real SSR adapter.
      const returnTo = new URL(page.url()).pathname + new URL(page.url()).search
      await page.goto(`${base}/teams/${home.id}?provider=espn&returnTo=${encodeURIComponent(returnTo)}`, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: home.displayName, exact: true }).waitFor()
      await capture(page, label('team'), preference)
      await page.reload({ waitUntil: 'networkidle' })
      await capture(page, label('reload'), preference)
      if (!probe) assert.deepEqual([...new Set(await page.evaluate(() => window.__themeFrames))], [preference === 'light' ? 'rgb(245, 243, 238)' : 'rgb(7, 16, 9)'], 'Profile reload flashed a different palette')
      await page.goBack({ waitUntil: 'networkidle' }); await page.goForward({ waitUntil: 'networkidle' })
      await capture(page, label('profile-history'), preference)
      if (!probe) {
        const select = page.getByRole('combobox', { name: 'Color theme', exact: true })
        await select.selectOption(preference === 'light' ? 'dark' : 'light')
        await capture(page, label('toggle'), preference === 'light' ? 'dark' : 'light')
        await page.reload({ waitUntil: 'networkidle' })
        assert.equal(await currentTheme(), preference === 'light' ? 'dark' : 'light')
        assert.deepEqual([...new Set(await page.evaluate(() => window.__themeFrames))], [preference === 'light' ? 'rgb(7, 16, 9)' : 'rgb(245, 243, 238)'], 'Saved toggle reload flashed a different palette')
        await select.selectOption('system')
        assert.equal(await currentTheme(), preference === 'light' ? 'dark' : 'light')
        await page.emulateMedia({ colorScheme: preference })
        await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, preference)
        assert.equal(await currentTheme(), preference)
        await capture(page, label('system'), preference)
        await select.selectOption(preference)
        // A second tab must repaint when the preference changes in the first.
        const sibling = await context.newPage()
        await sibling.goto(`${base}/leagues`, { waitUntil: 'networkidle' })
        await select.selectOption(preference === 'light' ? 'dark' : 'light')
        await sibling.waitForFunction((theme) => document.documentElement.dataset.theme === theme, preference === 'light' ? 'dark' : 'light')
        await sibling.close(); await select.selectOption(preference)
      }
      for (const variant of ['loading', 'empty', 'error']) {
        state = variant
        if (variant === 'loading') gate = new Promise((r) => { release = r })
        await page.goto(base, { waitUntil: 'domcontentloaded' })
        if (variant === 'loading') await page.getByLabel('Loading matches').waitFor()
        if (variant === 'empty') await page.getByRole('heading', { name: 'No matches in this view' }).waitFor()
        if (variant === 'error') await page.getByText('We couldn’t update the scores. Please try again.', { exact: true }).waitFor()
        await capture(page, label(variant), preference)
        if (release) { state = 'ready'; release(); release = undefined }
      }
      assert.deepEqual(contextErrors, [], 'Browser exceptions/hydration errors')
    } catch (e) {
      errors.push({ width, preference, error: e.message })
      await page.screenshot({ path: `${out}/failure-${width}-${preference}.png` })
      throw e
    } finally { await context.close() }
  }
  if (!probe) for (const scenario of [
    { label: 'fresh-system-light', scheme: 'light', expected: 'light' },
    { label: 'fresh-system-dark', scheme: 'dark', expected: 'dark' },
    { label: 'legacy-dark', scheme: 'light', expected: 'dark', legacy: true },
    { label: 'storage-blocked', scheme: 'dark', expected: 'dark', blocked: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: 320, height: 800 }, colorScheme: scenario.scheme, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage()
    try {
      const failures = []
      page.on('pageerror', (error) => failures.push(error.message))
      await context.addInitScript(({ legacy, blocked }) => {
        if (legacy) localStorage.setItem('theme', 'dark')
        if (blocked) {
          Storage.prototype.getItem = () => { throw new Error('Blocked by browser QA') }
          Storage.prototype.setItem = () => { throw new Error('Blocked by browser QA') }
        }
        delete Object.getPrototypeOf(navigator).serviceWorker
        window.__themeFrames = []
        const sample = () => {
          if (document.body) window.__themeFrames.push(getComputedStyle(document.body).backgroundColor)
          if (window.__themeFrames.length < 30) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }, scenario)
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(base).origin) return route.fulfill({ json: {} })
        if (url.pathname === '/api/todays_matches') return route.fulfill({ json: { source: 'committed-sparse-excerpt', live: [], upcoming: [fixture], completed: [] } })
        if (url.pathname.includes('/api/')) return route.fulfill({ json: { available: false } })
        // Delay client bundles to verify that the head script needs no hydration.
        if (url.pathname.startsWith('/_next/static/chunks/')) await new Promise((r) => setTimeout(r, 200))
        return route.continue()
      })
      for (const path of ['/', '/leagues']) {
        await page.goto(base + path, { waitUntil: 'networkidle' })
        await capture(page, `after-${scenario.label}-320-${path === '/' ? 'home' : 'leagues'}`, scenario.expected)
        assert.deepEqual([...new Set(await page.evaluate(() => window.__themeFrames))], [scenario.expected === 'light' ? 'rgb(245, 243, 238)' : 'rgb(7, 16, 9)'], `${scenario.label}: first paint before delayed bundles`)
      }
      if (scenario.blocked) {
        await page.getByRole('combobox', { name: 'Color theme' }).selectOption('light')
        await capture(page, 'after-storage-blocked-session-320', 'light')
      }
      if (scenario.label === 'fresh-system-light') {
        // Reduced motion draws a still, including when a hidden light-mode
        // canvas is first revealed. Theme changes must refit its backing size.
        await page.getByRole('combobox', { name: 'Color theme' }).selectOption('dark')
        const canvas = await page.locator('canvas.pitch-backdrop__match').evaluate((node) => ({ width: node.width, height: node.height }))
        assert(canvas.width > 0 && canvas.height > 0, 'Reduced-motion dark pitch must refit after being revealed')
        await capture(page, 'after-reduced-motion-pitch-toggle-320', 'dark')
        rows.at(-1).pitchBackingDimensions = canvas
      }
      assert.deepEqual(failures, [])
    } finally { await context.close() }
  }
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
  await writeFile(`${out}/report.json`, JSON.stringify({ basis: 'Local production browser with committed artifacts and sparse ESPN excerpt; provider access blocked in browser and server. No model or data generation.', probe, rows, errors }, null, 2))
}
console.log(`Theme journeys passed: ${rows.length} captured states`)
