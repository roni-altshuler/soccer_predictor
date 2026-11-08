import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const settle = (page) => page.evaluate(() => new Promise((resolve) => {
  let frames = 0
  const next = () => requestAnimationFrame(() => ++frames === 8 ? resolve() : next())
  next()
}))

/** Follow-up review: real Tab traversal (no focus API) and independently held
 * responses. Normal data remains the existing authorized serving artifact.
 */
export async function checkComparisonReview({ browser, base, out, artifact }) {
  const report = []
  for (const width of [390, 1440]) {
    for (const scenario of ['keyboard', 'keyboard-empty', 'gender', 'gender-return', 'league']) {
      console.log(`Checking comparison review ${width}px ${scenario}`)
      const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
      const page = await context.newPage()
      const pending = [], errors = [], aborted = []
      const hold = !scenario.startsWith('keyboard')
      let emptySnapshot = scenario === 'keyboard-empty'
      try {
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
        page.on('requestfailed', (request) => {
          if (new URL(request.url()).pathname === '/api/v1/season/projections') aborted.push(request.failure()?.errorText)
        })
        await context.addInitScript(() => {
          localStorage.setItem('pitchverse-ambient', 'off')
          delete Object.getPrototypeOf(navigator).serviceWorker
          // Observe DOM commits and actual painted frames, including transient
          // stale cards that a final-state assertion would miss.
          window.__comparisonWatch = { blocked: false, samples: 0, violations: [] }
          const sample = () => {
            const state = window.__comparisonWatch
            if (!state.blocked) return
            state.samples++
            const cards = [...document.querySelectorAll('.team-comparison article')].map((n) => n.getAttribute('aria-label'))
            if (cards.length) state.violations.push({ path: location.pathname, cards })
          }
          new MutationObserver(sample).observe(document, { childList: true, subtree: true })
          const frame = () => { sample(); requestAnimationFrame(frame) }
          requestAnimationFrame(frame)
        })
        await context.route('**/*', async (route) => {
          const url = new URL(route.request().url())
          if (url.origin !== new URL(base).origin) return route.fulfill({ json: { children: [], events: [], leaders: [] } })
          if (url.pathname === '/api/v1/season/projections') {
            assert.equal(url.searchParams.get('gender'), 'M')
            if (emptySnapshot) return route.fulfill({ json: { available: false } })
            if (!hold) return route.continue()
            // Same-origin Referer identifies the document that initiated this
            // fetch, even if navigation has since changed the page's URL.
            const referer = route.request().headers().referer
            assert(referer, 'Held snapshot reads must identify their initiating document')
            const owner = new URL(referer)
            assert.equal(owner.origin, new URL(base).origin)
            assert(['/leagues/eng.1/compare', '/leagues/usa.1', '/leagues/usa.1/compare'].includes(owner.pathname), 'Unexpected snapshot request owner')
            const gate = deferred(), delivered = deferred()
            const entry = { gate, delivered, owner: owner.pathname, gender: 'M', released: false }
            pending.push(entry)
            await gate.promise
            entry.released = true
            try { await route.fulfill({ json: { available: true, ...artifact } }) }
            finally { delivered.resolve() }
            return
          }
          if (url.pathname.includes('/api/')) return route.fulfill({ json: { available: false, standings: [], children: [], events: [], leaders: [], scorers: [] } })
          return route.continue()
        })
        const region = page.getByRole('region', { name: 'Club comparison' })
        const waitRequests = async (count) => {
          for (let tries = 0; pending.length < count && tries < 80; tries++) await page.waitForTimeout(25)
          assert.equal(pending.length, count)
        }
        await page.goto(`${base}/leagues/eng.1/compare?gender=M`, { waitUntil: hold ? 'domcontentloaded' : 'networkidle' })
        if (!hold) {
          if (emptySnapshot) await page.getByRole('status').filter({ hasText: 'Two identifiable clubs' }).waitFor()
          else await region.waitFor()
          const clubNames = artifact.leagues.find((l) => l.competition_id === 'eng.1').table.map((row) => row.team).sort((a, b) => a.localeCompare(b))
          const order = emptySnapshot ? ['Back to league', 'Try again'] : ['Back to league', 'First club', 'Second club', 'Swap', `Explore ${clubNames[1]} match evidence`, `Explore ${clubNames.at(-1)} match evidence`, 'View source snapshot', 'How to read this comparison']
          const inspected = []
          const active = () => page.evaluate(() => {
            const node = document.activeElement
            const label = node.labels?.[0]?.querySelector('span')?.textContent ?? node.textContent?.trim().replace(/\s+/g, ' ').replace(/\s*→$/, '')
            const rect = node.getBoundingClientRect(), style = getComputedStyle(node)
            const front = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            return { within: !!node.closest('.team-comparison'), label,
              visibleFocus: node.matches(':focus-visible') && style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) >= 2,
              unobscured: !!front && node.contains(front), top: rect.top, bottom: rect.bottom }
          })
          // Start at the document's natural position; traverse the shell too.
          assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY')
          let steps = 0
          while (inspected.length < order.length && steps++ < 32) {
            await page.keyboard.press('Tab')
            const item = await active()
            if (!item.within) continue
            assert.equal(item.label, order[inspected.length], 'Sequential comparison order')
            assert(item.visibleFocus && item.unobscured && item.top >= 0 && item.bottom <= 960, `Focus must be visible above fixed chrome: ${JSON.stringify(item)}`)
            inspected.push(item)
            await page.screenshot({ path: `${out}/comparison-tab-${scenario}-${width}-${inspected.length}.png` })
            if (item.label === 'First club') {
              // End changes a closed native select. Enter would reopen its
              // picker, making the next Tab close the picker rather than move.
              await page.keyboard.press('End')
              const last = artifact.leagues.find((l) => l.competition_id === 'eng.1').table.map((row) => row.team).sort((a, b) => a.localeCompare(b)).at(-1)
              assert.equal(await page.getByRole('combobox', { name: 'First club' }).inputValue(), last)
            }
            if (item.label === 'Swap') {
              const selectors = page.locator('.team-comparison').getByRole('combobox')
              const before = [await selectors.nth(0).inputValue(), await selectors.nth(1).inputValue()]
              await page.keyboard.press('Enter')
              assert.deepEqual([await selectors.nth(0).inputValue(), await selectors.nth(1).inputValue()], before.reverse())
            }
          }
          assert.equal(inspected.length, order.length)
          await page.keyboard.press('Tab')
          assert.equal((await active()).within, false, 'Tab can leave the comparison')
          const reverse = []
          for (const name of [...order].reverse()) {
            await page.keyboard.press('Shift+Tab')
            const item = await active()
            assert.equal(item.label, name, 'Reverse sequential order')
            assert(item.visibleFocus && item.unobscured, `Reverse focus: ${JSON.stringify(item)}`)
            reverse.push(item)
            if (name === 'Back to league') await page.screenshot({ path: `${out}/comparison-reverse-back-${scenario}-${width}.png` })
          }
          await page.keyboard.press('Shift+Tab')
          assert.equal((await active()).within, false, 'Shift+Tab can leave the comparison')
          if (emptySnapshot) {
            // Enter the shared retry control using the same sequential order.
            for (const name of order) {
              await page.keyboard.press('Tab')
              assert.equal((await active()).label, name)
            }
            emptySnapshot = false
            await page.keyboard.press('Enter'); await region.waitFor()
          }
          report.push({ width, scenario, naturalTabSteps: steps, order: inspected, reverse, exitsBothDirections: true,
            keyboardSelectorAndSwap: scenario === 'keyboard', keyboardRetry: scenario === 'keyboard-empty', forcedFocusCalls: 0, unexpectedErrors: errors })
        } else {
          await page.getByRole('status').filter({ hasText: 'Loading club comparison' }).waitFor()
          await page.waitForFunction(() => !!window.__comparisonWatch)
          await waitRequests(1)
          assert.equal(pending[0].owner, '/leagues/eng.1/compare', 'The original comparison owns its held read')
          await page.evaluate(() => { window.__comparisonWatch.blocked = true })
          const preference = async (gender) => {
            // The public gender switch is intentionally absent. Exercise the
            // actual hook's canonical same-tab input, without adding a control.
            await page.evaluate((value) => {
              localStorage.setItem('fotpredict.gender', value)
              window.dispatchEvent(new CustomEvent('pitchwise:gender-change', { detail: value }))
            }, gender)
          }
          let boundaryRead = null
          if (scenario.startsWith('gender')) {
            await preference('women')
            await page.getByText(/A women’s season comparison is unavailable/).waitFor()
            assert.equal(pending.length, 1, 'Women must not request the men snapshot')
            if (scenario === 'gender-return') {
              await preference('men')
              await page.getByRole('status').filter({ hasText: 'Loading club comparison' }).waitFor()
            }
          } else {
            const nav = width < 768 ? page.getByRole('navigation', { name: 'Mobile navigation' }) : page.getByRole('complementary', { name: 'Primary' })
            await nav.getByRole('link', { name: 'Leagues', exact: true }).click()
            await page.locator('a[href="/leagues/usa.1"]').click()
            await waitRequests(2)
            assert.deepEqual(pending.map((entry) => entry.owner), ['/leagues/eng.1/compare', '/leagues/usa.1'], 'The MLS boundary owns a separate read before comparison navigation')
            boundaryRead = pending[1]
            boundaryRead.gate.resolve(); await boundaryRead.delivered.promise
            await page.getByRole('tablist', { name: 'League sections' }).waitFor()
            await settle(page)
            assert.equal(await region.count(), 0, 'Resolving the league boundary must not render comparison cards')
            assert.deepEqual((await page.evaluate(() => window.__comparisonWatch)).violations, [], 'The boundary response cannot paint stale comparison cards')
            await page.getByRole('link', { name: 'Compare clubs · Season snapshot' }).click()
            await page.getByText('MLS · Season snapshot', { exact: true }).waitFor()
            await page.getByRole('status').filter({ hasText: 'Loading club comparison' }).waitFor()
          }
          const expectedOwners = scenario === 'league'
            ? ['/leagues/eng.1/compare', '/leagues/usa.1', '/leagues/usa.1/compare']
            : scenario === 'gender-return' ? ['/leagues/eng.1/compare', '/leagues/eng.1/compare'] : ['/leagues/eng.1/compare']
          await waitRequests(expectedOwners.length)
          assert.deepEqual(pending.map((entry) => entry.owner), expectedOwners, 'Exact snapshot ownership and request order')
          const currentRead = scenario === 'gender' ? null : pending.at(-1)
          if (currentRead) assert.equal(currentRead.released, false, 'The current comparison response stays held during stale-response checks')
          pending[0].gate.resolve(); await pending[0].delivered.promise; await settle(page)
          assert.equal(await region.count(), 0, 'Releasing the stale men response must not display cards')
          if (scenario === 'gender') await page.getByText(/A women’s season comparison is unavailable/).waitFor()
          else await page.getByRole('status').filter({ hasText: 'Loading club comparison' }).waitFor()
          const watched = await page.evaluate(() => window.__comparisonWatch)
          assert(watched.samples >= 8)
          assert.deepEqual(watched.violations, [], 'No stale cards in DOM commits or painted frames')
          await page.screenshot({ path: `${out}/comparison-delayed-${scenario}-${width}.png` })
          if (scenario !== 'gender') {
            await page.evaluate(() => { window.__comparisonWatch.blocked = false })
            currentRead.gate.resolve(); await currentRead.delivered.promise; await region.waitFor()
            const target = scenario === 'league' ? 'usa.1' : 'eng.1'
            const league = artifact.leagues.find((entry) => entry.competition_id === target)
            const completed = league.state === 'regular_season_completed'
            const rows = completed ? league.observed_table : league.table
            assert(Array.isArray(rows), 'The current comparison uses rows owned by its explicit season state')
            const expected = rows.map((row) => row.team).sort((a, b) => a.localeCompare(b))
            if (completed) assert.equal(expected.length, 30, 'The fresh MLS comparison contains all 30 observed clubs')
            for (const name of ['First club', 'Second club']) {
              assert.deepEqual(await page.getByRole('combobox', { name }).locator('option').allTextContents(), expected)
            }
            if (completed) {
              await page.getByRole('heading', { name: 'Regular season completed', exact: true }).waitFor()
              await page.getByText('Observed regular season', { exact: true }).waitFor()
              assert.equal(await region.getByText('Conference position', { exact: true }).count(), 2)
              assert.doesNotMatch(await page.locator('.team-comparison').innerText(), /Projected final points|Model forecast|\d+(?:\.\d+)?%/i, 'Fresh observed MLS must not display forecast figures')
            }
          }
          assert.deepEqual(pending.map((entry) => entry.owner), expectedOwners, 'No extra snapshot read after response delivery')
          report.push({ width, scenario, boundaryResponseResolved: boundaryRead?.released ?? false, requestOwners: pending.map((entry) => entry.owner), staleResponseReleased: true, currentResponseHeldUntilAfterStaleCheck: scenario !== 'gender',
            observedDomAndPaintSamples: watched.samples, transientStaleCards: watched.violations, requests: pending.length,
            abortedRequests: aborted, freshContextRendered: scenario !== 'gender', unexpectedErrors: errors })
        }
        assert.deepEqual(errors, [], 'Unexpected browser console/page errors')
      } catch (error) {
        await page.screenshot({ path: `${out}/comparison-review-failure-${scenario}-${width}.png`, fullPage: true })
        throw error
      } finally {
        pending.forEach((entry) => entry.gate.resolve())
        await context.close()
      }
    }
  }
  const result = { basis: 'Actual browser and running frontend. Authorized local serving snapshot only; held responses exercise cancellation/stale-data guards. Gender uses the existing canonical preference event because its public switch is hidden. League changes use actual app links. Keyboard traversal uses only Tab/Shift+Tab/Enter/End, without force-focus.', report }
  await writeFile(`${out}/comparison-targeted-review.json`, JSON.stringify(result, null, 2))
  return result
}
