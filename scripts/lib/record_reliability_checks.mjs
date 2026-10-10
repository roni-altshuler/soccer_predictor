import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { observeBrowserFailures } from './browser_failure_evidence.mjs'

/** Use the existing product browser/server and real committed artifact routes.
 * Faults change availability only; other APIs and external hosts stay offline.
 */
export async function checkRecordReliability({ browser, base, out }) {
  const axeSource = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
  const sources = [
    ['/api/v1/evaluation', 'backend/data/evaluation/live.json'],
    ['/api/v1/season/projections', 'backend/data/predictions/season_projections.json'],
  ]
  const artifacts = [], responses = new Map()
  for (const [route, file] of sources) {
    const bytes = await readFile(file), artifact = JSON.parse(bytes)
    const response = await fetch(`${base}${route}`)
    assert.equal(response.status, 200)
    const served = await response.json()
    assert.deepEqual(served, { ...artifact, available: true })
    responses.set(route, served)
    artifacts.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), generated_at: artifact.generated_at })
  }
  const knockout = await (await fetch(`${base}/api/v1/tournaments/knockout`)).json()
  assert.equal(knockout.available, true)
  responses.set('/api/v1/tournaments/knockout', knockout)
  const evaluation = responses.get('/api/v1/evaluation')
  const measured = responses.get('/api/v1/season/projections').leagues.find((league) => league.competition_id === 'eng.1').measured
  assert(measured.n_scored > 0 && evaluation.live.by_league['eng.1'].n > 0)
  const report = []
  for (const width of [390, 768, 1440]) for (const theme of ['light', 'dark']) {
    console.log(`Checking Record reliability ${width}px ${theme}`)
    const context = await browser.newContext({ viewport: { width, height: 960 }, timezoneId: 'UTC', colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage(), errors = [], expectedFaults = [], states = []
    let state = 'ready', release, gate
    let failedSources = new Set()
    let lastAccessibility = null
    const diagnostics = observeBrowserFailures(page, () => ({ state, width, theme }))
    try {
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        if ((failedSources.size || ['error', 'partial', 'retained'].includes(state)) && /Failed to load resource.*503/.test(message.text())) expectedFaults.push(message.text())
        else errors.push(message.text())
      })
      await context.addInitScript(({ theme }) => {
        if (!sessionStorage.getItem('record-qa-seeded')) {
          localStorage.setItem('pitchverse-theme', theme)
          localStorage.setItem('theme', theme)
          sessionStorage.setItem('record-qa-seeded', '1')
        }
        localStorage.setItem('pitchverse-ambient', 'off')
        delete Object.getPrototypeOf(navigator).serviceWorker
      }, { theme })
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(base).origin) return route.fulfill({ body: '' })
        if (responses.has(url.pathname)) {
          if (state === 'loading') await gate
          if (failedSources.has(url.pathname) || state === 'error' || state === 'retained' || (state === 'partial' && url.pathname.includes('knockout'))) {
            return route.fulfill({ status: 503, json: { available: false, reason: 'Deliberate read failure' } })
          }
          if (state === 'empty') return route.fulfill({ json: { available: false } })
          return route.continue()
        }
        if (url.pathname.includes('/api/')) return route.fulfill({ json: { available: false, live: [], upcoming: [], completed: [], children: [], events: [] } })
        return route.continue()
      })
      const dates = page.getByRole('region', { name: 'Evidence dates' })
      const notice = page.getByRole('status', { name: 'Evidence read failure' })
      async function ready() {
        await dates.waitFor()
        assert.equal(await dates.locator('time').nth(0).getAttribute('datetime'), evaluation.generated_at)
        assert.equal(await dates.locator('time').nth(1).getAttribute('datetime'), evaluation.live.last_kickoff)
        await page.getByText(evaluation.live.brier.toFixed(5), { exact: true }).first().waitFor()
      }
      async function measuredReady() {
        await page.getByText(measured.brier.toFixed(5), { exact: true }).first().waitFor()
        await page.getByText(measured.n_scored.toLocaleString('en-US'), { exact: true }).first().waitFor()
      }
      async function liveReady() {
        const row = evaluation.live.by_league['eng.1']
        await page.getByText(row.brier.toFixed(5), { exact: true }).first().waitFor()
        await page.getByText(row.n.toLocaleString('en-US'), { exact: true }).first().waitFor()
      }
      async function capture(label) {
        assert.equal(new URL(page.url()).pathname, '/evaluation')
        // The SSR skeleton can precede hydration. Wait for the mounted theme
        // control; evaluating axe avoids inserting nodes in React's head.
        await page.waitForFunction((theme) => document.querySelector('select[aria-label="Color theme"]')?.value === theme, theme)
        const palette = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, canvas: getComputedStyle(document.body).backgroundColor, overflow: document.documentElement.scrollWidth > innerWidth }))
        assert.deepEqual(palette, { theme, canvas: theme === 'light' ? 'rgb(245, 243, 238)' : 'rgb(7, 16, 9)', overflow: false })
        await page.evaluate(axeSource)
        const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })))
        lastAccessibility = { label, violations }
        // Existing StatTile groups use div labels/values inside dl. Record that
        // debt explicitly; require every other rule and the new status to pass.
        assert(violations.every((violation) => violation.id === 'definition-list'), `${label}: unexpected accessibility rule ${JSON.stringify(violations)}`)
        const existingGroups = label === 'evaluation-initial' ? 1 : label === 'projections-initial' ? 4
          : ['loading', 'empty', 'error'].includes(label) ? 0 : 5
        assert.equal(violations.flatMap((violation) => violation.targets).length, existingGroups, `${label}: existing definition groups changed`)
        const statusViolations = await page.evaluate(async () => {
          const status = document.querySelector('[aria-label="Evidence read failure"]')
          return status ? (await window.axe.run(status, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(({ id }) => id) : []
        })
        assert.deepEqual(statusViolations, [], `${label}: read status accessibility`)
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
        await page.screenshot({ path: `${out}/record-${label}-${theme}-${width}.png`, fullPage: true })
        await page.screenshot({ path: `${out}/record-${label}-${theme}-${width}-viewport.png` })
        states.push({ label, url: page.url(), ...palette, existingAccessibilityViolations: violations, readStatusAccessibilityViolations: statusViolations })
      }
      await page.goto(base, { waitUntil: 'networkidle' })
      const nav = width < 768 ? page.getByRole('navigation', { name: 'Mobile navigation' }) : page.getByRole('complementary', { name: 'Primary' })
      if (width < 768) {
        await page.getByRole('link', { name: 'Season forecast record', exact: true }).click()
      } else {
        await nav.getByRole('link', { name: 'Evaluation', exact: true }).click()
      }
      await ready(); await capture('ready')
      state = 'loading'; gate = new Promise((resolve) => { release = resolve })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('status', { name: 'Loading evaluation' }).waitFor()
      await capture('loading'); state = 'ready'; release(); await ready()
      state = 'empty'; await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'No evaluation has been generated here' }).waitFor()
      assert.equal(await notice.count(), 0); await capture('empty')
      state = 'error'; await page.reload({ waitUntil: 'networkidle' }); await notice.waitFor()
      assert.equal(await page.getByText('No evaluation has been generated here').count(), 0)
      assert.equal(await dates.count(), 0); await capture('error')
      state = 'ready'
      const retry = page.getByRole('button', { name: 'Try again', exact: true })
      await retry.focus(); await page.keyboard.press('Enter')
      await ready(); assert.equal(await notice.count(), 0); await capture('recovered')
      state = 'partial'; await page.reload({ waitUntil: 'networkidle' }); await notice.waitFor(); await ready()
      assert.match(await notice.innerText(), /Tournament record/)
      assert.doesNotMatch(await notice.innerText(), /Published match record/); await capture('partial')
      state = 'retained'; await retry.click(); await notice.waitFor(); await ready()
      assert.match(await notice.innerText(), /Published match record/); await capture('retained')
      state = 'ready'; await retry.click(); await ready()
      await notice.waitFor({ state: 'detached' }); await capture('recovered-again')

      for (const [source, route, name] of [
        ['evaluation', '/api/v1/evaluation', 'Published match record'],
        ['projections', '/api/v1/season/projections', 'League record'],
      ]) {
        state = `${source}-initial`; failedSources = new Set([route])
        await page.reload({ waitUntil: 'networkidle' }); await notice.waitFor()
        assert.match(await notice.innerText(), new RegExp(name))
        assert.doesNotMatch(await notice.innerText(), /Tournament record/)
        if (source === 'evaluation') {
          await measuredReady()
          await page.getByRole('heading', { name: 'Pooled match record unavailable', exact: true }).waitFor()
          assert.equal(await dates.count(), 0)
          assert.equal(await page.getByRole('region', { name: 'The two records' }).count(), 0)
          for (const claim of [/No evaluation has been generated/, /No backtest has been generated/, /Nothing (has been )?scored/i, /A fact about the calendar/]) {
            assert.equal(await page.getByText(claim).count(), 0, `${source}: fabricated empty claim ${claim}`)
          }
          assert.equal(await page.getByText('0', { exact: true }).count(), 0, 'No fabricated zero sample')
        } else {
          await ready(); await liveReady()
          await page.getByText('League record couldn’t be read. Try again to load its measured evidence.').waitFor()
          assert.equal(await page.getByText(/No measured block has been published|no measured block yet/).count(), 0)
          assert.equal(await page.getByText(measured.brier.toFixed(5), { exact: true }).count(), 0)
        }
        await capture(`${source}-initial`)

        // Recover this source while a separate knockout failure keeps retry
        // available, then fail this source again without remounting the page.
        state = `${source}-recovered-partial`; failedSources = new Set(['/api/v1/tournaments/knockout'])
        await retry.click()
        await notice.getByText(/Couldn’t read: Tournament record\./).waitFor()
        await ready(); await measuredReady(); await liveReady()
        assert.equal(await page.getByText(/record couldn’t be read/).count(), 0)
        await capture(`${source}-recovered-partial`)

        state = `${source}-retained`; failedSources = new Set([route])
        await retry.click()
        await notice.getByText(new RegExp(`Couldn’t read: ${name}\\.`)).waitFor()
        await ready(); await measuredReady(); await liveReady()
        assert.equal(await page.getByText(/record couldn’t be read/).count(), 0)
        await capture(`${source}-retained`)

        state = 'ready'; failedSources.clear(); await retry.click()
        await ready(); await notice.waitFor({ state: 'detached' })
        await capture(`${source}-recovered`)
      }
      assert.deepEqual(errors, [], `${width} ${theme}: unexpected browser errors`)
      report.push({ width, theme, states, expectedFaults, errors })
    } catch (error) {
      const observedAt = new Date().toISOString()
      await page.screenshot({ path: `${out}/record-failed-${theme}-${width}.png`, fullPage: true }).catch(() => {})
      await writeFile(`${out}/record-failed-${theme}-${width}.json`, JSON.stringify({
        width, theme, state, url: page.url(), errors, expectedFaults,
        failure: { message: error.message, stack: error.stack, observedAt, state }, lastAccessibility,
        browserEvents: await diagnostics.flush(),
      }, null, 2))
      console.error({ width, theme, state, url: page.url(), content: await page.locator('#main').innerText().catch(() => ''), errors })
      throw error
    } finally {
      release?.()
      await writeFile(`${out}/record-browser-${theme}-${width}.json`, JSON.stringify(await diagnostics.flush(), null, 2))
      await context.close()
    }
  }
  const result = { basis: 'Existing committed artifacts served through local production routes; injected availability faults only. No provider reads or metric regeneration.', artifacts,
    live: { n: evaluation.live.n, brier: evaluation.live.brier, log_loss: evaluation.live.log_loss, ece: evaluation.live.ece, last_kickoff: evaluation.live.last_kickoff }, report }
  await writeFile(`${out}/record-reliability-report.json`, JSON.stringify(result, null, 2))
  return result
}
