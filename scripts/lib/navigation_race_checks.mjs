import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

async function pixelFocus(page, locator, name, out) {
  await locator.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }))
  await page.keyboard.press('Tab')
  await locator.focus()
  if (name.startsWith('hovered-')) await locator.hover()
  const computed = await locator.evaluate((node) => ({
    outline: getComputedStyle(node).outlineColor,
    fill: getComputedStyle(node).backgroundColor,
    focused: node === document.activeElement && node.matches(':focus-visible'),
  }))
  assert(computed.focused)
  const screenshot = await locator.screenshot({ path: `${out}/focus-${name}.png` })
  const pixels = await page.evaluate(async (encoded) => {
    const image = new Image()
    image.src = `data:image/png;base64,${encoded}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const sample = (y) => [...context.getImageData(Math.floor(image.width / 2), y, 1, 1).data].slice(0, 3)
    return { edge: [1, 2, 3, 4, 5].map(sample), adjacentFill: sample(7) }
  }, screenshot.toString('base64'))
  const expectedRing = computed.outline.match(/\d+/g).slice(0, 3).map(Number)
  const distance = (pixel) => pixel.reduce((sum, value, index) => sum + (value - expectedRing[index]) ** 2, 0)
  const ring = [...pixels.edge].sort((a, b) => distance(a) - distance(b))[0]
  const luminance = (pixel) => {
    const channels = pixel.map((value) => value / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const [light, dark] = [luminance(ring), luminance(pixels.adjacentFill)].sort((a, b) => b - a)
  return { name, computed, pixels, sampledRing: ring, contrast: (light + 0.05) / (dark + 0.05) }
}

// Uses the main replay's committed records and detail factory. Every response is
// controlled locally; a delayed result is released only after the newer view.
export async function checkNavigationRaces({ browser, base, out, date, today, fixtures, records, detail, evaluation, probe = false }) {
  const reports = []
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const errors = []
    const failures = []
    let delayId
    let releaseOld
    let oldStarted
    let oldGate
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
      if (url.origin !== new URL(base).origin) return route.fulfill({ status: 200, json: {} })
      if (url.pathname === '/api/todays_matches') return route.fulfill({ json: {
        source: 'contract-replay', live: [], upcoming: url.searchParams.get('date') === date ? fixtures : [], completed: [],
      } })
      if (url.pathname === '/api/v1/evaluation') return route.fulfill({ json: evaluation })
      if (url.pathname.startsWith('/api/match/')) {
        const id = url.pathname.split('/').at(-1)
        const record = records.find((record) => String(record.match_id) === id)
        assert(record, 'Only committed fixtures may be replayed')
        if (id === delayId) { oldStarted(); await oldGate }
        return route.fulfill({ json: detail(record) })
      }
      if (url.pathname.includes('/api/')) return route.fulfill({ json: {} })
      return route.continue()
    })
    const filteredUrl = `/?${new URLSearchParams({ date, competition: 'Premier League', filter: 'upcoming' })}`
    const homeLink = (kind) => kind === 'brand'
      ? page.locator('a[aria-label="Pitchverse home"]:visible').first()
      : (width < 768 ? page.getByRole('navigation', { name: 'Mobile navigation' }) : page.getByRole('complementary', { name: 'Primary' })).getByRole('link', { name: 'Matchday', exact: true })
    const controls = async () => {
      await page.getByRole('button', { name: 'Yesterday', exact: true }).click()
      await page.getByRole('region', { name: 'Match spotlight' }).waitFor()
      await page.locator('[aria-label="Filter by competition"]').getByRole('button', { name: /^Premier League / }).click()
      await page.getByRole('button', { name: /^To play / }).click()
    }
    const snapshot = async (expected) => {
      await page.waitForLoadState('networkidle')
      if (expected) {
        await page.waitForFunction((expected) => {
          const selected = (group) => [...document.querySelectorAll(`[aria-label="${group}"] button`)].find((node) => node.getAttribute('aria-pressed') === 'true')?.textContent?.replace(/\s*\d+$/, '').trim()
          return `${location.pathname}${location.search}` === expected.url
            && selected('Select date') === expected.date
            && selected('Filter matches') === expected.status
            && (selected('Filter by competition') ?? 'All competitions') === expected.competition
        }, expected, { timeout: probe ? 1500 : 5000 }).catch((error) => { if (!probe) throw error })
      }
      return page.evaluate(() => ({
        url: `${location.pathname}${location.search}`,
        date: [...document.querySelectorAll('[aria-label="Select date"] button')].find((node) => node.getAttribute('aria-pressed') === 'true')?.textContent,
        status: [...document.querySelectorAll('[aria-label="Filter matches"] button')].find((node) => node.getAttribute('aria-pressed') === 'true')?.textContent?.replace(/\s*\d+$/, '').trim(),
        competition: [...document.querySelectorAll('[aria-label="Filter by competition"] button')].find((node) => node.getAttribute('aria-pressed') === 'true')?.textContent?.replace(/\s*\d+$/, '').trim() ?? 'All competitions',
      }))
    }
    const compare = (actual, expected, label) => {
      try { assert.deepEqual(actual, expected, label) } catch (error) {
        if (!probe) throw error
        failures.push({ label, actual, expected })
      }
    }
    const samePath = []
    const focusPixels = []
    for (const selection of ['cold', 'controls']) {
      for (const link of ['brand', 'matchday']) {
        console.log(`Checking same-path ${width}px ${selection}/${link}`)
        await page.goto(new URL(selection === 'cold' ? filteredUrl : '/', base).href, { waitUntil: 'networkidle' })
        if (selection === 'controls') await controls()
        const before = await snapshot()
        const filtered = { ...before, date: 'Yesterday', status: 'To play', competition: 'Premier League' }
        compare(before, filtered, `${width} ${selection} ${link}: initial filters`)
        if (selection === 'cold' && link === 'brand') {
          focusPixels.push(await pixelFocus(page, page.getByRole('button', { name: /^To play / }), `active-filter-${width}`, out))
          const action = page.getByRole('link', { name: 'Match centre', exact: true })
          await action.hover()
          focusPixels.push(await pixelFocus(page, action, `hovered-match-centre-${width}`, out))
          for (const measurement of focusPixels) compare(measurement.contrast >= 3, true, `${measurement.name}: actual ring/fill contrast`)
        }
        await homeLink(link).click()
        await page.waitForURL((url) => url.pathname === '/' && url.search === '')
        const defaults = { url: '/', date: 'Today', status: 'All matches', competition: 'All competitions' }
        const home = await snapshot(defaults)
        compare(home, defaults, `${width} ${selection} ${link}: cleared home`)
        await page.goBack()
        const back = await snapshot(filtered)
        compare(back, filtered, `${width} ${selection} ${link}: Back`)
        await page.goForward()
        const forward = await snapshot(defaults)
        compare(forward, defaults, `${width} ${selection} ${link}: Forward`)
        samePath.push({ selection, link, before, home, back, forward })
      }
    }

    const [oldMatch, newMatch] = records.filter((record) => record.league === 'Premier League')
    console.log(`Checking delayed detail ${width}px`)
    assert(oldMatch && newMatch)
    const delayedOldResponses = []
    for (const navigation of ['through-matchday', 'direct-client-route']) {
      delayId = String(oldMatch.match_id)
      oldGate = new Promise((resolve) => { releaseOld = resolve })
      const started = new Promise((resolve) => { oldStarted = resolve })
      await page.goto(new URL(`/matches/${delayId}?league=eng.1`, base).href, { waitUntil: 'domcontentloaded' })
      await page.getByLabel('Loading match details', { exact: true }).waitFor()
      await started
      console.log(`Delayed detail ${width}px ${navigation}: old response held`)
      if (navigation === 'through-matchday') {
        await homeLink('brand').click()
        await page.waitForURL((url) => url.pathname === '/')
        await controls()
        await page.getByRole('link', { name: new RegExp(`${newMatch.home_team}.*${newMatch.away_team}`) }).click()
      } else {
        // Next exposes its live App Router here. Use it to exercise a direct
        // ID-to-ID client transition, without adding a test control to the app.
        await page.evaluate((href) => window.next.router.push(href), `/matches/${newMatch.match_id}?league=eng.1`)
      }
      const heading = `${newMatch.home_team} vs ${newMatch.away_team}`
      await page.getByRole('heading', { name: heading, exact: true }).waitFor()
      console.log(`Delayed detail ${width}px ${navigation}: new response shown`)
      const finished = page.waitForEvent('requestfinished', { predicate: (request) => new URL(request.url()).pathname === `/api/match/${delayId}` })
      releaseOld()
      await finished
      await page.waitForLoadState('networkidle')
      const afterOldResponse = await page.getByRole('heading', { level: 1 }).allTextContents()
      compare(afterOldResponse, [heading], `${width} ${navigation}: delayed old match cannot replace new detail`)
      assert.equal(new URL(page.url()).pathname, `/matches/${newMatch.match_id}`)
      delayedOldResponses.push({ navigation, oldId: delayId, newId: String(newMatch.match_id), oldResponseFinished: true, headingAfterOldResponse: afterOldResponse })
    }
    assert.deepEqual(errors, [], 'Unexpected browser errors')
    const report = { width, samePath, focusPixels, delayedOldResponses, failures, errors }
    reports.push(report)
    console.log(`Navigation races ${width}px: ${failures.length ? `${failures.length} reproduced failures` : 'pass'}`)
    await context.close()
  }
  await writeFile(`${out}/navigation-races.json`, JSON.stringify(reports, null, 2))
  return reports
}
