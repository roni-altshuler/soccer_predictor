// Real exported predictions only. Availability faults never invent model data.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const port = process.env.QA_PORT || '3150'
const base = process.env.QA_BASE || `http://127.0.0.1:${port}`
const out = process.env.QA_OUT || '/tmp/pitchverse-published-record'
const record = JSON.parse(await readFile('backend/data/evaluation/track_record.json', 'utf8'))
const scored = record.rows.filter(r => r.status === 'scored')
const correct = scored.filter(r => r.pick === r.actual.outcome).length
assert(scored.length > 0, 'Positive browser journey requires real eligible data')
const headline = `${(100 * correct / scored.length).toFixed(1)}% correct`
const counts = `${correct} of ${scored.length} games correct`
const checks = [], errors = []
let server, browser
await mkdir(out, { recursive: true })
async function expectText(locator, value) {
  await locator.getByText(value, { exact: true }).waitFor({ state: 'visible' })
}
async function layout(page, label) {
  const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    controls: [...document.querySelectorAll('#main button, #main select, #main input, #main summary, #main a')]
      .filter(e => e.getClientRects().length && !e.closest('details:not([open])') || e.tagName === 'SUMMARY')
      .filter(e => e.getClientRects().length).map(e => ({ name: e.textContent?.trim().slice(0, 60) || e.getAttribute('aria-label') || e.type,
        height: e.getBoundingClientRect().height, width: e.getBoundingClientRect().width })) }))
  assert(result.scrollWidth <= result.width, `${label}: document overflow ${JSON.stringify(result)}`)
  assert(result.controls.every(c => c.height >= 43.5), `${label}: small control ${JSON.stringify(result.controls.filter(c => c.height < 43.5))}`)
  assert(result.controls.every(c => c.width >= 43.5), `${label}: narrow control ${JSON.stringify(result.controls.filter(c => c.width < 43.5))}`)
  checks.push({ label, ...result })
}
try {
  if (!process.env.QA_BASE) {
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { stdio: ['ignore', 'ignore', 'pipe'] })
    server.stderr.on('data', chunk => errors.push({ source: 'server', message: String(chunk).slice(0, 1000) }))
  }
  let ready = false
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}/api/v1/tracking/record`)).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert(ready, 'Production server did not become ready')
  const exported = await (await fetch(`${base}/api/v1/tracking/record`)).json()
  assert.equal(exported.available, true)
  assert.deepEqual(exported.record, record, 'Actual route and generated artifact differ')
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  for (const width of [320, 390, 768, 1440]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 768, isMobile: width < 768 })
      await context.addInitScript(theme => { localStorage.setItem('pitchverse-theme', theme); localStorage.setItem('fotpredict.gender', 'men') }, theme)
      await context.route('**/api/**', route => route.request().url().includes('/tracking/record') ? route.continue() : route.fulfill({ status: 200, json: { available: false, data: [], matches: [] } }))
      const page = await context.newPage()
      page.on('pageerror', e => errors.push({ source: 'page', message: e.message }))
      page.on('console', msg => { if (msg.type() === 'error' && /hydrat|#418|#423|#425/.test(msg.text())) errors.push({ source: 'hydration', message: msg.text() }) })
      await page.goto(`${base}/accuracy`, { waitUntil: 'networkidle' })
      await expectText(page, headline)
      await expectText(page, counts)
      console.log(`${width}-${theme}: real record loaded`)
      const chart = page.getByRole('region', { name: 'Accuracy over time', exact: true })
      await chart.locator('.recharts-surface').waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme)
      await expectText(chart, `Cumulative: ${(100 * correct / scored.length).toFixed(1)}% correct · ${correct} of ${scored.length} games`)
      await layout(page, `${width}-${theme}-whole`)
      await page.screenshot({ path: `${out}/${width}-${theme}-whole.png`, fullPage: true, timeout: 30000 })
      await page.screenshot({ path: `${out}/${width}-${theme}-top.png`, fullPage: false })
      await chart.screenshot({ path: `${out}/${width}-${theme}-chart.png` })
      await chart.getByText('Timeline data table', { exact: true }).click()
      const table = chart.getByRole('table')
      assert((await table.locator('tbody tr').count()) > 1)
      assert((await table.locator('tbody tr').last().textContent()).includes(`${correct}/${scored.length}`))
      await layout(page, `${width}-${theme}-table`)
      const slider = chart.getByRole('slider', { name: 'Inspect timeline point' })
      await slider.focus(); await slider.press('Home')
      assert.equal(await slider.inputValue(), '0')
      await slider.press('End')
      assert((await slider.getAttribute('aria-valuetext')).includes(`${correct} correct of ${scored.length} settled`))
      await chart.getByRole('button', { name: 'Previous date' }).click()
      assert(!(await slider.getAttribute('aria-valuetext')).includes(`${correct} correct of ${scored.length} settled`))
      const plot = chart.locator('.recharts-surface')
      await plot.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      const dotBox = await chart.locator('.recharts-line-dots circle').first().boundingBox()
      const plotBox = await plot.boundingBox()
      assert(dotBox && plotBox)
      // Tap the plot at the first point's calendar coordinate. SVG curves and
      // axes may cover a 3px dot; the whole plot handles ordinary inspection.
      const x = dotBox.x + dotBox.width / 2 + 2, y = plotBox.y + plotBox.height / 2
      if (width < 768) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y)
      // Plot click/tap must select the same first real point as the keyboard Home control.
      await page.waitForFunction(() => document.querySelector('input[aria-label="Inspect timeline point"]')?.value === '0', null, { timeout: 1000 })
      assert.equal(await slider.inputValue(), '0')
      console.log(`${width}-${theme}: native point inspection passed`)
      await page.getByLabel('Calendar grouping').selectOption('day')
      assert((await table.locator('tbody tr').count()) > 5)
      const competition = scored[0].competitionId
      await page.getByLabel('Competition').selectOption(competition)
      const sample = scored.filter(r => r.competitionId === competition)
      const n = sample.filter(r => r.pick === r.actual.outcome).length
      await expectText(page, `${n} of ${sample.length} games correct`)
      await expectText(chart, `Cumulative: ${(100 * n / sample.length).toFixed(1)}% correct · ${n} of ${sample.length} games`)
      await page.getByLabel('Season').selectOption(String(sample[0].season))
      await page.getByLabel('Games from (UTC)').fill('2099-01-01')
      await expectText(page.getByRole('region', { name: 'Prediction track record' }), 'Not yet scored')
      assert.equal(await chart.locator('.recharts-surface').count(), 0)
      await expectText(page, '0 of 0 games correct')
      await page.getByRole('button', { name: 'Show the whole record' }).click()
      await expectText(page, counts)
      const history = page.getByRole('region', { name: 'Game by game record' })
      const pages = Math.ceil(scored.length / 25)
      let shown = await history.locator('article').count()
      for (let p = 1; p < pages; p++) { await history.getByRole('button', { name: 'Next games' }).click(); shown += await history.locator('article').count() }
      assert.equal(shown, scored.length, 'Every scored pick must be reachable')
      await page.getByLabel('History view').selectOption('excluded')
      assert((await history.locator('article').count()) > 0)
      await history.locator('article').first().getByText('Forecast and verification details', { exact: true }).click()
      assert((await history.locator('article').first().textContent()).includes('Excluded from the percentage'))
      await expectText(page, counts)
      if (width === 390 && theme === 'light') {
        const known = record.rows.find(r => r.status === 'unverified' && r.actual)
        assert(known, 'Real export must exercise a known actual result outside the scored sample')
        await page.getByLabel('Competition').selectOption(known.competitionId)
        await page.getByLabel('Games from (UTC)').fill(known.date)
        await page.getByLabel('Games through (UTC)').fill(known.date)
        const heading = history.getByRole('heading', { name: `${known.home} vs ${known.away}`, exact: true })
        while (!await heading.count()) await history.getByRole('button', { name: 'Next games' }).click()
        const item = heading.locator('..').locator('..')
        const outcome = known.actual.outcome === 'H' ? `${known.home} win` : known.actual.outcome === 'D' ? 'Draw' : `${known.away} win`
        await expectText(item, `${known.actual.home}–${known.actual.away} · ${outcome}`)
        await item.getByText('Forecast and verification details', { exact: true }).click()
        assert((await item.textContent()).includes('Excluded from the percentage'))
        await item.screenshot({ path: `${out}/390-known-result-excluded.png` })
        await page.getByRole('button', { name: 'Show the whole record' }).click()
        await expectText(page, counts)
      }
      await layout(page, `${width}-${theme}-history`)
      // Freshness is visible and source data can be inspected directly.
      assert((await page.getByRole('region', { name: 'Record coverage' }).textContent()).includes('Audit rebuilt'))
      await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
      const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })))
      assert.deepEqual(violations, [], `Accessibility: ${JSON.stringify(violations)}`)
      checks.push({ label: `${width}-${theme}-interactions`, headline, counts, allScoredHistoryReachable: shown, axeViolations: violations })
      console.log(`${width}-${theme}: filters, history, layout and accessibility passed`)
      await context.close()
    }
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  let failure = true
  await context.route('**/api/v1/tracking/record*', route => failure ? route.fulfill({ status: 503, json: { available: false, reason: 'The verified game-level record could not be read. No accuracy has been estimated.' } }) : route.continue())
  await context.route('**/api/**', route => route.request().url().includes('/tracking/record') ? route.fallback() : route.fulfill({ status: 200, json: { available: false, matches: [] } }))
  const page = await context.newPage()
  await page.goto(`${base}/accuracy`, { waitUntil: 'networkidle' })
  await expectText(page, 'Record unavailable')
  assert.equal(await page.locator('[data-track-record-headline]').count(), 0)
  await layout(page, '390-source-unavailable')
  await page.screenshot({ path: `${out}/390-source-unavailable.png`, fullPage: true })
  failure = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expectText(page, counts)
  // Repeated client navigation and Back must restore a correct record without stale data.
  await page.getByText('How this record is scored · optional probability metrics', { exact: true }).click()
  const backtest = page.getByRole('link', { name: 'Separate historical backtests and model analysis' })
  await backtest.click({ clickCount: 2 })
  await page.waitForURL('**/evaluation')
  await page.goBack({ waitUntil: 'networkidle' })
  await page.waitForURL('**/accuracy')
  await expectText(page, counts)
  checks.push({ label: 'availability-retry-navigation-back', pass: true })
  await context.close()
  assert.deepEqual(errors.filter(e => e.source !== 'server'), [])
  await writeFile(`${out}/report.json`, JSON.stringify({ status: 'passed', browser: browser.version(), source: 'real generated track_record.json', generatedAt: record.generatedAt, correct, settled: scored.length, percent: 100 * correct / scored.length, checks, errors }, null, 2))
} catch (error) {
  await writeFile(`${out}/report.json`, JSON.stringify({ status: 'failed', error: String(error), checks, errors }, null, 2))
  throw error
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
