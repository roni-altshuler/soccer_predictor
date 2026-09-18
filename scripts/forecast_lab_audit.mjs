// Full flow: actual page -> API -> committed artifact, without data interception.
// Fault injection is confined to the explicit refresh-failure check at the end.
import { chromium } from 'playwright'
import { readFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

const base = process.env.QA_BASE || 'http://127.0.0.1:3001'
const out = process.env.QA_OUT || '/tmp/pitchverse-forecast-lab'
await mkdir(out, { recursive: true })
const artifact = JSON.parse(await readFile('backend/data/predictions/season_fixtures.json', 'utf8'))
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    page.setDefaultNavigationTimeout(60000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const response = await context.request.get(`${base}/api/v1/forecast-lab`)
    assert.equal(response.status(), 200)
    const data = await response.json()
    assert(data.fixtures.length > 1, 'Real upcoming forecasts are required for this audit')
    const f = data.fixtures[1]
    assert.deepEqual(f, artifact.fixtures.find((row) => row.fixture_uid === f.fixture_uid))
    await page.goto(`${base}/lab?fixture=${f.fixture_uid}`, { waitUntil: 'domcontentloaded' })
    const selected = page.getByRole('region', { name: 'Selected forecast' })
    await selected.getByRole('heading', { name: f.home, exact: true }).waitFor()
    assert(await selected.getByText(`${(f.p_home * 100).toFixed(1)}%`, { exact: true }).isVisible())
    await selected.getByRole('button', { name: /Home win/ }).click()
    await page.getByRole('heading', { name: 'If the home side wins…' }).waitFor()
    await selected.getByRole('button', { name: `Follow ${f.home}`, exact: true }).click()
    const picker = page.getByRole('button', { name: /Choose a match/ })
    if (await picker.isVisible()) await picker.click()
    await page.getByRole('button', { name: 'Show followed clubs' }).click()
    const matches = page.getByRole('group', { name: 'Recorded matches' })
    assert((await matches.getByRole('button').count()) > 0)
    await page.getByRole('button', { name: 'Show followed clubs' }).click()
    await page.getByRole('searchbox', { name: 'Search clubs' }).fill('zzzz-no-club')
    await page.getByText('No matches in this view.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Show all matches' }).click()
    await matches.getByRole('button').nth(1).click()
    await selected.getByRole('button', { name: 'Share match' }).click()
    await page.getByRole('status').filter({ hasText: 'Match link copied' }).waitFor()
    assert((await page.evaluate(() => navigator.clipboard.readText())).includes('fixture='))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await selected.getByRole('button', { name: `Unfollow ${f.home}`, exact: true }).waitFor()
    await page.getByRole('button', { name: 'Refresh forecasts' }).click()
    await page.getByRole('status').filter({ hasText: 'latest published' }).waitFor()
    await selected.getByRole('button', { name: /Away win/ }).click()
    await page.getByRole('heading', { name: 'If the away side wins…' }).waitFor()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${out}/${width}.png`, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })))
    assert.equal(overflow, false, `Overflow at ${width}`)
    assert.deepEqual(violations, [], `Accessibility at ${width}`)
    assert.deepEqual(errors, [], `Browser errors at ${width}`)
    if (width === 390) {
      await page.route('**/api/v1/forecast-lab*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
      await page.getByRole('button', { name: 'Refresh forecasts' }).click()
      await page.getByRole('status').filter({ hasText: 'Couldn’t refresh' }).waitFor()
      assert(await selected.getByRole('heading', { name: f.home, exact: true }).isVisible())
    }
    results.push({ width, forecasts: data.fixtures.length, overflow, violations, errors })
    await context.close()
  }
} finally {
  await browser.close()
}
console.log(JSON.stringify({ source: 'Actual local API and committed forecast artifact', screenshots: out, results }, null, 2))
