// Availability UI release contract. Model data comes only from the real export.
// A genuine positive cohort must pass the separate, unchanged positive audit.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { chromium } from 'playwright'

const record = JSON.parse(await readFile('backend/data/evaluation/track_record.json', 'utf8'))
const scored = record.rows.filter(row => row.status === 'scored')
if (scored.length) {
  console.log('Real eligible history exists; requiring the positive-record browser certification.')
  const result = spawnSync(process.execPath, ['scripts/published_record_audit.mjs'], { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
const port = process.env.QA_PORT || '3154'
const base = process.env.QA_BASE || `http://127.0.0.1:${port}`
const out = process.env.QA_OUT || '/tmp/pitchverse-accuracy-ui'
const checks = [], errors = []
let server, browser
await mkdir(out, { recursive: true })
const scope = (competition = '', season = '', from = '', to = '') => record.rows.filter(row =>
  (!competition || row.competitionId === competition) && (!season || row.season === Number(season))
  && (!from || row.date && row.date >= from) && (!to || row.date && row.date <= to))
const sorted = rows => [...rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.key.localeCompare(b.key))
async function localRoutes(context, unavailable = () => false) {
  // Match the repository's deterministic product/theme harness: an unsupported
  // service-worker API must be absent, rather than return a blocked registration.
  await context.addInitScript(() => { delete Object.getPrototypeOf(navigator).serviceWorker })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(base).origin) return route.fulfill({ body: '' })
    if (url.pathname === '/api/v1/tracking/record' && unavailable()) return route.fulfill({ status: 503, json: { available: false, reason: 'Record temporarily unreadable.' } })
    if (url.pathname.startsWith('/api/') && !['/api/v1/tracking/record', '/api/v1/accuracy/market'].includes(url.pathname))
      return route.fulfill({ json: { available: false, matches: [], data: [] } })
    return route.continue()
  })
}
function observe(page) {
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && /hydrat|#418|#423|#425/.test(message.text())) errors.push(message.text()) })
}
async function text(locator, value) { await locator.getByText(value, { exact: true }).waitFor() }
async function reconcile(page, rows, label) {
  const card = page.getByRole('region', { name: 'Prediction track record', exact: true })
  await text(card, 'Not yet scored')
  await text(card, '0 of 0 games correct')
  assert(!/\d(?:[.,]\d+)?%/.test(await card.textContent()), `${label}: invented outcome percentage`)
  const chart = page.getByRole('region', { name: 'Accuracy over time', exact: true })
  assert.equal(await chart.locator('.recharts-surface').count(), 0, `${label}: empty timeline must not invent points`)
  await text(chart, 'Not yet scored. The timeline starts with the first eligible settled game.')
  const coverage = page.getByRole('region', { name: 'Record coverage', exact: true })
  for (const [name, status] of [['Awaiting verified result', 'pending'], ['Unverified saved records', 'unverified'],
    ['Recorded after kickoff', 'retrospective'], ['Known games without matched forecast', 'missing']]) {
    assert.equal(await coverage.getByText(name, { exact: true }).locator('..').locator('dd').textContent(),
      String(rows.filter(row => row.status === status).length), `${label}: ${name} scope`)
  }
  const history = page.getByRole('region', { name: 'Game by game record', exact: true })
  await page.getByLabel('History view').selectOption('excluded')
  const expected = sorted(rows).slice(0, 25).map(row => row.key)
  assert.deepEqual(await history.locator('article').evaluateAll(nodes => nodes.map(node => node.dataset.recordKey)), expected,
    `${label}: history must use the same exact scoped records`)
  checks.push({ label, rows: rows.length, correct: 0, settled: 0, historyKeys: expected })
}
async function layout(page, label) {
  const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    controls: [...document.querySelectorAll('#main button, #main select, #main input, #main summary, #main a')]
      .filter(node => node.getClientRects().length).map(node => {
        const rect = node.getBoundingClientRect(); return { name: node.textContent?.trim().slice(0, 70), width: rect.width, height: rect.height }
      }) }))
  assert(result.scrollWidth <= result.width, `${label}: document overflow`)
  assert(result.controls.every(control => control.height >= 43.5 && control.width >= 43.5),
    `${label}: small controls ${JSON.stringify(result.controls.filter(c => c.height < 43.5 || c.width < 43.5))}`)
}
try {
  if (!process.env.QA_BASE) {
    assert(/^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536)
    assert.equal(await fetch(base).then(() => true, () => false), false, 'Accuracy QA port occupied')
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { stdio: ['ignore', 'ignore', 'inherit'] })
  }
  const deadline = Date.now() + 30000
  let ready = false
  while (Date.now() < deadline) {
    if (await fetch(`${base}/api/v1/tracking/record`).then(r => r.ok, () => false)) { ready = true; break }
    assert(server?.exitCode == null, 'Accuracy production server exited')
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert(ready, 'Accuracy production server did not become ready')
  const response = await (await fetch(`${base}/api/v1/tracking/record`)).json()
  assert.equal(response.available, true)
  assert.deepEqual(response.record, record, 'Deployed route must serve the actual retained export')
  const women = await (await fetch(`${base}/api/v1/tracking/record?gender=F`)).json()
  assert.equal(women.available, false)
  assert.equal(women.record, undefined, 'Do not substitute men’s history for absent women’s history')
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  const leagues = [...new Set(record.rows.map(row => row.competitionId))].sort()
  for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, hasTouch: width < 768, isMobile: width < 768, serviceWorkers: 'block' })
    await context.addInitScript(theme => { localStorage.setItem('pitchverse-theme', theme); localStorage.setItem('fotpredict.gender', 'men') }, theme)
    await localRoutes(context)
    const page = await context.newPage()
    observe(page)
    await page.goto(`${base}/accuracy`, { waitUntil: 'networkidle' })
    await text(page.getByRole('region', { name: 'Prediction track record' }), 'Not yet scored')
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme)
    assert.equal(await page.getByLabel('Competition').inputValue(), '')
    assert.equal(await page.getByRole('group', { name: 'Choose accuracy league' }).getByRole('button', { name: /^All leagues/ }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByLabel('History view').inputValue(), 'excluded', 'Real unscored history should be immediately inspectable')
    await reconcile(page, record.rows, `${width}-${theme}-all`)
    await layout(page, `${width}-${theme}`)
    await page.screenshot({ path: `${out}/${width}-${theme}-top.png` })
    const history = page.getByRole('region', { name: 'Game by game record' })
    if (record.rows.length > 25) {
      const pages = Math.ceil(record.rows.length / 25)
      const walkAll = width === 390 && theme === 'light'
      const limit = walkAll ? pages : Math.min(2, pages)
      const reached = await history.locator('article').evaluateAll(nodes => nodes.map(n => n.dataset.recordKey))
      for (let i = 1; i < limit; i++) {
        await history.getByRole('button', { name: 'Next games' }).click()
        reached.push(...await history.locator('article').evaluateAll(nodes => nodes.map(n => n.dataset.recordKey)))
      }
      assert.deepEqual(reached, sorted(record.rows).slice(0, walkAll ? undefined : 50).map(r => r.key), 'History pages must expose original records in order without changing the denominator')
      await page.getByRole('button', { name: 'Show the whole record' }).click()
    }
    const first = sorted(record.rows)[0]
    if (first) {
      const item = history.locator('article').first()
      await text(item, `${first.home} vs ${first.away}`)
      await item.getByText('Forecast and verification details', { exact: true }).click()
      assert((await item.textContent()).includes('Excluded from the percentage'))
      if (first.generatedAt) assert((await item.textContent()).includes('Forecast saved'))
      await item.getByText('Advanced: stored exact-score forecast', { exact: true }).click()
      if (first.scoreForecast) await text(item, `${first.scoreForecast.home}–${first.scoreForecast.away}`)
      assert(!(await item.textContent()).includes('Exact score correct'), 'Unsupported rows must not acquire an exact-score grade')
    }
    for (const league of width === 390 && theme === 'light' ? leagues : leagues.slice(0, 2)) {
      await page.getByLabel('Competition').selectOption(league)
      await reconcile(page, scope(league), `${width}-${theme}-${league}`)
    }
    await page.getByRole('group', { name: 'Choose accuracy league' }).getByRole('button', { name: /^All leagues/ }).click()
    assert.equal(await page.getByLabel('Competition').inputValue(), '')
    await reconcile(page, record.rows, `${width}-${theme}-reset`)
    if (record.rows.length) {
      const season = String(record.rows[0].season)
      await page.getByLabel('Season').selectOption(season)
      await reconcile(page, scope('', season), `${width}-${theme}-season`)
      const dated = scope('', season).find(row => row.date)
      if (dated) {
        await page.getByLabel('Games from (UTC)', { exact: true }).fill(dated.date)
        await page.getByLabel('Games through (UTC)', { exact: true }).fill(dated.date)
        const day = scope('', season, dated.date, dated.date)
        assert(day.length > 0, 'Use a real nonempty date window')
        await reconcile(page, day, `${width}-${theme}-real-date-window`)
      }
      await page.getByRole('button', { name: 'Show the whole record' }).click()
    }
    await page.getByLabel('Games from (UTC)', { exact: true }).fill('2099-01-01')
    await reconcile(page, [], `${width}-${theme}-empty-date`)
    await page.getByRole('button', { name: 'Show the whole record' }).click()
    await reconcile(page, record.rows, `${width}-${theme}-restored`)
    const coverage = page.getByRole('region', { name: 'Record coverage' })
    assert((await coverage.textContent()).includes('History through'))
    assert((await coverage.textContent()).includes('Audit rebuilt'))
    assert((await coverage.textContent()).includes('Latest scored result observed Not available'))
    for (const instant of [record.historyThrough, record.generatedAt].filter(Boolean)) {
      const date = new Date(instant).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })
      assert((await coverage.textContent()).includes(date), 'Show original source and audit dates')
    }
    const benchmarkResponse = page.waitForResponse(response => response.url().includes('/api/v1/accuracy/market'))
    await page.getByText('Advanced: paired closing-line benchmark', { exact: true }).click()
    await benchmarkResponse
    assert(!/NaN|Infinity|of the available signal captured/.test(await page.locator('#main').textContent()))
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })))
    assert.deepEqual(violations, [], `${width}-${theme}: accessibility`)
    console.log(`Accuracy availability UI passed ${width}px ${theme}`)
    await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 960 }, serviceWorkers: 'block' })
  let unavailable = true
  await localRoutes(context, () => unavailable)
  const page = await context.newPage()
  observe(page)
  await page.goto(`${base}/accuracy`, { waitUntil: 'networkidle' })
  await text(page, 'Record unavailable')
  assert.equal(await page.locator('[data-track-record-headline]').count(), 0)
  unavailable = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await text(page.getByRole('region', { name: 'Prediction track record' }), 'Not yet scored')
  await page.getByRole('navigation', { name: 'Explore model evidence' }).getByRole('link', { name: /Historical evaluation/ }).click()
  await page.waitForURL('**/evaluation')
  await page.goBack({ waitUntil: 'networkidle' })
  await text(page.getByRole('region', { name: 'Prediction track record' }), 'Not yet scored')
  await context.close()
  assert.deepEqual(errors, [])
  await writeFile(`${out}/report.json`, JSON.stringify({ status: 'passed', scope: 'real zero-cohort availability UI only', browser: browser.version(),
    source: 'actual exported track_record.json and actual route', generatedAt: record.generatedAt, historyThrough: record.historyThrough,
    settled: 0, percent: null, rows: record.rows.length, checks, errors, positiveCertification: 'not claimed; unchanged positive audit dispatches when genuine eligible rows exist' }, null, 2))
} catch (error) {
  await writeFile(`${out}/report.json`, JSON.stringify({ status: 'failed', error: String(error), checks, errors }, null, 2))
  throw error
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
