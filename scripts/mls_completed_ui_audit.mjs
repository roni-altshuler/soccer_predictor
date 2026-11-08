/** Local replay only: all browser provider traffic is blocked. Run after a production build. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const port = process.env.QA_PORT || '3111'
const base = process.env.QA_BASE || `http://127.0.0.1:${port}`
const out = process.env.QA_OUT || '/tmp/pitchverse-mls-completed'
const artifact = JSON.parse(await readFile(process.env.QA_ARTIFACT || 'backend/data/predictions/season_projections.json', 'utf8'))
const completed = artifact.leagues?.find((league) => league.competition_id === 'usa.1' && league.state === 'regular_season_completed')
assert(completed, 'Supply the reviewed completed artifact via QA_ARTIFACT, or publish it locally first')
const schedule = { schema_version: 1, state: 'degraded', attempted_at: artifact.generated_at, requests: 0, request_limit: 6, leagues: [{ competition_id: 'usa.1', season: '2026', last_verified_at: completed.observation.schedule_last_verified_at }] }
let server, browser
const report = { pages: [], archiveRoutes: [], simulatorRequests: [], providerRequestsBlocked: [], errors: [] }
try {
  await mkdir(out, { recursive: true })
  if (!process.env.QA_BASE) {
    assert.equal(await fetch(base).then(() => true, () => false), false, 'QA port occupied')
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { stdio: ['ignore', 'ignore', 'inherit'] })
    const deadline = Date.now() + 60000
    while (!await fetch(base + '/leagues').then((reply) => reply.ok, () => false)) {
      assert(Date.now() < deadline && server.exitCode === null, 'Production server did not start')
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  for (const width of [350, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await context.addInitScript(() => localStorage.setItem('fotpredict.gender', 'men'))
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== new URL(base).origin) {
        report.providerRequestsBlocked.push(url.origin)
        return route.abort()
      }
      if (url.pathname === '/_next/image') return route.abort()
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (url.pathname === '/api/v1/season/projections') return json(artifact)
      if (url.pathname === '/api/v1/season/refresh-status') return json(schedule)
      if (url.pathname.startsWith('/api/simulation/')) { report.simulatorRequests.push(url.pathname); return json({ standings: [] }) }
      if (url.pathname.startsWith('/api/')) return json({ available: false })
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => report.errors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error' && /hydrat|React error|Minified React/i.test(message.text())) report.errors.push(message.text()) })
    for (const path of ['/leagues', '/leagues/usa.1?gender=M', '/leagues/usa.1/compare?gender=M']) {
      await page.goto(base + path)
      if (path === '/leagues') {
        const card = page.locator('a[href="/leagues/usa.1"]')
        await card.getByText('Regular season completed', { exact: true }).waitFor()
        assert(!/No projection|Shield race|\d+%/.test(await card.innerText()), 'Completed directory card exposed forecast figures')
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px directory overflow`)
        const shot = `${out}/directory-${width}.png`
        await page.screenshot({ path: shot, fullPage: true })
        report.pages.push({ path, width, screenshot: shot })
        continue
      }
      await page.getByRole('heading', { name: 'Regular season completed', exact: true }).waitFor()
      const text = await page.locator('main').innerText()
      assert(!/Projected final points|Simulating the rest|Model forecast|\d+%|Most likely champion/.test(text), 'Observed page exposed forecast figures')
      await page.getByRole('link', { name: 'Archived forecast evaluation', exact: true }).waitFor()
      await page.getByRole('link', { name: 'Recorded prediction history', exact: true }).waitFor()
      for (const target of [
        { name: 'Archived forecast evaluation', path: '/evaluation', heading: 'Evaluation' },
        { name: 'Recorded prediction history', path: '/accuracy', heading: 'Accuracy' },
      ]) {
        const href = await page.getByRole('link', { name: target.name, exact: true }).getAttribute('href')
        assert.equal(new URL(href, base).pathname, target.path, 'Archive link uses an existing canonical route')
        const archive = await context.newPage()
        archive.on('pageerror', (error) => report.errors.push(error.message))
        try {
          const response = await archive.goto(new URL(href, base).href, { waitUntil: 'domcontentloaded' })
          assert.equal(response?.status(), 200, 'Archive destination must return HTTP 200')
          assert.equal(new URL(archive.url()).pathname, target.path)
          await archive.getByRole('heading', { name: target.heading, exact: true }).waitFor()
          report.archiveRoutes.push({ from: path, width, destination: target.path, status: response.status() })
        } finally { await archive.close() }
      }
      if (!path.includes('/compare')) {
        for (const name of ['overview', 'standings', 'Top Scorers', 'fixtures']) await page.getByRole('tab', { name, exact: true }).waitFor()
        await page.getByRole('tab', { name: 'standings', exact: true }).click()
        assert.equal(await page.getByRole('table').count(), 2)
        await page.getByRole('tab', { name: 'Top Scorers', exact: true }).click()
        await page.getByRole('tab', { name: 'fixtures', exact: true }).click()
        await page.getByRole('button', { name: /Today/i }).waitFor()
        await page.getByRole('tab', { name: 'overview', exact: true }).click()
        assert.equal(await page.getByRole('table').count(), 2)
        assert.equal(await page.getByRole('row').count(), 32)
        for (const table of await page.getByRole('table').all()) {
          const points = await table.getByRole('columnheader', { name: 'Pts', exact: true }).boundingBox()
          const bounds = await table.locator('..').boundingBox()
          assert(points && bounds && points.x >= bounds.x && points.x + points.width <= bounds.x + bounds.width + 1, 'Points must be visible inside the table viewport')
        }
        await page.getByRole('status', { name: 'Schedule freshness' }).waitFor()
        const region = page.getByRole('region', { name: 'Eastern Conference standings' })
        await region.focus()
        assert(await region.evaluate((node) => node === document.activeElement), 'Conference scroll region must accept keyboard focus')
      } else {
        const clubs = page.getByRole('region', { name: 'Choose clubs', exact: true })
        assert.equal(await clubs.getByRole('combobox').count(), 2)
        await clubs.getByRole('button', { name: 'Swap', exact: true }).click()
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px document overflow at ${path}`)
      await page.evaluate(() => { document.activeElement?.blur?.(); scrollTo({ top: 0, left: 0, behavior: 'instant' }) })
      const shot = `${out}/${path.includes('/compare') ? 'comparison' : 'league'}-${width}.png`
      await page.screenshot({ path: shot, fullPage: true })
      report.pages.push({ path, width, screenshot: shot })
    }
    await context.close()
  }
  assert.deepEqual(report.simulatorRequests, [], 'Completed season requested the simulator')
  assert.deepEqual(report.errors, [], 'Browser/hydration errors')
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(`MLS completed replay passed: ${report.pages.length} views; no simulator calls or hydration errors. Evidence: ${out}`)
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
