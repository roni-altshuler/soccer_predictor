// Deterministic UI contract replay. Committed forecasts supply every prediction;
// sparse variants remove fields only. No live provider, model, or credentials.
// QA_BASE=http://127.0.0.1:3000 npm run test:product (against dev), or build first
// and run npm run test:product to start/stop an isolated production server.
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { checkNavigationRaces } from './lib/navigation_race_checks.mjs'
import { checkProfilePortraits } from './lib/profile_portrait_checks.mjs'
import { checkTeamComparison } from './lib/team_comparison_checks.mjs'
import { checkMatchEvidence } from './lib/match_evidence_checks.mjs'
import { checkRecordReliability } from './lib/record_reliability_checks.mjs'

const port = process.env.QA_PORT || '3100'
const base = process.env.QA_BASE || `http://127.0.0.1:${port}`
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
const detail = (p, evidence = 'sparse') => ({ id: String(p.match_id), home_team: p.home_team, away_team: p.away_team, home_score: null, away_score: null,
  league: p.league, leagueId: leagues[p.league], date: p.match_date, status: 'upcoming', prediction: prediction(p),
  // Empty provider content: no invented scores, timeline, lineups, or standings.
  card: { eventId: String(p.match_id), date: p.match_date, state: 'pre', statusDetail: 'Kickoff TBC', leg: null, neutralSite: false,
    home: { id: 'home', name: p.home_team, abbreviation: '', score: null, winner: false, logo: null, homeAway: 'home' },
    away: { id: 'away', name: p.away_team, abbreviation: '', score: null, winner: false, logo: null, homeAway: 'away' },
    venue: p.venue ? { name: p.venue, city: null, country: null } : null, attendance: null, officials: [], events: [], commentary: [], stats: [], lineups: [], headToHead: null, form: [],
  },
  ...(evidence === 'null' ? { prediction: { ...prediction(p), predicted_score: null, most_likely_score: undefined,
    confidence: null, total_goals: null, expected_goals: { home: null, away: null, total: null }, over_2_5: null, btts_yes: null } } : {}),
  ...(evidence === 'published' ? { prediction: { ...prediction(p), confidence: p.confidence,
    expected_goals: { home: p.predicted_home_goals, away: p.predicted_away_goals, total: p.predicted_home_goals + p.predicted_away_goals },
    total_goals: p.predicted_home_goals + p.predicted_away_goals } } : {}),
})
await mkdir(out, { recursive: true })
let server
let browser
const report = []
let navigationReport
let portraitReport
let comparisonReport
let evidenceReport
let recordReport
async function untilServer() {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (server?.exitCode != null) throw new Error(`Local server exited with ${server.exitCode}`)
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
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('.match-flow-shell'), {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
  })).violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((n) => n.target) })))
  assert.deepEqual(violations, [], `${label}: accessibility violations`)
  const small = await page.locator('#main button, #main a[href*="/matches/"]').evaluateAll((nodes) => nodes.filter((n) => {
    const r = n.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)
  }).map((n) => n.textContent))
  assert.deepEqual(small, [], `${label}: small controls`)
}
async function assertFocus(locator) {
  await locator.page().keyboard.press('Tab')
  await locator.focus()
  const focus = await locator.evaluate((node) => {
    const style = getComputedStyle(node)
    return { focused: node === document.activeElement, width: parseFloat(style.outlineWidth), style: style.outlineStyle }
  })
  assert(focus.focused && focus.width >= 2 && focus.style === 'solid', 'Keyboard focus must have a visible outline')
}
async function capture(page, name) {
  // Capture at the top so fixed chrome is comparable across before/after views.
  await page.evaluate(() => {
    document.activeElement?.blur()
    window.scrollTo(0, 0)
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.locator('[data-sticky-score-bar]').waitFor({ state: 'detached' })
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true })
  await page.screenshot({ path: `${out}/${name}-viewport.png` })
}
function contrast(foreground, background) {
  const luminance = (hex) => {
    const values = hex.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
  }
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}
try {
  if (!process.env.QA_BASE) {
    assert(/^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536, 'Invalid QA_PORT')
    const occupied = await fetch(base).then(() => true, () => false)
    assert.equal(occupied, false, `QA port ${port} is occupied; choose QA_PORT or explicitly use QA_BASE`)
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { stdio: ['ignore', 'ignore', 'inherit'] })
    await untilServer()
  }
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  assert.match(await (await fetch(base)).text(), /<h1\b[^>]*>Matchday<\/h1>/, 'Matchday heading remains in server-rendered HTML')
  navigationReport = await checkNavigationRaces({ browser, base, out, date, today, fixtures, records, detail, evaluation, probe: process.env.QA_PROBE === '1' })
  if (!process.env.QA_NAVIGATION_ONLY) portraitReport = await checkProfilePortraits({ browser, base, out, chosen, detail, today })
  if (!process.env.QA_NAVIGATION_ONLY) comparisonReport = await checkTeamComparison({ browser, base, out })
  if (!process.env.QA_NAVIGATION_ONLY) evidenceReport = await checkMatchEvidence({ browser, base, out })
  if (!process.env.QA_NAVIGATION_ONLY) recordReport = await checkRecordReliability({ browser, base, out })
  for (const width of process.env.QA_NAVIGATION_ONLY ? [] : [390, 768, 1440]) {
    console.log(`Checking ${width}px` )
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage()
    const errors = []
    const requests = []
    let detailEvidence = 'sparse'
    let matchdayState = 'ready'
    let detailState = 'ready'
    let releaseRequest
    let responseGate
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
        if (matchdayState === 'loading') await responseGate
        // This is the proxy's explicit failure contract, not an empty fixture list.
        if (matchdayState === 'error') return route.fulfill({ json: { source: 'error' } })
        if (matchdayState === 'empty') return route.fulfill({ json: { source: 'contract-replay', live: [], upcoming: [], completed: [] } })
        return route.fulfill({ json: { source: 'contract-replay', live: [], upcoming: url.searchParams.get('date') === date ? fixtures : [], completed: [] } })
      }
      if (url.pathname === '/api/v1/evaluation') return route.fulfill({ json: evaluation })
      if (url.pathname.startsWith('/api/match/')) {
        const p = records.find((r) => String(r.match_id) === url.pathname.split('/').at(-1))
        assert(p, 'Details must correspond to a recorded fixture')
        if (detailState === 'loading') await responseGate
        if (detailState === 'error') return route.fulfill({ status: 503, json: { error: 'Unavailable in UI replay' } })
        return route.fulfill({ json: detail(p, detailEvidence) })
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
    const palette = await page.locator('.match-flow-shell').evaluate((node) => ({
      canvas: getComputedStyle(document.body).backgroundColor,
      card: getComputedStyle(node).getPropertyValue('--card-bg').trim(),
      text: getComputedStyle(node).color,
    }))
    assert.deepEqual(palette, { canvas: 'rgb(245, 243, 238)', card: '#fcfaf6', text: 'rgb(36, 40, 36)' })
    const tokens = await page.locator('.match-flow-shell').evaluate((node) => {
      const style = getComputedStyle(node)
      return Object.fromEntries(['text-primary', 'text-secondary', 'text-tertiary', 'background', 'card-bg', 'muted-bg', 'accent-info', 'accent-primary', 'accent-on-primary'].map((name) => [name, style.getPropertyValue(`--${name}`).trim()]))
    })
    const minimumTextContrast = Math.min(...['text-primary', 'text-secondary', 'text-tertiary'].flatMap((text) => ['background', 'card-bg', 'muted-bg'].map((surface) => contrast(tokens[text], tokens[surface]))))
    const actionContrast = contrast(tokens['accent-primary'], tokens['accent-on-primary'])
    const focusContrast = contrast(tokens['accent-info'], tokens['card-bg'])
    assert(minimumTextContrast >= 4.5 && actionContrast >= 4.5 && focusContrast >= 3)
    await assertFocus(page.getByRole('button', { name: /^To play / }))
    assert.equal(await page.locator('#main').evaluate((node) => node.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')), false, 'Reduced motion leaves no running content animations')
    await audit(page, `Matchday ${width}`)
    await capture(page, `matchday-${width}`)
    const choices = page.locator('[aria-label="Choose spotlight match"]').getByRole('button')
    const originalFixture = await page.getByRole('link', { name: 'Match centre', exact: true }).getAttribute('href')
    await assertFocus(choices.nth(1))
    await page.keyboard.press('Enter')
    assert.notEqual(await page.getByRole('link', { name: 'Match centre', exact: true }).getAttribute('href'), originalFixture)
    await choices.first().click()
    const row = page.getByRole('link', { name: new RegExp(`${chosen.home_team}.*${chosen.away_team}`) })
    // Repeat actual route traversal and both browser/button return paths.
    for (let cycle = 0; cycle < 3; cycle++) {
      console.log(`Detail return ${width}px, cycle ${cycle + 1}`)
      await row.scrollIntoViewIfNeeded()
      await row.focus()
      await assertFocus(row)
      const beforeY = await page.evaluate(() => window.scrollY)
      await page.keyboard.press('Enter')
      await page.getByRole('tab', { name: 'Prediction', exact: true }).waitFor()
      await page.getByRole('tab', { name: 'Prediction', exact: true }).click()
      await page.getByText('Individual inputs are unavailable for this prediction.').waitFor()
      assert.equal(await page.getByText(/near full strength|equally rested|Last 5:|Key drivers|Why this prediction/).count(), 0)
      assert.equal(await page.getByText('Unavailable', { exact: true }).count(), 4)
      await page.getByText('Exact-score chance unavailable').waitFor()
      await assertFocus(page.getByRole('tab', { name: 'Prediction', exact: true }))
      await page.keyboard.press('Home')
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('tabpanel', { name: 'Prediction', exact: true }).evaluate((node) => node === document.activeElement), true)
      if (cycle === 0) {
        await audit(page, `Sparse detail ${width}`)
        await capture(page, `prediction-${width}`)
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
    // Also exercise canonical nulls emitted by the real normalization boundary,
    // then restore actual confidence and xG from the same committed forecast.
    detailEvidence = 'null'
    await page.goto(new URL(direct, base).href, { waitUntil: 'networkidle' })
    assert.equal(await page.getByText('AI 0-0', { exact: true }).count(), 0)
    assert.equal(await page.getByText(/confidence/).count(), 0)
    await page.getByRole('tab', { name: 'Prediction', exact: true }).click()
    await page.getByText('Scoreline unavailable.').waitFor()
    assert.equal(await page.getByText(/confidence|total xG|0-0/).count(), 0)
    await audit(page, `Null detail ${width}`)
    await capture(page, `prediction-null-${width}`)
    detailEvidence = 'published'
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('tab', { name: 'Prediction', exact: true }).click()
    await page.getByText(`${(chosen.predicted_home_goals + chosen.predicted_away_goals).toFixed(2)} total xG`, { exact: true }).waitFor()
    await page.getByLabel(new RegExp(`^Prediction confidence ${Math.round(chosen.confidence)} percent,`)).waitFor()
    assert.equal(await page.getByText('Expected goals by team unavailable.', { exact: true }).count(), 0)
    await page.getByText('Exact-score chance unavailable').waitFor()
    assert.equal(await page.getByText(/near full strength|Key drivers|Why this prediction/).count(), 0)
    await audit(page, `Published xG detail ${width}`)
    await capture(page, `prediction-published-${width}`)
    assert.deepEqual(errors, [], `Browser errors at ${width}`)

    // Loading gates stay pending only until the skeleton has been inspected.
    const holdResponse = () => { responseGate = new Promise((resolve) => { releaseRequest = resolve }) }
    matchdayState = 'loading'
    holdResponse()
    await page.goto(savedUrl, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Loading matches', { exact: true }).waitFor()
    await audit(page, `Matchday loading ${width}`)
    await capture(page, `matchday-loading-${width}`)
    matchdayState = 'ready'
    releaseRequest()
    await assertView(page)
    matchdayState = 'empty'
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'No matches in this view' }).waitFor()
    await audit(page, `Matchday empty ${width}`)
    await capture(page, `matchday-empty-${width}`)
    await assertFocus(page.getByRole('button', { name: 'Show all matches' }))
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('filter') === null)
    matchdayState = 'error'
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('status').filter({ hasText: 'We couldn’t update the scores.' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'No matches in this view' }).count(), 0)
    await audit(page, `Matchday error ${width}`)
    await capture(page, `matchday-error-${width}`)
    matchdayState = 'ready'
    await assertFocus(page.getByRole('button', { name: 'Try again', exact: true }))
    await page.keyboard.press('Enter')
    await page.getByRole('region', { name: 'Match spotlight' }).waitFor()
    assert.deepEqual(errors, [], `Matchday state browser errors at ${width}`)

    detailState = 'loading'
    holdResponse()
    await page.goto(new URL(direct, base).href, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Loading match details', { exact: true }).waitFor()
    await audit(page, `Detail loading ${width}`)
    await capture(page, `detail-loading-${width}`)
    detailState = 'ready'
    releaseRequest()
    await page.getByRole('tab', { name: 'Prediction', exact: true }).waitFor()
    detailState = 'error'
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Match not available' }).waitFor()
    await audit(page, `Detail error ${width}`)
    await capture(page, `detail-error-${width}`)
    const errorReturn = new URL(await page.getByRole('link', { name: 'Back to Matchday' }).getAttribute('href'), base)
    assert.equal(errorReturn.pathname, new URL(savedUrl).pathname)
    assert.deepEqual([...errorReturn.searchParams].sort(), [...new URL(savedUrl).searchParams].sort())
    const expectedFailureLogs = [...errors]
    assert(expectedFailureLogs.some((error) => error === 'Match not found: 503'))
    assert(expectedFailureLogs.every((error) => error === 'Match not found: 503' || error.includes('503 (Service Unavailable)')), 'Only deliberately injected 503 logs are allowed')
    errors.length = 0
    detailState = 'ready'
    await assertFocus(page.getByRole('button', { name: 'Try again', exact: true }))
    await page.keyboard.press('Enter')
    await page.getByRole('tab', { name: 'Prediction', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await assertView(page)
    assert.deepEqual(errors, [], `Recovery browser errors at ${width}`)
    assert(requests.includes(date) && requests.includes(today))
    report.push({ width, keyboard: true, visibleFocus: true, reducedMotion: true, palette, minimumTextContrast, actionContrast, focusContrast, spotlightExploration: true, loadingEmptyErrorRecovery: true, expectedFailureLogs, repeatedDetailReturns: 3, browserBackForward: true, filterHistory: true, reload: true, following: true, deepLinkFallback: true, scrollRestored: true, nullEvidence: true, publishedXg: true, overflow: false, accessibilityViolations: 0, errors })
    await context.close()
  }
} finally {
  await browser?.close()
  if (server) server.kill('SIGTERM')
}
const result = { replay: 'Committed forecasts; sparse detail removes optional evidence. No model/data regeneration or provider access.', screenshots: out, serverRenderedHeading: true, navigationReport, portraitReport, comparisonReport, evidenceReport, recordReport, report }
await writeFile(`${out}/report.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
