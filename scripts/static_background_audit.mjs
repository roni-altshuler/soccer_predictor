// Production-browser proof that decorative motion is removed, not hidden.
// Uses the same committed sparse excerpt/server replay as theme journeys.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const before = process.env.QA_BEFORE === '1'
const out = process.env.QA_OUT || '/tmp/pitchverse-static-backgrounds'
const port = process.env.QA_PORT || '3138', base = `http://127.0.0.1:${port}`
const excerpt = JSON.parse(await readFile('backend/tests/fixtures/espn/761660_scheduled_excerpt.json', 'utf8'))
const evaluation = JSON.parse(await readFile('backend/data/evaluation/live.json', 'utf8'))
const event = excerpt.header, competition = event.competitions[0]
const home = competition.competitors.find((side) => side.homeAway === 'home').team
const away = competition.competitors.find((side) => side.homeAway === 'away').team
const fixture = { id: event.id, league: 'MLS', leagueId: 'usa.1', home_team: home.displayName, away_team: away.displayName,
  home_team_id: home.id, away_team_id: away.id, status: 'upcoming' }
const match = { ...fixture, date: competition.date, prediction: null, card: {
  eventId: event.id, date: competition.date, state: 'pre', statusDetail: 'Kickoff TBC', leg: null, neutralSite: false,
  home: { ...home, name: home.displayName, score: null, winner: false, logo: null, homeAway: 'home' },
  away: { ...away, name: away.displayName, score: null, winner: false, logo: null, homeAway: 'away' },
  venue: null, attendance: null, officials: [], events: [], commentary: [], stats: [], lineups: [], form: [], headToHead: null,
} }
const pages = [
  ['home', '/'], ['leagues', '/leagues'], ['league', '/leagues/eng.1'],
  ['match', `/matches/${event.id}?league=usa.1`], ['team', `/teams/${home.id}?provider=espn`],
  ['tournaments', '/tournaments'], ['evaluation', '/evaluation'], ['docs', '/docs'],
]
const rows = [], errors = [], interactions = []
let browserVersion
let browser, server
await mkdir(out, { recursive: true })

function observeFrames() {
  const metrics = window.__backgroundMotion = { frames: 0, canvasDraws: 0 }
  const frame = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) => frame((time) => { metrics.frames++; callback(time) })
  const clear = CanvasRenderingContext2D.prototype.clearRect
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (this.canvas.classList.contains('pitch-backdrop__match')) metrics.canvasDraws++
    return clear.apply(this, args)
  }
}

async function inspect(page) {
  const start = await page.evaluate(() => ({ ...window.__backgroundMotion }))
  // Normal motion stays enabled. A continuing rAF loop cannot pass this idle window.
  await page.waitForTimeout(1000)
  return page.evaluate((start) => {
    const background = document.querySelector('.pitch-backdrop')
    const animations = document.getAnimations().filter((animation) => animation.playState === 'running').map((animation) => {
      const target = animation.effect?.target
      return { name: animation.animationName || null, iterations: animation.effect?.getTiming().iterations,
        target: target instanceof Element ? target.tagName.toLowerCase() : null,
        classes: target instanceof Element ? target.getAttribute('class') : null,
        decorative: target instanceof Element && Boolean(target.closest('.pitch-backdrop')) }
    })
    const unapprovedInfiniteAnimations = animations.filter((animation) => animation.iterations === Infinity &&
      !( ['pulse', 'ping', 'spin', 'shimmer', 'skeleton-shimmer'].includes(animation.name) &&
        /animate-(pulse|ping|spin)|(?:skeleton-)?shimmer/.test(animation.classes || '') ))
    return { theme: document.documentElement.dataset.theme,
      body: getComputedStyle(document.body).backgroundColor,
      canvasToken: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
      backgroundNodes: document.querySelectorAll('.pitch-backdrop, canvas.pitch-backdrop__match').length,
      backgroundDisplay: background ? getComputedStyle(background).display : null,
      decorativeAnimations: animations.filter((animation) => animation.decorative),
      unapprovedInfiniteAnimations,
      otherRunningAnimations: animations.filter((animation) => !animation.decorative),
      frameCallbacks: window.__backgroundMotion.frames - start.frames,
      canvasDraws: window.__backgroundMotion.canvasDraws - start.canvasDraws,
      overflow: document.documentElement.scrollWidth > innerWidth,
      ambientAttribute: document.documentElement.getAttribute('data-ambient'),
      legacySetting: localStorage.getItem('pitchverse-ambient'),
    }
  }, start)
}

