// Deterministic UI contract replay. Committed forecasts supply every prediction;
// sparse variants remove fields only. No live provider, model, or credentials.
// QA_BASE=http://127.0.0.1:3000 npm run test:product (against dev), or build first
// and run npm run test:product to start/stop an isolated production server.
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'

const base = process.env.QA_BASE || 'http://127.0.0.1:3100'
const out = process.env.QA_OUT || '/tmp/pitchverse-product-quality'
const date = '2026-09-19'
const today = '2026-09-20'
const read = async (path) => JSON.parse(await readFile(path, 'utf8'))
const forecasts = (await read('backend/data/predictions/predictions_2026-09.json')).predictions.filter((p) => p.match_date === date)
const evaluation = await read('backend/data/evaluation/live.json')
const leagues = { 'Premier League': 'eng.1', 'La Liga': 'esp.1', 'Bundesliga': 'ger.1', 'Serie A': 'ita.1', 'Ligue 1': 'fra.1', 'MLS': 'usa.1', 'Major League Soccer': 'usa.1' }
const records = forecasts.filter((p) => leagues[p.league])
assert(records.length > 5 && records.some((p) => p.league === 'Premier League'))
const chosen = records.find((p) => p.league === 'Premier League')
const fixtures = records.map((p) => ({ id: String(p.match_id), league: p.league, leagueId: leagues[p.league], home_team: p.home_team, away_team: p.away_team,
  status: 'upcoming', venue: p.venue, ai_home_prob: p.predicted_home_win, ai_draw_prob: p.predicted_draw, ai_away_prob: p.predicted_away_win, predicted_scoreline: p.predicted_scoreline }))
