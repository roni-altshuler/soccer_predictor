import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { checkComparisonReview } from './team_comparison_review_checks.mjs'

/** Real browser / existing local serving API / committed artifact. Only faults
 * remove data or fail transport. Other APIs/hosts are intercepted: no provider
 * collection, model execution, credentials or copied assets.
 */
export async function checkTeamComparison({ browser, base, out }) {
  const artifact = JSON.parse(await readFile('backend/data/predictions/season_projections.json', 'utf8'))
  const served = await (await fetch(`${base}/api/v1/season/projections?gender=M`)).json()
  assert.deepEqual(served, { available: true, ...artifact }, 'Serving API must return the committed snapshot')
  const clubs = [...artifact.leagues.find((l) => l.competition_id === 'eng.1').table].sort((a, b) => a.team.localeCompare(b.team))
  assert(clubs.length >= 3 && clubs.some((c) => c.team === 'Arsenal') && clubs.some((c) => c.team === 'Manchester City'))
  const report = []
  for (const width of [390, 768, 1440]) {
    console.log(`Checking club comparison ${width}px`)
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage()
    const errors = [], expectedFaultMessages = [], snapshotRequests = [], blockedExternal = []
    let state = 'ready', gate, release
    try {
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        if (state === 'error' && /Failed to load resource.*ERR_FAILED/.test(message.text())) expectedFaultMessages.push(message.text())
        else errors.push(message.text())
      })
      await context.addInitScript(() => {
        localStorage.setItem('pitchverse-ambient', 'off')
        delete Object.getPrototypeOf(navigator).serviceWorker
      })
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(base).origin) {
          blockedExternal.push(url.hostname)
          if (route.request().resourceType() !== 'image') return route.fulfill({ json: { children: [], events: [], leaders: [] } })
          return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>' })
        }
        if (url.pathname === '/api/v1/season/projections') {
          snapshotRequests.push({ gender: url.searchParams.get('gender'), state })
          assert.equal(url.searchParams.get('gender'), 'M')
          if (state === 'loading') await gate
          if (state === 'error') return route.abort('failed')
          if (state === 'empty') return route.fulfill({ json: { available: false } })
          if (state === 'sparse') return route.fulfill({ json: { ...served, leagues: served.leagues.map((l) => ({ ...l,
            table: l.table.map(({ played, points, exp_points, ...row }) => row),
          })) } })
          return route.continue()
        }
        if (url.pathname.includes('/api/')) return route.fulfill({ json: { available: false, standings: [], children: [], events: [], leaders: [], scorers: [] } })
        return route.continue()
      })
      const compare = `${base}/leagues/eng.1/compare`
      const first = page.getByRole('combobox', { name: 'First club' })
      const second = page.getByRole('combobox', { name: 'Second club' })
      const region = page.getByRole('region', { name: 'Club comparison' })
      async function audit(label) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: overflow`)
        await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
        const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('.team-comparison'), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        })).violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((n) => n.target) })))
        assert.deepEqual(violations, [], `${label}: accessibility violations`)
        const small = await page.locator('.team-comparison button, .team-comparison select, .team-comparison a').evaluateAll((nodes) => nodes.filter((node) => {
          const r = node.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)
        }).map((node) => node.textContent))
        assert.deepEqual(small, [], `${label}: control sizes`)
      }
      async function capture(label) {
        await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0) })
        await page.screenshot({ path: `${out}/comparison-${label}-${width}.png`, fullPage: true })
        await page.screenshot({ path: `${out}/comparison-${label}-${width}-viewport.png` })
      }
      async function focus(locator) {
        await page.keyboard.press('Tab'); await locator.focus()
        const style = await locator.evaluate((node) => ({ focused: document.activeElement === node,
          outline: getComputedStyle(node).outlineStyle, width: parseFloat(getComputedStyle(node).outlineWidth) }))
        assert(style.focused && style.outline === 'solid' && style.width >= 2)
      }
      // Real entry remains outside the league page's live-data loading gate.
      await page.goto(`${base}/leagues/eng.1`, { waitUntil: 'networkidle' })
      const entry = page.getByRole('link', { name: 'Compare clubs · Season snapshot' })
      await entry.waitFor()
      await page.screenshot({ path: `${out}/comparison-entry-${width}.png`, fullPage: true })
      await entry.click(); await region.waitFor()
      const nav = width < 768 ? page.getByRole('navigation', { name: 'Mobile navigation' }) : page.getByRole('complementary', { name: 'Primary' })
      const current = nav.locator('[aria-current="page"]')
      assert.equal(await current.count(), 1, 'One selected navigation destination')
      assert.equal(await current.getAttribute('href'), '/leagues')
      await first.selectOption('Arsenal'); await second.selectOption('Manchester City')
      for (const team of ['Arsenal', 'Manchester City']) {
        const row = clubs.find((c) => c.team === team)
        const card = page.getByRole('article', { name: team, exact: true })
        await card.getByText((row.points / row.played).toFixed(2), { exact: true }).waitFor()
        await card.getByText(`${row.played} games recorded`, { exact: true }).waitFor()
        await card.getByText(row.exp_points.toFixed(1), { exact: true }).waitFor()
      }
      await page.getByText('Not supplied by this artifact', { exact: true }).waitFor()
      assert.equal(await page.getByRole('link', { name: 'View source snapshot' }).getAttribute('href'), '/api/v1/season/projections?gender=M')
      assert.equal(await page.getByRole('link', { name: /How to read this comparison/ }).getAttribute('href'), '/docs/tutorials/follow-a-season#compare-two-clubs')
      assert.equal(await page.locator('#main').evaluate((node) => node.getAnimations({ subtree: true }).some((a) => a.playState === 'running')), false, 'Reduced motion')
      await audit('ready'); await capture('ready')
      await page.getByRole('article', { name: 'Arsenal', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${out}/comparison-reading-${width}-viewport.png` })
      await page.getByRole('link', { name: 'View source snapshot' }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${out}/comparison-source-${width}-viewport.png` })
      await first.scrollIntoViewIfNeeded()
      await focus(first)
      // Full viewport preserves the complete outside focus ring. A locator
      // crop cuts it off at the label's bounding box, hiding useful evidence.
      await page.screenshot({ path: `${out}/comparison-focus-${width}.png` })
      await page.keyboard.press('End'); await page.keyboard.press('Enter')
      assert.equal(await first.inputValue(), clubs.at(-1).team, 'Native selector keyboard operation')
      await focus(page.getByRole('button', { name: 'Swap', exact: true }))
      const before = [await first.inputValue(), await second.inputValue()]
      await page.keyboard.press('Enter')
      assert.deepEqual([await first.inputValue(), await second.inputValue()], [...before].reverse())
      for (let cycle = 0; cycle < 3; cycle++) {
        await first.selectOption('Arsenal'); await second.selectOption('Manchester City')
        await first.selectOption('Manchester City')
        assert.equal(await second.inputValue(), 'Arsenal')
        await page.getByRole('button', { name: 'Swap', exact: true }).click()
        assert.equal(await first.inputValue(), 'Arsenal')
      }
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.getByRole('link', { name: 'Back to league', exact: true }).click()
        await entry.waitFor(); await entry.click(); await region.waitFor()
        await page.goBack({ waitUntil: 'networkidle' }); await entry.waitFor()
        await page.goForward({ waitUntil: 'networkidle' }); await region.waitFor()
      }
      state = 'loading'; gate = new Promise((resolve) => { release = resolve })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('status').filter({ hasText: 'Loading club comparison' }).waitFor()
      assert.equal(await region.count(), 0)
      await audit('loading'); await capture('loading')
      state = 'ready'; release(); await region.waitFor()
      state = 'error'; await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('status').filter({ hasText: 'could not be loaded' }).waitFor()
      assert.equal(await region.count(), 0)
      await audit('error'); await capture('error')
      state = 'ready'; await focus(page.getByRole('button', { name: 'Try again' }))
      await page.keyboard.press('Enter'); await region.waitFor()
      state = 'empty'; await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('status').filter({ hasText: 'Two identifiable clubs' }).waitFor()
      assert.equal(await first.count(), 0)
      await audit('empty'); await capture('empty')
      state = 'sparse'; await page.getByRole('button', { name: 'Try again' }).click(); await region.waitFor()
      assert.equal(await region.getByText('Unavailable', { exact: true }).count(), 8)
      await audit('sparse'); await capture('sparse')
      state = 'ready'; const requestsBeforeWomen = snapshotRequests.length
      await page.goto(`${compare}?gender=F`, { waitUntil: 'networkidle' })
      await page.getByText(/A women’s season comparison is unavailable/).waitFor()
      assert.equal(snapshotRequests.length, requestsBeforeWomen, 'Women preference must not request the men artifact')
      assert.equal(await region.count(), 0)
      await audit('unsupported-gender'); await capture('unsupported-gender')
      await page.goto(`${base}/leagues/usa.1/compare?gender=M`, { waitUntil: 'networkidle' })
      await region.waitFor()
      const mls = artifact.leagues.find((l) => l.competition_id === 'usa.1')
      assert.equal(await first.locator('option').count(), mls.table.length)
      assert.equal(await first.locator('option').filter({ hasText: 'Arsenal' }).count(), 0)
      await page.getByText(`Men’s ${mls.season}`, { exact: true }).waitFor()
      await audit('calendar-season'); await capture('calendar-season')
      assert.deepEqual(errors, [], 'Unexpected console/page errors')
      report.push({ width, sourceApiMatchesArtifact: true, clubSamples: ['Arsenal', 'Manchester City'].map((team) => {
        const row = clubs.find((c) => c.team === team)
        return { team, points: row.points, games: row.played, pointsPerGame: row.points / row.played, projectedPoints: row.exp_points }
      }), keyboardSelectorAndSwap: true, repeatSelections: 3, repeatRoundTrips: 2,
        states: ['ready', 'loading', 'error-retry', 'empty-retry', 'missing-metrics', 'unsupported-gender', 'calendar-season'],
        reducedMotion: true, oneActiveNavItem: true, accessibilityViolations: 0, overflow: false,
        externalRequestsFulfilledLocally: blockedExternal.length, expectedInjectedTransportErrors: expectedFaultMessages.length,
        snapshotRequests, unexpectedErrors: errors })
    } catch (error) {
      await writeFile(`${out}/comparison-failure-${width}.html`, await page.content())
      await page.screenshot({ path: `${out}/comparison-failure-${width}.png`, fullPage: true })
      throw error
    } finally { release?.(); await context.close() }
  }
  const targetedReview = await checkComparisonReview({ browser, base, out, artifact })
  return { basis: 'Actual local serving API and committed season artifact; only faults injected. Other APIs and external hosts intercepted. No live provider ingestion, model execution or public deployment QA.', targetedReview,
    artifactGeneratedAt: artifact.generated_at, resultCutoff: 'Not supplied per league', report }
}
