import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { observeBrowserFailures } from './browser_failure_evidence.mjs'

/** Actual local API + committed archive. Only fault cases alter/remove fields.
 * All other APIs and external hosts are intercepted, preventing provider reads.
 */
export async function checkMatchEvidence({ browser, base, out }) {
  // Move the knowledge cutoff with the run, so later current-file outcome
  // corrections aren't accidentally treated as future data by a frozen QA day.
  const asOf = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.parse(asOf) - 90 * 86400000).toISOString().slice(0, 10)
  const query = `league=eng.1&gender=M&from=${from}&asOf=${asOf}`
  const served = await (await fetch(`${base}/api/v1/match-evidence?${query}`)).json()
  assert(served.available && served.records.length > 20)
  const cutoff = await (await fetch(`${base}/api/v1/match-evidence?${query.replace(`asOf=${asOf}`, 'asOf=2026-09-20')}`)).json()
  assert(cutoff.records.filter((r) => r.result).length < served.records.filter((r) => r.result).length)
  assert(cutoff.records.every((r) => !r.result || r.result.knownAt <= '2026-09-20T23:59:59.999Z'))
  for (const bad of ['asOf=bad', 'asOf=2099-01-01', 'from=2026-02-30', 'from=2024-01-01']) {
    const q = new URLSearchParams(query), [name, value] = bad.split('='); q.set(name, value)
    assert.equal((await fetch(`${base}/api/v1/match-evidence?${q}`)).status, 400)
  }
  const report = []
  for (const width of [390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage(), errors = [], expectedFaults = [], pending = []
    let state = 'ready', hold = false
    let phase = 'initial', navigation = 'initial'
    const diagnostics = observeBrowserFailures(page, () => ({ state, hold, phase, navigation, width }))
    try {
      page.on('pageerror', (error) => errors.push({ message: error.message, url: page.url(), state, hold, stack: error.stack }))
      page.on('console', (message) => { if (message.type() === 'error') {
        if (state === 'error' && /Failed to load resource.*ERR_FAILED/.test(message.text())) expectedFaults.push(message.text())
        else errors.push(message.text())
      } })
      await context.addInitScript(() => {
        delete Object.getPrototypeOf(navigator).serviceWorker
        localStorage.setItem('pitchverse-ambient', 'off')
        window.__evidenceWatch = { blocked: false, samples: 0, violations: [] }
        const sample = () => {
          const watch = window.__evidenceWatch
          if (!watch.blocked) return
          watch.samples++
          if (document.querySelector('.match-evidence article')) watch.violations.push(location.href)
        }
        new MutationObserver(sample).observe(document, { subtree: true, childList: true })
        const frame = () => { sample(); requestAnimationFrame(frame) }; requestAnimationFrame(frame)
      })
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(base).origin) return route.fulfill({ body: '' })
        if (url.pathname === '/api/v1/match-evidence') {
          assert.equal(url.searchParams.get('gender'), 'M')
          if (hold) {
            let release; const gate = new Promise((resolve) => { release = resolve })
            let delivered; const done = new Promise((resolve) => { delivered = resolve })
            pending.push({ release, done })
            await gate
            try {
              const raw = url.searchParams.get('asOf') === '2026-09-20' ? cutoff : served
              await route.fulfill({ json: raw })
            } finally { delivered() }
            return
          }
          if (state === 'error') return route.abort('failed')
          if (state === 'empty') return route.fulfill({ json: { ...served, records: [] } })
          if (state === 'sparse') return route.fulfill({ json: { ...served, records: served.records.map((r) => ({ ...r, expectedGoals: [null, null], elo: [null, null], result: null })) } })
          return route.continue()
        }
        if (url.pathname === '/api/v1/season/projections') return route.continue()
        if (url.pathname.includes('/api/')) return route.fulfill({ json: { available: false, standings: [], children: [], events: [], leaders: [], scorers: [] } })
        return route.continue()
      })
      const url = `${base}/leagues/eng.1/evidence?team=Arsenal&from=${from}&asOf=${asOf}&gender=M`
      const region = page.getByRole('region', { name: 'Recorded match evidence' })
      const ready = () => region.waitFor()
      async function audit(label) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: overflow`)
        await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
        const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('.match-evidence'), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })))
        assert.deepEqual(violations, [], `${label}: a11y`)
      }
      const capture = async (label) => {
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
        await page.screenshot({ path: `${out}/evidence-${label}-${width}.png`, fullPage: true })
        await page.screenshot({ path: `${out}/evidence-${label}-${width}-viewport.png` })
      }
      await page.goto(url, { waitUntil: 'networkidle' }); await ready()
      const club = page.getByRole('combobox', { name: 'Club' })
      assert.equal(await club.inputValue(), 'Arsenal')
      const arsenal = served.records.filter((r) => r.home === 'Arsenal' || r.away === 'Arsenal')
      assert.equal(await region.getByRole('article').count(), arsenal.length)
      const example = arsenal.find((r) => r.result) ?? arsenal[0], card = page.getByRole('article', { name: `${example.home} vs ${example.away}`, exact: true })
      await card.getByText(example.expectedGoals.map((v) => v.toFixed(2)).join(' / '), { exact: true }).waitFor()
      if (example.result) await card.getByText(example.result.goals.join(' / '), { exact: true }).waitFor()
      await audit('ready'); await capture('ready')
      phase = 'context'
      await card.getByText('Timing and model context', { exact: true }).click()
      await card.getByText(new RegExp(`recorded fixture ${example.id}`)).waitFor()
      await audit('context'); await capture('context')

      // Genuine sequential keyboard traversal, including date fields and summaries.
      phase = 'keyboard'; navigation = 'keyboard-reload'
      await page.reload({ waitUntil: 'networkidle' }); await ready()
      const forward = [], reverse = []
      const readFocus = () => page.evaluate(() => {
        const n = document.activeElement, r = n.getBoundingClientRect(), s = getComputedStyle(n)
        const front = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return { within: !!n.closest('.match-evidence'), tag: n.tagName, text: (n.labels?.[0]?.textContent ?? n.textContent).trim().slice(0, 90),
          visible: (n.matches(':focus-visible') || (n.tagName === 'INPUT' && n.matches(':focus-within'))) && s.outlineStyle === 'solid' && parseFloat(s.outlineWidth) >= 2 && !!front && n.contains(front), top: r.top, bottom: r.bottom }
      })
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY')
      let entered = false
      for (let step = 0; step < 100; step++) {
        await page.keyboard.press('Tab'); const focus = await readFocus()
        if (!focus.within) { if (entered) break; continue }
        entered = true; assert(focus.visible && focus.top >= 0 && focus.bottom <= 960, JSON.stringify(focus)); forward.push(focus)
      }
      assert(forward.some((f) => f.tag === 'SELECT') && forward.some((f) => f.tag === 'INPUT') && forward.some((f) => f.tag === 'SUMMARY'))
      for (let step = 0; step < forward.length; step++) {
        await page.keyboard.press('Shift+Tab'); const focus = await readFocus()
        assert(focus.within && focus.visible && focus.top >= 0 && focus.bottom <= 960, JSON.stringify(focus)); reverse.push(focus)
      }
      await page.keyboard.press('Shift+Tab'); assert.equal((await readFocus()).within, false)
      await page.getByText(`Calibration · ${arsenal.filter((r) => r.result).length} matches`, { exact: true }).click()
      await audit('calibration'); await capture('calibration')
      await club.selectOption('Fulham'); assert((await region.getByRole('article').count()) > 0)
      await club.selectOption('Arsenal')
      for (let cycle = 0; cycle < 3; cycle++) {
        phase = `comparison-cycle-${cycle}`
        await page.getByRole('link', { name: 'Back to club comparison' }).click()
        await page.getByRole('region', { name: 'Club comparison' }).waitFor()
        await page.getByRole('link', { name: 'Explore Arsenal match evidence', exact: true }).click(); await ready()
        assert.equal(await club.inputValue(), 'Arsenal')
        if (cycle === 1) { await page.goBack(); await page.getByRole('region', { name: 'Club comparison' }).waitFor(); await page.goForward(); await ready() }
      }

      for (const variant of ['empty', 'sparse', 'error']) {
        phase = variant; navigation = variant
        state = variant; await page.goto(url, { waitUntil: 'networkidle' })
        if (variant === 'empty') await page.getByRole('heading', { name: 'No eligible matches' }).waitFor()
        if (variant === 'sparse') { await ready(); if (example.result) assert.equal(await page.getByText(example.result.goals.join(' / '), { exact: true }).count(), 0); await page.getByText(/0 results known/).waitFor() }
        if (variant === 'error') await page.getByRole('heading', { name: 'Couldn’t read the archive' }).waitFor()
        await audit(variant); await capture(variant)
      }
      phase = 'retry'; state = 'ready'
      await page.getByRole('button', { name: 'Try again' }).click(); await ready()

      // Independently held old/new date responses; releasing old cannot paint cards.
      phase = 'held-date'; navigation = 'held-date'
      hold = true; await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.getByText('Loading recorded match evidence…', { exact: true }).waitFor()
      const waitRequests = async (n) => { for (let i = 0; pending.length < n && i < 100; i++) await page.waitForTimeout(20); assert.equal(pending.length, n) }
      await waitRequests(1); await audit('loading'); await capture('loading')
      await page.getByLabel('Results known through (UTC)').fill('2026-09-20')
      await page.getByRole('button', { name: 'Apply dates' }).click(); await waitRequests(2)
      await page.evaluate(() => { window.__evidenceWatch.blocked = true })
      pending[0].release(); await pending[0].done; await page.waitForTimeout(150)
      assert.equal(await region.count(), 0)
      assert.deepEqual(await page.evaluate(() => window.__evidenceWatch.violations), [])
      await page.evaluate(() => { window.__evidenceWatch.blocked = false })
      pending[1].release(); await pending[1].done; await ready()
      const known = cutoff.records.filter((r) => (r.home === 'Arsenal' || r.away === 'Arsenal') && r.result).length
      await page.getByText(new RegExp(`${known} results known by 2026-09-20`)).waitFor()
      await capture('cutoff')
      // Held men response after canonical women preference cannot paint men data.
      phase = 'held-gender'; navigation = 'held-gender'
      await page.goto(url, { waitUntil: 'domcontentloaded' }); await waitRequests(3)
      await page.evaluate(() => { window.__evidenceWatch.blocked = true; localStorage.setItem('fotpredict.gender', 'women'); window.dispatchEvent(new CustomEvent('pitchwise:gender-change', { detail: 'women' })) })
      await page.getByText(/Women’s match evidence is unavailable/).waitFor()
      pending[2].release(); await pending[2].done; await page.waitForTimeout(150)
      assert.equal(pending.length, 3); assert.equal(await region.count(), 0)
      const watch = await page.evaluate(() => window.__evidenceWatch)
      assert(watch.samples > 0); assert.deepEqual(watch.violations, [])
      await audit('gender'); await capture('gender')
      assert.deepEqual(errors, [])
      report.push({ width, actualServingApi: true, clubSelection: true, repeatedNavigations: 3, browserBackForward: true, keyboard: { forward, reverse, forcedFocusCalls: 0 },
        loadingEmptySparseErrorRetry: true, delayedDateResponse: true, delayedGenderResponse: true, transientStaleCards: watch.violations, accessibilityViolations: 0, overflow: false, expectedFaults, errors })
    } catch (error) {
      const observedAt = new Date().toISOString()
      await page.screenshot({ path: `${out}/evidence-failed-${width}.png`, fullPage: true }).catch(() => {})
      await writeFile(`${out}/evidence-failed-${width}.json`, JSON.stringify({
        width, state, hold, phase, navigation, url: page.url(), errors, expectedFaults,
        failure: { observedAt, message: error.message, stack: error.stack },
        browserEvents: await diagnostics.flush(),
      }, null, 2))
      throw error
    } finally {
      for (const p of pending) p.release()
      await writeFile(`${out}/evidence-browser-${width}.json`, JSON.stringify(await diagnostics.flush(), null, 2))
      await context.close()
    }
  }
  const result = { basis: 'Existing committed monthly forecasts through the actual local API; fault variants remove fields/fail transport only. No provider calls or imported data.',
    asOf, from, sourceAudit: { matches: served.records.length, knownResults: served.records.filter((r) => r.result).length, earlierCutoff: cutoff.asOf, earlierKnownResults: cutoff.records.filter((r) => r.result).length }, report }
  await writeFile(`${out}/match-evidence-report.json`, JSON.stringify(result, null, 2))
  return result
}