const prediction = (p) => ({ home_win: p.predicted_home_win, draw: p.predicted_draw, away_win: p.predicted_away_win,
  predicted_score: { home: p.predicted_home_goals, away: p.predicted_away_goals }, most_likely_score: p.predicted_scoreline,
  // Confidence, goals markets, inputs, and attribution deliberately absent.
})
const detail = (p) => ({ id: String(p.match_id), home_team: p.home_team, away_team: p.away_team, home_score: null, away_score: null,
  league: p.league, leagueId: leagues[p.league], date: p.match_date, status: 'upcoming', prediction: prediction(p),
  // Empty provider content: no invented scores, timeline, lineups, or standings.
  card: { eventId: String(p.match_id), date: p.match_date, state: 'pre', statusDetail: 'Kickoff TBC', leg: null, neutralSite: false,
    home: { id: 'home', name: p.home_team, abbreviation: '', score: null, winner: false, logo: null, homeAway: 'home' },
    away: { id: 'away', name: p.away_team, abbreviation: '', score: null, winner: false, logo: null, homeAway: 'away' },
    venue: p.venue ? { name: p.venue, city: null, country: null } : null, attendance: null, officials: [], events: [], commentary: [], stats: [], lineups: [], headToHead: null, form: [],
  },
})
await mkdir(out, { recursive: true })
let server
let browser
const report = []
async function untilServer() {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    try { if ((await fetch(base)).ok) return } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Local production server did not start')
}
const selected = (page, name) => page.getByRole('button', { name, exact: true })
async function assertView(page) {
  await page.getByRole('heading', { name: 'Matchday', exact: true }).waitFor()
  await page.getByRole('region', { name: 'Match spotlight' }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('date'), date)
  assert.equal(await selected(page, 'Yesterday').getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('button', { name: /^To play / }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('[aria-label="Filter by competition"]').getByRole('button', { name: /^Premier League / }).getAttribute('aria-pressed'), 'true')
}
async function audit(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: horizontal overflow`)
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
  })).violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((n) => n.target) })))
  assert.deepEqual(violations, [], `${label}: accessibility violations`)
  const small = await page.locator('#main button, #main a[href*="/matches/"]').evaluateAll((nodes) => nodes.filter((n) => {
    const r = n.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)
  }).map((n) => n.textContent))
  assert.deepEqual(small, [], `${label}: small controls`)
}
try {
  if (!process.env.QA_BASE) {
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3100'], { stdio: 'ignore' })
    await untilServer()
  }
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  for (const width of [390, 768, 1440]) {
    console.log(`Checking ${width}px` )
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage()
    const errors = []
    const requests = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
    await context.addInitScript(() => {
      localStorage.setItem('pitchverse-ambient', 'off')
      // Run deterministic response contracts without the PWA cache. Blocking
      // registration alone makes Workbox receive an undefined registration.
      delete Object.getPrototypeOf(navigator).serviceWorker
    })
    await page.clock.install({ time: new Date(`${today}T12:00:00Z`) })
    await page.clock.resume()
    // Entire test stays local; image hosts and analytics never affect assertions.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== new URL(base).origin) return route.fulfill({ status: 200, body: '' })
      if (url.pathname === '/api/todays_matches') {
        requests.push(url.searchParams.get('date'))
        return route.fulfill({ json: { source: 'contract-replay', live: [], upcoming: url.searchParams.get('date') === date ? fixtures : [], completed: [] } })
      }
      if (url.pathname === '/api/v1/evaluation') return route.fulfill({ json: evaluation })
      if (url.pathname.startsWith('/api/match/')) {
        const p = records.find((r) => String(r.match_id) === url.pathname.split('/').at(-1))
        assert(p, 'Details must correspond to a recorded fixture')
        return route.fulfill({ json: detail(p) })
      }
      if (url.hostname === '127.0.0.1' && url.pathname.includes('/api/')) return route.fulfill({ json: {} })
      return route.continue()
    })
    await page.goto(base, { waitUntil: 'networkidle', timeout: 90000 })
    assert.equal(await selected(page, 'Today').getAttribute('aria-pressed'), 'true')
    await selected(page, 'Yesterday').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('region', { name: 'Match spotlight' }).waitFor()
    await page.locator('[aria-label="Filter by competition"]').getByRole('button', { name: /^Premier League / }).click()
    await page.getByRole('button', { name: /^To play / }).focus()
    await page.keyboard.press('Space')
    await assertView(page)
    await audit(page, `Matchday ${width}`)
    await page.screenshot({ path: `${out}/matchday-${width}.png`, fullPage: true })
    const row = page.getByRole('link', { name: new RegExp(`${chosen.home_team}.*${chosen.away_team}`) })
    // Repeat actual route traversal and both browser/button return paths.
    for (let cycle = 0; cycle < 3; cycle++) {
      console.log(`Detail return ${width}px, cycle ${cycle + 1}`)
      await row.scrollIntoViewIfNeeded()
      await row.focus()
      const beforeY = await page.evaluate(() => window.scrollY)
      await page.keyboard.press('Enter')
      await page.getByRole('tab', { name: 'Prediction', exact: true }).waitFor()
      await page.getByRole('tab', { name: 'Prediction', exact: true }).click()
      await page.getByText('Individual inputs are unavailable for this prediction.').waitFor()
      assert.equal(await page.getByText(/near full strength|equally rested|Last 5:|Key drivers|Why this prediction/).count(), 0)
      assert.equal(await page.getByText('Unavailable', { exact: true }).count(), 4)
      await page.getByText('Exact-score chance unavailable').waitFor()
      if (cycle === 0) {
        await audit(page, `Sparse detail ${width}`)
        await page.screenshot({ path: `${out}/prediction-${width}.png`, fullPage: true })
      }
      if (cycle === 1) await page.goBack()
      else await page.getByRole('button', { name: 'Back', exact: true }).click()
      await assertView(page)
      await page.waitForFunction((y) => Math.abs(window.scrollY - y) < 8, beforeY)
      if (cycle === 1) {
        await page.goForward()
        await page.getByRole('button', { name: 'Back', exact: true }).waitFor()
        await page.getByRole('button', { name: 'Back', exact: true }).click()
        await assertView(page)
        await page.waitForFunction((y) => Math.abs(window.scrollY - y) < 8, beforeY)
      }
    }
    // Following is URL state too; it survives a detail return and reload.
    if (width < 1024) await page.getByRole('button', { name: /Make it your matchday/ }).click()
    await page.getByRole('button', { name: `Follow ${chosen.home_team}`, exact: true }).click()
    await page.getByRole('button', { name: /Following · 1/ }).click()
    assert.equal(new URL(page.url()).searchParams.get('following'), '1')
    await row.click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await assertView(page)
    assert.equal(await page.getByRole('button', { name: /Following · 1/ }).getAttribute('aria-pressed'), 'true')
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await page.getByRole('button', { name: /Following · 1/ }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: /Following · 1/ }).click()
    // Reload, filter-history back/forward, and direct detail fallback preserve scope.
    const savedUrl = page.url()
    await page.reload({ waitUntil: 'networkidle' })
    await assertView(page)
    await page.getByRole('button', { name: /^All matches / }).click()
    await page.goBack()
    await assertView(page)
    await page.goForward()
    assert.equal(await page.getByRole('button', { name: /^All matches / }).getAttribute('aria-pressed'), 'true')
    await page.goto(savedUrl, { waitUntil: 'networkidle' })
    const direct = await row.getAttribute('href')
    const fresh = await context.newPage()
    await fresh.clock.install({ time: new Date(`${today}T12:00:00Z`) })
    await fresh.clock.resume()
    await fresh.goto(new URL(direct, base).href, { waitUntil: 'networkidle' })
    await fresh.getByRole('button', { name: 'Back', exact: true }).click()
    await assertView(fresh)
    await fresh.close()
    assert.deepEqual(errors, [], `Browser errors at ${width}`)
    assert(requests.includes(date) && requests.includes(today))
    report.push({ width, keyboard: true, repeatedDetailReturns: 3, browserBackForward: true, filterHistory: true, reload: true, following: true, deepLinkFallback: true, scrollRestored: true, overflow: false, accessibilityViolations: 0, errors })
    await context.close()
  }
} finally {
  await browser?.close()
  if (server) server.kill('SIGTERM')
}
const result = { replay: 'Committed 2026-09-19 forecasts, selected as Yesterday; sparse detail removes optional evidence. No model/data regeneration or provider access.', screenshots: out, report }
await writeFile(`${out}/report.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
