import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

/** Use the existing product browser/server and real committed artifact routes.
 * Faults change availability only; other APIs and external hosts stay offline.
 */
export async function checkRecordReliability({ browser, base, out }) {
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
  const report = []
  for (const width of [390, 768, 1440]) for (const theme of ['light', 'dark']) {
    console.log(`Checking Record reliability ${width}px ${theme}`)
    const context = await browser.newContext({ viewport: { width, height: 960 }, timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage(), errors = [], expectedFaults = [], states = []
    let state = 'ready', release, gate
    try {
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        if (['error', 'partial', 'retained'].includes(state) && /Failed to load resource.*503/.test(message.text())) expectedFaults.push(message.text())
        else errors.push(message.text())
      })
      await context.addInitScript(({ theme }) => {
        localStorage.setItem('pitchverse-theme', theme)
        localStorage.setItem('pitchverse-ambient', 'off')
        delete Object.getPrototypeOf(navigator).serviceWorker
      }, { theme })
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(base).origin) return route.fulfill({ body: '' })
        if (responses.has(url.pathname)) {
          if (state === 'loading') await gate
          if (state === 'error' || state === 'retained' || (state === 'partial' && url.pathname.includes('knockout'))) {
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
      async function capture(label) {
        assert.equal(new URL(page.url()).pathname, '/evaluation')
        const palette = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, canvas: getComputedStyle(document.body).backgroundColor, overflow: document.documentElement.scrollWidth > innerWidth }))
        assert.deepEqual(palette, { theme, canvas: theme === 'light' ? 'rgb(245, 243, 238)' : 'rgb(7, 16, 9)', overflow: false })
        await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
        const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })))
        // Existing StatTile groups use div labels/values inside dl. Record that
        // debt explicitly; require every other rule and the new status to pass.
        assert(violations.every((violation) => violation.id === 'definition-list'), `${label}: unexpected accessibility rule`)
        const existingGroups = ['ready', 'recovered', 'partial', 'retained', 'recovered-again'].includes(label) ? 5 : 0
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
      assert.deepEqual(errors, [], `${width} ${theme}: unexpected browser errors`)
      report.push({ width, theme, states, expectedFaults, errors })
    } catch (error) {
      await page.screenshot({ path: `${out}/record-failed-${theme}-${width}.png`, fullPage: true }).catch(() => {})
      console.error({ width, theme, state, url: page.url(), content: await page.locator('#main').innerText().catch(() => ''), errors })
      throw error
    } finally {
      release?.()
      await context.close()
    }
  }
  const result = { basis: 'Existing committed artifacts served through local production routes; injected availability faults only. No provider reads or metric regeneration.', artifacts,
    live: { n: evaluation.live.n, brier: evaluation.live.brier, log_loss: evaluation.live.log_loss, ece: evaluation.live.ece, last_kickoff: evaluation.live.last_kickoff }, report }
  await writeFile(`${out}/record-reliability-report.json`, JSON.stringify(result, null, 2))
  return result
}
