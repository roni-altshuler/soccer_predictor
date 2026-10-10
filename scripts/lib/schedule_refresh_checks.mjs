import assert from 'node:assert/strict'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const artifactPath = 'backend/data/predictions/season_refresh_status.json'
const stamp = '2026-10-09T14:33:00+00:00'
const scope = ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'usa.1']
const checked = { schema_version: 1, state: 'checked', attempted_at: stamp, requests: 6, request_limit: 6,
  leagues: scope.map((id) => ({ competition_id: id, season: id === 'usa.1' ? '2026' : '2026-2027', last_verified_at: stamp })) }

/** Synthetic availability/check outcomes only. Real production writer, status
 * API and browser; committed forecast dates, clubs and numbers stay untouched.
 */
export async function checkScheduleRefresh({ browser, base, out, before = false }) {
  let original
  try { original = await readFile(artifactPath) } catch (e) { if (e.code !== 'ENOENT') throw e }
  const forecasts = ['backend/data/predictions/season_projections.json', 'backend/data/predictions/season_fixtures.json']
  const hashes = await Promise.all(forecasts.map(async (file) => ({ file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') })))
  const rows = []
  try {
    for (const width of [390, 768, 1440]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', colorScheme: theme })
      await context.addInitScript((preference) => {
        if (!sessionStorage.getItem('schedule-qa-seeded')) {
          localStorage.setItem('pitchverse-theme', preference)
          localStorage.setItem('theme', preference)
          sessionStorage.setItem('schedule-qa-seeded', '1')
        }
        localStorage.setItem('pitchverse-ambient', 'off')
        // Same offline isolation as the existing product replays.
        delete Object.getPrototypeOf(navigator).serviceWorker
      }, theme)
      await context.route('**/*', async (route) => {
        const u = new URL(route.request().url())
        if (route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
        if (u.origin !== new URL(base).origin) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        if (u.pathname.startsWith('/api/') && !['/api/v1/season/refresh-status', '/api/v1/season/projections', '/api/v1/tracking/accuracy'].includes(u.pathname)) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{"available":false,"matches":[]}' })
        }
        return route.continue()
      })
      const page = await context.newPage(), errors = [], expectedFaults = []
      let currentCase = ''
      let faultInjected = false
      page.on('pageerror', (e) => errors.push(`${currentCase}: ${e.message}`))
      page.on('console', (m) => {
        if (m.type() !== 'error') return
        if (faultInjected && /Failed to load resource.*503/.test(m.text())) expectedFaults.push(m.text())
        else errors.push(`${currentCase}: ${m.text()}`)
      })
      const states = before ? ['before'] : ['unknown', 'degraded', 'checked', 'unreadable']
      for (const state of states) {
        faultInjected = state === 'unreadable'
        if (state === 'unreadable') await page.route('**/api/v1/season/refresh-status*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"state":"unknown"}' }))
        else if (state === 'unknown') {
          await rm(artifactPath, { force: true })
          assert.equal((await (await fetch(`${base}/api/v1/season/refresh-status`)).json()).state, 'unknown')
        }
        else if (state !== 'before') {
          const payload = state === 'checked' ? checked : { ...checked, state, requests: 1,
            leagues: checked.leagues.map((r) => ({ ...r, last_verified_at: '2026-09-01T10:00:00+00:00' })) }
          const input = `${out}/schedule-synthetic-${state}.json`
          await writeFile(input, JSON.stringify(payload))
          const result = spawnSync('python3', ['-m', 'backend.scripts.record_schedule_refresh', '--report', input,
            '--outcome', state === 'checked' ? 'success' : 'failure'], { encoding: 'utf8' })
          assert.equal(result.status, state === 'checked' ? 0 : 1, result.stderr)
          const served = await (await fetch(`${base}/api/v1/season/refresh-status`)).json()
          assert.equal(served.state, state)
          assert.equal(served.attempted_at, stamp)
          assert.equal(served.requests, payload.requests)
        }
        for (const route of ['/leagues', '/leagues/eng.1/compare']) {
          currentCase = `${width}px ${theme} ${state} ${route}`
          console.log(`Checking schedule ${currentCase}`)
          await page.goto(`${base}${route}`, { waitUntil: 'networkidle' })
          await page.waitForFunction((preference) => document.querySelector('select[aria-label="Color theme"]')?.value === preference, theme)
          await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, theme === 'dark')
          const notice = page.getByRole('status', { name: 'Schedule freshness' })
          if (before) assert.equal(await notice.count(), 0)
          else {
            await notice.waitFor()
            await notice.getByText(state === 'checked' ? 'Schedule last checked' : state === 'degraded' ? 'Schedule refresh unavailable' : 'Schedule refresh status unavailable', { exact: true }).waitFor()
            assert.equal(await notice.locator('time').count(), ['unknown', 'unreadable'].includes(state) ? 0 : state === 'degraded' && route.includes('compare') ? 2 : 1)
            if (!['unknown', 'unreadable'].includes(state)) assert.equal(await notice.locator('time').first().getAttribute('datetime'), stamp)
            if (state === 'degraded') await notice.getByText(/kickoff times and postponements may be outdated/).waitFor()
            await page.evaluate(async (source) => { (0, eval)(source) }, await readFile('node_modules/axe-core/axe.min.js', 'utf8'))
            const violations = await notice.evaluate(async (node) => (await window.axe.run(node,
              { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map((v) => v.id))
            assert.deepEqual(violations, [])
          }
          if (route.includes('compare')) {
            await page.getByRole('region', { name: 'Club comparison' }).waitFor()
            await page.getByRole('article', { name: 'Arsenal', exact: true }).waitFor()
            await page.getByText('Not supplied by this artifact', { exact: true }).waitFor()
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
          await page.screenshot({ path: `${out}/schedule-${state}-${route.includes('compare') ? 'comparison' : 'directory'}-${theme}-${width}.png` })
          rows.push({ width, theme, route, state, overflow: false, noticeAccessibilityViolations: 0 })
        }
        if (state === 'unreadable') await page.unroute('**/api/v1/season/refresh-status*')
      }
      assert.deepEqual(errors, [])
      if (!before) assert.equal(expectedFaults.length, 2, 'Two deliberately unreadable status responses')
      await context.close()
    }
  } finally {
    if (original) await writeFile(artifactPath, original)
    else await rm(artifactPath, { force: true })
  }
  for (const hash of hashes) assert.equal(createHash('sha256').update(await readFile(hash.file)).digest('hex'), hash.sha256)
  const report = { basis: 'Synthetic schedule-check outcomes. Actual production writer/API/browser; unchanged committed forecasts. No provider access or training.', forecastHashes: hashes, states: rows }
  await writeFile(`${out}/schedule-refresh-report.json`, JSON.stringify(report, null, 2))
  return report
}
