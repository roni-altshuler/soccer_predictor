// Matchday hierarchy/interaction contracts with committed pre-match forecasts.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const before = process.env.QA_BEFORE === '1'
const port = process.env.QA_PORT || '3140', base = `http://127.0.0.1:${port}`
const out = process.env.QA_OUT || '/tmp/pitchverse-compact-matchday'
const day = '2026-09-19', clock = '2026-09-20T12:00:00Z'
const records = JSON.parse(await readFile('backend/data/predictions/predictions_2026-09.json', 'utf8')).predictions
const evaluation = JSON.parse(await readFile('backend/data/evaluation/live.json', 'utf8'))
const leagues = { 'Premier League': 'eng.1', 'La Liga': 'esp.1', 'Bundesliga': 'ger.1', 'Serie A': 'ita.1', 'Ligue 1': 'fra.1', MLS: 'usa.1', 'Major League Soccer': 'usa.1' }
const fixtures = records.filter((p) => p.match_date === day && leagues[p.league]).map((p) => ({
  id: String(p.match_id), league: p.league, leagueId: leagues[p.league], home_team: p.home_team, away_team: p.away_team,
  status: 'upcoming', venue: p.venue, ai_home_prob: p.predicted_home_win, ai_draw_prob: p.predicted_draw,
  ai_away_prob: p.predicted_away_win, predicted_scoreline: p.predicted_scoreline,
}))
assert(fixtures.length > 5)
const rows = [], errors = []
let server, browser, browserVersion
await mkdir(out, { recursive: true })
async function capture(page, path) {
  // Follow-tools navigation scrolls down; compare availability views at the top.
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.screenshot({ path })
}
try {
  assert.equal(await fetch(base).then(() => true, () => false), false, 'QA port occupied')
  server = spawn(process.execPath, ['--require', resolve('scripts/lib/theme_server_replay.cjs'),
    'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { stdio: ['ignore', 'ignore', 'inherit'] })
  const deadline = Date.now() + 30000
  while (!await fetch(base).then((r) => r.ok, () => false)) {
    assert.equal(server.exitCode, null); assert(Date.now() < deadline, 'Startup timeout')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  browserVersion = browser.version()
  for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage(), failures = []
    let state = 'ready', release, gate
    try {
      page.on('pageerror', (error) => failures.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()) })
      await context.addInitScript(({ theme }) => {
        localStorage.setItem('pitchverse-theme', theme)
        delete Object.getPrototypeOf(navigator).serviceWorker
      }, { theme })
      await page.clock.install({ time: new Date(clock) }); await page.clock.resume()
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== base) return route.fulfill({ body: '' })
        if (url.pathname === '/api/todays_matches') {
          if (state === 'loading') await gate
          const available = state !== 'empty' && url.searchParams.get('date') === day
          return route.fulfill({ json: state === 'error' ? { source: 'error' } :
            { source: 'committed-pre-match-replay', live: [], upcoming: available ? fixtures : [], completed: [] } })
        }
        if (url.pathname === '/api/v1/evaluation') return route.fulfill({ json: evaluation })
        if (url.pathname.includes('/api/')) return route.fulfill({ json: { available: false } })
        return route.continue()
      })
      await page.goto(`${base}/?date=${day}`, { waitUntil: 'networkidle' })
      const fixtureLinks = page.locator('a.match-row-link')
      await fixtureLinks.first().waitFor()
      await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme)
      const metrics = await page.evaluate(() => ({
        firstFixtureTop: document.querySelector('a.match-row-link').getBoundingClientRect().top,
        firstFixtureBottom: document.querySelector('a.match-row-link').getBoundingClientRect().bottom,
        spotlightTop: document.querySelector('[aria-label="Match spotlight"]').getBoundingClientRect().top,
        overflow: document.documentElement.scrollWidth > innerWidth,
        theme: document.documentElement.dataset.theme,
        background: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
      }))
      assert.equal(metrics.overflow, false)
      assert.equal(metrics.background, theme === 'light' ? '#f5f3ee' : '#071009')
      const row = { width, theme, ...metrics }
      rows.push(row)
      await capture(page, `${out}/${theme}-${width}-ready.png`)
      if (!before) {
        assert(metrics.firstFixtureBottom < 740, `First fixture obscured by viewport/footer: ${metrics.firstFixtureBottom}`)
        assert(metrics.firstFixtureTop < metrics.spotlightTop, 'Fixture list must precede analytics/spotlight')
        const disclosure = page.getByText('Forecast details', { exact: true })
        const details = disclosure.locator('..')
        assert.equal(await details.getAttribute('open'), null)
        await disclosure.focus(); await page.keyboard.press('Enter')
        assert.notEqual(await details.getAttribute('open'), null)
        await page.getByText('Home win', { exact: true }).waitFor()
        await page.getByRole('region', { name: 'Match spotlight' }).screenshot({ path: `${out}/${theme}-${width}-forecast.png` })
        await page.keyboard.press('Space')
        assert.equal(await details.getAttribute('open'), null)
        await disclosure.focus(); await page.keyboard.press('Enter')
        await page.getByRole('region', { name: 'Match spotlight' }).getByRole('button').nth(1).click()
        assert.equal(await page.getByText('Forecast details', { exact: true }).locator('..').getAttribute('open'), null)
        const followTools = page.getByRole('link', { name: 'Follow clubs', exact: true })
        await followTools.focus(); await page.keyboard.press('Enter')
        assert.equal(new URL(page.url()).hash, '#matchday-follow-tools')
        assert.equal(new URL(page.url()).searchParams.get('date'), day)
        const clubPanel = page.getByRole('complementary', { name: 'Your football' })
        const expand = clubPanel.getByRole('button', { name: /Make it your matchday/ })
        if (await expand.isVisible()) await expand.click()
        const club = fixtures[0].home_team
        await clubPanel.getByRole('button', { name: `Follow ${club}`, exact: true }).click()
        await page.getByRole('button', { name: 'Following · 1', exact: true }).click()
        assert(await fixtureLinks.count() < fixtures.length)
        await clubPanel.getByRole('button', { name: `Unfollow ${club}`, exact: true }).click()
        assert.equal(await fixtureLinks.count(), fixtures.length)
        row.keyboardClubAccess = true
        // Scope transitions must never keep the previous day's rows on screen.
        for (let i = 0; i < 3; i++) {
          await page.getByRole('button', { name: 'Today', exact: true }).click()
          await page.getByRole('heading', { name: 'No matches in this view', exact: true }).waitFor()
          await page.getByRole('button', { name: 'Yesterday', exact: true }).click()
          await fixtureLinks.first().waitFor()
        }
        state = 'loading'; gate = new Promise((resolve) => { release = resolve })
        await page.getByRole('button', { name: 'Today', exact: true }).click()
        await page.getByLabel('Loading matches', { exact: true }).waitFor()
        assert.equal(await fixtureLinks.count(), 0)
        await capture(page, `${out}/${theme}-${width}-loading.png`)
        state = 'ready'
        await page.getByRole('button', { name: 'Yesterday', exact: true }).click()
        release(); await fixtureLinks.first().waitFor()
        assert.equal(new URL(page.url()).searchParams.get('date'), day)
        state = 'empty'; await page.reload({ waitUntil: 'networkidle' })
        await page.getByRole('heading', { name: 'No matches in this view', exact: true }).waitFor()
        await capture(page, `${out}/${theme}-${width}-empty.png`)
        state = 'error'; await page.reload({ waitUntil: 'networkidle' })
        await page.getByText('We couldn’t update the scores. Please try again.', { exact: true }).waitFor()
        await capture(page, `${out}/${theme}-${width}-error.png`)
        state = 'ready'; await page.getByRole('button', { name: 'Try again', exact: true }).click()
        await fixtureLinks.first().waitFor()
        assert.equal(await page.getByRole('link', { name: 'accuracy record', exact: true }).getAttribute('href'), '/accuracy')
        assert.equal(await page.getByRole('link', { name: 'Season forecast record', exact: true }).getAttribute('href'), '/evaluation')
        row.keyboardDisclosure = true; row.repeatedDateChanges = 3; row.interruptedDateRecovery = true; row.loadingEmptyErrorRetry = true
        await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
        const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })))
        assert.deepEqual(violations, []); row.accessibilityViolations = violations
      }
      assert.deepEqual(failures, [])
    } catch (error) {
      errors.push({ width, theme, message: error.message })
      await page.screenshot({ path: `${out}/failure-${theme}-${width}.png` }).catch(() => {})
      throw error
    } finally { if (release) release(); await context.close() }
  }
} finally {
  await browser?.close(); server?.kill('SIGTERM')
  await writeFile(`${out}/report.json`, JSON.stringify({ before, basis: 'Committed September 19 pre-match records replayed as UI fixtures; kickoff times unavailable and not fabricated; transport-only availability faults; no models/providers generated.', runtime: { node: process.version, browser: browserVersion }, fixtures: fixtures.length, rows, errors }, null, 2))
}
console.log(`Compact Matchday audit passed: ${rows.length} viewport/theme views`)
console.log(`COMPACT_MATCHDAY_AUDIT ${JSON.stringify({ before, views: rows.length, fixtures: fixtures.length, errors: errors.length,
  firstFixtureTops: rows.map(({ width, theme, firstFixtureTop }) => ({ width, theme, top: firstFixtureTop })),
  reportSha256: createHash('sha256').update(await readFile(`${out}/report.json`)).digest('hex'),
  runtime: { node: process.version, browser: browserVersion },
})}`)
