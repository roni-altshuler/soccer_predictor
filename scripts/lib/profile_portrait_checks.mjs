import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

/** Existing sparse detail path, with explicitly synthetic portrait subjects.
 * These fixtures prove a rendering guard, never provider identity or rights.
 */
export async function checkProfilePortraits({ browser, base, out, chosen, detail, today }) {
  const contract = JSON.parse(await readFile('backend/tests/fixtures/portraits/contract.json', 'utf8'))
  const report = []
  for (const width of [390, 1440]) {
    for (const variant of ['legacy-id', 'colliding-provider']) {
      console.log(`Checking portrait fallback ${width}px ${variant}`)
      const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
      const page = await context.newPage()
      try {
        const errors = []
        const portraitRequests = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
        await context.addInitScript(() => {
          localStorage.setItem('pitchverse-ambient', 'off')
          delete Object.getPrototypeOf(navigator).serviceWorker
        })
        await page.clock.install({ time: new Date(`${today}T12:00:00Z`) })
        await page.clock.resume()
        await context.route('**/*', async (route) => {
          const url = new URL(route.request().url())
          if ((url.pathname.includes('/headshots/') && !url.pathname.endsWith('/manifest.json')) || url.hostname === 'images.fotmob.com') {
            portraitRequests.push(url.href)
          }
          if (url.origin !== new URL(base).origin) return route.fulfill({ status: 200, body: '' })
          if (url.pathname === '/headshots/manifest.json') {
            const manifest = variant === 'legacy-id'
              ? { '123': '/headshots/123.webp' }
              : { 'fotmob:123': contract.cases[1].entry }
            return route.fulfill({ json: manifest })
          }
          if (url.pathname.startsWith('/api/match/')) {
            return route.fulfill({ json: { ...detail(chosen), card: null, prediction: null, status: 'live',
              // Existing legacy stats shape; all-zero event counts omit its
              // stats panel. These are test inputs, never provider facts.
              stats: { possession: [0, 0], shots: [0, 0], shotsOnTarget: [0, 0], corners: [0, 0], fouls: [0, 0] },
              source: 'synthetic-portrait-contract',
              lineups: { home: [{ id: '123', name: 'Synthetic portrait subject', position: 'F', rating: 7 }], away: [] },
            } })
          }
          if (url.pathname.includes('/api/')) return route.fulfill({ json: {} })
          return route.continue()
        })
        await page.goto(`${base}/matches/${chosen.match_id}`, { waitUntil: 'networkidle' })
        const avatar = page.getByRole('img', { name: 'Synthetic portrait subject', exact: true })
        await avatar.waitFor()
        assert.equal(await avatar.textContent(), 'SS')
        assert.equal(await avatar.locator('img').count(), 0)
        assert.deepEqual(portraitRequests, [], 'An ambiguous player ID must not fetch a portrait')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
        await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
        const violations = await avatar.evaluate(async (node) => (await window.axe.run(node, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
        })).violations.map(({ id }) => id))
        assert.deepEqual(violations, [])
        assert.deepEqual(errors, [])
        await avatar.locator('..').screenshot({ path: `${out}/portrait-fallback-${variant}-${width}.png` })
        report.push({ width, variant, accessibleName: true, initials: 'SS', imageCount: 0,
          portraitRequests: 0, accessibilityViolations: 0, overflow: false, errors })
      } catch (error) {
        await writeFile(`${out}/portrait-failure-${variant}-${width}.html`, await page.content())
        await page.screenshot({ path: `${out}/portrait-failure-${variant}-${width}.png`, fullPage: true })
        throw error
      } finally {
        await context.close()
      }
    }
  }
  return { basis: 'Synthetic subject, rating, status and manifest records on the existing sparse match-detail path. No provider fetch or real permission evidence; positive delivery is covered by unit/cache contracts.', report }
}
