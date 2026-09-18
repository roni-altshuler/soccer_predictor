// Local UI verification using committed forecast records, never a production fallback.
// Start Next locally, then: node scripts/matchday_audit.mjs
import { chromium } from 'playwright'
import { readFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

const base = process.env.QA_BASE || 'http://127.0.0.1:3000'
const out = process.env.QA_OUT || '/tmp/pitchverse-matchday'
await mkdir(out, { recursive: true })
const read = async (file) => JSON.parse(await readFile(file, 'utf8'))
const records = (await read('backend/data/predictions/predictions_2026-09.json')).predictions
const evaluation = await read('backend/data/evaluation/live.json')
const crests = (await read('src/data/teamCrests.json')).crests
const leagues = { 'Premier League': 'eng.1', 'La Liga': 'esp.1', 'Bundesliga': 'ger.1', 'Serie A': 'ita.1', 'Ligue 1': 'fra.1', 'MLS': 'usa.1', 'Major League Soccer': 'usa.1' }
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const chosenDate = '2026-09-19'
const recorded = records.filter((p) => p.match_date === chosenDate && leagues[p.league]).map((p) => {
  const leagueId = leagues[p.league]
  return { id: String(p.match_id), leagueId, league: p.league, home_team: p.home_team, away_team: p.away_team, status: 'upcoming', venue: p.venue, ai_home_prob: p.predicted_home_win, ai_draw_prob: p.predicted_draw, ai_away_prob: p.predicted_away_win, predicted_scoreline: p.predicted_scoreline, home_crest_url: crests[leagueId]?.[norm(p.home_team)], away_crest_url: crests[leagueId]?.[norm(p.away_team)] }
})
assert(recorded.length > 1, 'Recorded fixture set must be available')
const browser = await chromium.launch()
const report = []
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.clock.install({ time: new Date(`${chosenDate}T12:00:00Z`) })
    await page.route('**/api/todays_matches?**', async (route) => {
      const date = new URL(route.request().url()).searchParams.get('date')
      await route.fulfill({ json: { source: 'espn', live: [], upcoming: date === chosenDate ? recorded : [], completed: [] } })
    })
    await page.route('**/api/v1/evaluation', (route) => route.fulfill({ json: evaluation }))
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.getByRole('region', { name: 'Match spotlight' }).waitFor()
    const scope = page.getByRole('region', { name: 'Match spotlight' })
    const choices = scope.getByRole('button')
    await choices.nth(1).click()
    assert.equal(await choices.nth(1).getAttribute('aria-pressed'), 'true')
    if (width < 1024) await page.getByRole('button', { name: /Make it your matchday/ }).click()
    const follow = page.getByRole('button', { name: /^Follow / }).first()
    await follow.click()
    await page.getByRole('button', { name: /Following · 1/ }).click()
    assert.equal(await page.getByRole('button', { name: /Following · 1/ }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: /Following · 1/ }).click()
    if (width < 1024) await page.getByRole('button', { name: /Make it your matchday/ }).click()
    const competition = page.locator('[aria-label="Filter by competition"]').getByRole('button', { name: /^Premier League \d+$/ })
    await competition.click()
    assert.equal(await competition.getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: /All competitions/ }).click()
    await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
    await page.getByText('No matches in this view').waitFor()
    assert.equal(await page.getByRole('region', { name: 'Match spotlight' }).count(), 0)
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    await scope.waitFor()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${out}/${width}.png`, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
    const accessibility = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map((n) => n.target) })))
    report.push({ width, overflow, errors, accessibility })
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`)
    assert.deepEqual(errors, [], `Browser errors at ${width}px`)
    await context.close()
  }
} finally { await browser.close() }
console.log(JSON.stringify({ replay: 'Committed 2026-09-19 predictions; kickoff times unavailable in monthly records, displayed as TBC.', screenshots: out, report }, null, 2))
assert(report.every((r) => r.accessibility.length === 0), 'Accessibility violations found')