try {
  assert(/^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536)
  assert.equal(await fetch(base).then(() => true, () => false), false, 'QA port occupied')
  server = spawn(process.execPath, ['--require', resolve('scripts/lib/theme_server_replay.cjs'),
    'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], { stdio: ['ignore', 'ignore', 'inherit'] })
  const deadline = Date.now() + 30000
  while (!await fetch(base).then((r) => r.ok, () => false)) {
    assert.equal(server.exitCode, null, 'QA server exited')
    assert(Date.now() < deadline, 'QA server startup timeout')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM || undefined })
  browserVersion = browser.version()
  for (const width of [390, 768, 1440]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: theme,
      reducedMotion: 'no-preference', serviceWorkers: 'block' })
    try {
      await context.addInitScript(({ theme }) => {
        localStorage.setItem('pitchverse-theme', theme)
        // Existing vivid preferences must not re-enable a removed background.
        localStorage.setItem('pitchverse-ambient', 'vivid')
        delete Object.getPrototypeOf(navigator).serviceWorker
      }, { theme })
      await context.addInitScript(observeFrames)
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(base).origin) return route.fulfill({ json: { children: [], events: [], leaders: [] } })
        if (url.pathname === '/api/todays_matches') return route.fulfill({ json: { source: 'committed-sparse-excerpt', live: [], upcoming: [fixture], completed: [] } })
        if (url.pathname.startsWith('/api/match/')) return route.fulfill({ json: match })
        if (url.pathname === '/api/v1/evaluation') return route.fulfill({ json: evaluation })
        if (['/api/v1/season/projections', '/api/v1/tournaments/predictions', '/api/v1/match-evidence'].includes(url.pathname)) return route.continue()
        if (url.pathname.includes('/api/')) return route.fulfill({ json: { available: false, standings: [], events: [], scorers: [], children: [] } })
        return route.continue()
      })
      const page = await context.newPage(), pageErrors = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      for (const [name, path] of pages) {
        await page.goto(base + path, { waitUntil: 'networkidle' })
        await page.locator('#main h1').first().waitFor()
        await page.waitForTimeout(1500)
        const result = await inspect(page)
        rows.push({ name, path, width, theme, ...result })
        assert.equal(result.theme, theme)
        assert.equal(result.canvasToken, theme === 'light' ? '#f5f3ee' : '#071009')
        assert.equal(result.overflow, false, `${name} ${width} ${theme}: overflow`)
        if (before && theme === 'dark') {
          assert(result.canvasDraws > 0, `${name}: original canvas must actually run`)
          assert.equal(result.decorativeAnimations.length, 2)
        } else if (!before) {
          assert.equal(result.backgroundNodes, 0, `${name}: decorative canvas/layer still mounted`)
          assert.equal(result.decorativeAnimations.length, 0)
          assert.deepEqual(result.unapprovedInfiniteAnimations, [], `${name}: unknown infinite CSS animation`)
          assert.equal(result.canvasDraws, 0)
          assert.equal(result.frameCallbacks, 0, `${name}: persistent animation-frame work in idle view`)
          assert.equal(result.ambientAttribute, null)
          assert.equal(await page.getByRole('group', { name: 'Pitch backdrop' }).count(), 0)
        }
        await page.screenshot({ path: `${out}/${theme}-${width}-${name}.png` })
        if (!before && name === 'match') {
          const tab = page.getByRole('tab', { name: 'Prediction', exact: true })
          await tab.click()
          assert.equal(await tab.getAttribute('aria-selected'), 'true')
          interactions.push({ width, theme, action: 'match-prediction-tab', passed: true })
        }
        if (!before && name === 'team') {
          await page.getByRole('button', { name: `Follow ${home.displayName}`, exact: true }).click()
          const unfollow = page.getByRole('button', { name: `Unfollow ${home.displayName}`, exact: true })
          assert.equal(await unfollow.getAttribute('aria-pressed'), 'true')
          await unfollow.click()
          assert.equal(await page.getByRole('button', { name: `Follow ${home.displayName}`, exact: true }).getAttribute('aria-pressed'), 'false')
          interactions.push({ width, theme, action: 'team-follow-unfollow', passed: true })
        }
        if (!before && name === 'tournaments') {
          await page.locator('#main button.group').first().click()
          assert(new URL(page.url()).searchParams.get('competition'))
          await page.getByRole('button', { name: 'All tournaments', exact: true }).click()
          assert.equal(new URL(page.url()).searchParams.get('competition'), null)
          interactions.push({ width, theme, action: 'tournament-open-close', passed: true })
        }
      }
      // Real theme control remains operable with normal motion and an old vivid setting.
      const select = page.getByRole('combobox', { name: 'Color theme' })
      const other = theme === 'light' ? 'dark' : 'light'
      await select.selectOption(other)
      await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, other)
      await select.selectOption(theme)
      interactions.push({ width, theme, action: 'theme-switch', passed: true })
      assert.deepEqual(pageErrors, [], `${width} ${theme}: browser exceptions`)
    } catch (error) {
      errors.push({ width, theme, error: error.message })
      const failedPage = context.pages()[0]
      await failedPage?.screenshot({ path: `${out}/failure-${theme}-${width}.png` }).catch(() => {})
      throw error
    }
    finally { await context.close() }
  }
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
  await writeFile(`${out}/report.json`, JSON.stringify({ before, basis: 'Normal-motion production browser; committed sparse fixtures only; browser/server provider access blocked.',
    runtime: { node: process.version, browser: browserVersion }, rows, interactions, errors }, null, 2))
}
console.log(`Static background audit passed: ${rows.length} route/viewport/theme views (${before ? 'before' : 'after'})`)
